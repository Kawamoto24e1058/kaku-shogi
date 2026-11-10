// LLM による駒生成（API と バックフィルスクリプトで共用）
// 無料枠の上限や障害で1つのモデルが使えなくても止まらないよう、設定済みのものを上から順に試す:
//   1. Cloudflare Workers AI（既定: Gemma 4 26B。CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN）
//   2. Workers AI の予備モデル（任意。WORKERS_AI_FALLBACK_MODEL）
//   3. OpenAI 互換API（任意。Groq / OpenRouter など。FALLBACK_LLM_*）
//   4. Gemini API（ENABLE_GEMINI=true のときだけ）
// Gemini API の利用規約には「18歳未満が利用する可能性が高いサイトでの利用禁止」の条項があり、
// 誰でも遊べる公開ゲームでは抵触するおそれがあるため、既定では使わない。
// 1日の上限は「リクエスト回数」で数えられることが多いため、複数の単語を1回でまとめて生成できるようにしている。
import { buildPrompt } from './prompt.js';
import { PIECES_RESPONSE_SCHEMA } from './pieceSchema.js';
import { wordKey } from '../../shared/wordKey.js';

export type Json = Record<string, unknown>;

const WORKERS_AI_MODEL = process.env.WORKERS_AI_MODEL || '@cf/google/gemma-4-26b-a4b-it';
const WORKERS_AI_FALLBACK_MODEL = process.env.WORKERS_AI_FALLBACK_MODEL || '';
// Gemma 4 などは既定で「思考」してから答えるため、5語まとめると90秒を超えることがある。駒生成では思考を切る
const WORKERS_AI_THINKING = process.env.WORKERS_AI_THINKING === 'true';
// 同じ名前を付けた呼び出しは同じサーバーに回され、毎回同じプロンプトの前半（約2,500トークン）がキャッシュされる。
// 計測では1枚あたり約34 → 約23 Neurons になり、無料枠（1日 10,000 Neurons）で作れる枚数が約1.5倍になった
const WORKERS_AI_AFFINITY = { 'x-session-affinity': 'kaku-shogi-piece-prompt' };
const ENABLE_GEMINI = process.env.ENABLE_GEMINI === 'true';
// gemini-3.5-flash は非推奨で、後継モデルに自動で振り替えられる（2026年10月時点の公式ドキュメント）。
// モデル名は変わりやすいので、環境変数 GEMINI_MODEL / GEMINI_FALLBACK_MODEL で差し替えられるようにしている
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite';
// 空文字を設定すると Gemma を使わない
const GEMMA_MODEL = process.env.GEMMA_MODEL ?? 'gemma-3-27b-it';
// 思考(thinking)はJSON生成の待ち時間を大きく伸ばすため既定でオフ。品質を優先したい場合は 512 などに上げる
const THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);
const OUTPUT_TOKENS_PER_PIECE = 1500;
const TIMEOUT_MS = 25_000;
const BATCH_TIMEOUT_MS = 90_000;
// 残り時間がこれより短ければ、新しい呼び出しを始めない（1語の生成にかかる時間の目安）
const MIN_CALL_MS = 8_000;

export class ProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** LLMプロバイダが1つも設定されていない（＝障害ではなく設定不足） */
export class NoProviderError extends Error {}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderError(`${new URL(url).host} returned ${res.status}: ${detail.slice(0, 300)}`, res.status);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** モデルの出力から駒の配列を取り出す（```json で囲む・配列で返す・1件だけ返す、などの揺れを吸収） */
export function extractPieces(text: string): Json[] {
  // 思考過程などの前置きに { が含まれる場合に備え、"pieces" から始まる部分も候補にする
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  const starts = [text.search(/[[{]/), text.lastIndexOf('{"pieces"'), text.lastIndexOf('{\n  "pieces"')]
    .filter((i, idx, all) => i >= 0 && all.indexOf(i) === idx);
  for (const start of starts) {
    if (end <= start) continue;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (Array.isArray(parsed)) return parsed as Json[];
      const obj = parsed as Json;
      if (Array.isArray(obj.pieces)) return obj.pieces as Json[];
      return [obj];
    } catch {
      // 次の候補を試す
    }
  }
  throw new ProviderError('response did not contain valid JSON');
}

/** 入力した単語の順に並べ直す。足りない分は null（呼び出し側で待ち行列へ回す） */
export function alignToWords(words: string[], pieces: Json[]): (Json | null)[] {
  const valid = pieces.filter(p => p && typeof p === 'object');
  const used = new Set<number>();
  // 1. word フィールドが一致するものを優先
  const result: (Json | null)[] = words.map(word => {
    const key = wordKey(word);
    const idx = valid.findIndex((p, i) => !used.has(i) && typeof p.word === 'string' && wordKey(p.word) === key);
    if (idx < 0) return null;
    used.add(idx);
    return valid[idx];
  });
  // 2. 件数が一致していれば、余った駒を空いている単語へ順に割り当てる（モデルが word を書き換えた場合の救済）
  if (valid.length === words.length) {
    const leftovers = valid.filter((_, i) => !used.has(i));
    result.forEach((piece, i) => {
      if (!piece) result[i] = leftovers.shift() ?? null;
    });
  }
  return result.map((piece, i) => (piece ? { ...piece, word: words[i] } : null));
}

type GeminiMode = 'schema' | 'json' | 'plain';

/** 1回の呼び出しの待ち時間。全体の締め切りがあれば、それを超えない */
function callTimeout(words: string[], deadline: number): number {
  return Math.max(1_000, Math.min(words.length > 1 ? BATCH_TIMEOUT_MS : TIMEOUT_MS, deadline - Date.now()));
}

async function callGemini(model: string, words: string[], apiKey: string, mode: GeminiMode, deadline: number, references?: (string | null)[]): Promise<Json[]> {
  const generationConfig: Json = {
    temperature: 1.0,
    maxOutputTokens: OUTPUT_TOKENS_PER_PIECE * words.length,
  };
  if (mode !== 'plain') {
    generationConfig.responseMimeType = 'application/json';
    if (THINKING_BUDGET >= 0) generationConfig.thinkingConfig = { thinkingBudget: THINKING_BUDGET };
  }
  if (mode === 'schema') generationConfig.responseSchema = PIECES_RESPONSE_SCHEMA;

  const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    // キーはURLではなくヘッダーで渡す（URLはログに残りやすいため）
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: buildPrompt(words, references) }] }], generationConfig }),
  }, callTimeout(words, deadline)) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new ProviderError(`${model} returned an empty response`);
  return extractPieces(text);
}

/** スキーマ → JSONモード → プレーンの順に、モデルが受け付ける形式まで落として呼ぶ */
async function callGeminiAdaptive(model: string, words: string[], apiKey: string, modes: GeminiMode[], deadline: number, references?: (string | null)[]): Promise<Json[]> {
  let lastError: unknown;
  for (const mode of modes) {
    try {
      return await callGemini(model, words, apiKey, mode, deadline, references);
    } catch (err) {
      lastError = err;
      // 400 = このモデルがその設定に非対応。それ以外（429 上限・5xx 障害）は次のプロバイダへ
      if (!(err instanceof ProviderError && err.status === 400)) throw err;
    }
  }
  throw lastError;
}

interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** プロバイダ固有の追加ヘッダー */
  extraHeaders?: Record<string, string>;
  /** プロバイダ固有の追加パラメータ */
  extraBody?: Json;
}

/** 書いている途中の出力（それまでの全文）を受け取る。再試行すると空から始まり直す */
export type OnText = (textSoFar: string) => void;

/**
 * AIの出力ストリーム（Server-Sent Events のバイト列）をそのまま受け取る。
 * Worker ではこれを JavaScript で読まずにブラウザへ流す（1文字ずつ解析すると無料プランの CPU 時間を超えるため）。
 * 再試行のたびに新しいストリームが渡される
 */
export type OnRawStream = (stream: ReadableStream<Uint8Array>) => void;

/**
 * AIの出力ストリームを二つに分け、片方はそのままブラウザへ（onRaw）、もう片方をサーバーで最後に一度だけ読む。
 * どちらも JavaScript で塊ごとに触らないので、Workers の無料プランの CPU 時間に収まる。
 * サーバー側を tee の枝から直接 Response.text() で読むと大きな単位でまとめて読まれ、ブラウザ側まで数秒止まるため、
 * IdentityTransformStream を挟んで届いた分ずつ流れるようにしている
 */
async function relayAndReadSSE(stream: ReadableStream<Uint8Array>, onRaw: OnRawStream): Promise<string> {
  const [toClient, toServer] = stream.tee();
  onRaw(toClient);
  const Identity = (globalThis as { IdentityTransformStream?: new () => TransformStream<Uint8Array, Uint8Array> }).IdentityTransformStream;
  if (!Identity) return textFromSSE(await new Response(toServer).text());
  const relay = new Identity();
  const piping = toServer.pipeTo(relay.writable).catch(() => undefined);
  const body = await new Response(relay.readable).text();
  await piping;
  return textFromSSE(body);
}

/** SSE の全文から、AIが書いた文章をつなげて取り出す（OpenAI 互換・Workers AI 独自のどちらの形にも対応） */
export function textFromSSE(sse: string): string {
  // 1行ごとに全体を JSON.parse すると（数百行ある）CPU 時間がかかるので、文字の部分だけを取り出して読む
  const pattern = /"(?:content|response)":"((?:[^"\\]|\\.)*)"/g;
  let text = '';
  for (const match of sse.matchAll(pattern)) {
    try {
      text += JSON.parse(`"${match[1]}"`) as string;
    } catch {
      // 壊れた行は読み飛ばす（最後に全体を JSON として検証する）
    }
  }
  return text;
}

/** OpenAI 互換の chat/completions を呼ぶ。JSONモードに非対応のモデルなら(400)、指定なしで再試行する。
 * onText があれば stream: true で受け取り、届いた分を順に渡す（生成中の駒を少しずつ見せるため） */
async function callOpenAICompatible(config: OpenAICompatibleConfig, words: string[], deadline: number, onText?: OnText, references?: (string | null)[], onRaw?: OnRawStream): Promise<Json[]> {
  const call = async (jsonMode: boolean) => {
    const body = JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: buildPrompt(words, references) }],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      temperature: 0.9,
      max_tokens: OUTPUT_TOKENS_PER_PIECE * words.length,
      ...(onText || onRaw ? { stream: true } : {}),
      ...(config.extraBody || {}),
    });
    const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`, ...(config.extraHeaders || {}) };
    const text = onRaw
      ? await relayFromFetch(url, { method: 'POST', headers, body }, callTimeout(words, deadline), onRaw)
      : onText
      ? await streamText(url, { method: 'POST', headers, body }, callTimeout(words, deadline), onText)
      : ((await fetchJson(url, { method: 'POST', headers, body }, callTimeout(words, deadline)) as { choices?: { message?: { content?: string } }[] })
        .choices?.[0]?.message?.content || '');
    if (!text) throw new ProviderError(`${config.model} returned an empty response`);
    return extractPieces(text);
  };
  try {
    return await call(true);
  } catch (err) {
    if (err instanceof ProviderError && err.status === 400) return call(false);
    throw err;
  }
}

/** fetch の応答（SSE）を、ブラウザへそのまま流しつつサーバーでも読む（relayAndReadSSE） */
async function relayFromFetch(url: string, init: RequestInit, timeoutMs: number, onRaw: OnRawStream): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new ProviderError(`${new URL(url).host} returned ${res.status}: ${detail.slice(0, 300)}`, res.status);
    }
    return await relayAndReadSSE(res.body, onRaw);
  } finally {
    clearTimeout(timer);
  }
}

/** Server-Sent Events（data: {...}）で届く出力をつなげて返す。途中経過は onText へ */
async function streamText(url: string, init: RequestInit, timeoutMs: number, onText: OnText): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new ProviderError(`${new URL(url).host} returned ${res.status}: ${detail.slice(0, 300)}`, res.status);
    }
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    onText('');
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      let grew = false;
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            grew = true;
          }
        } catch {
          // 壊れた行は読み飛ばす（最後に全体を JSON として検証する）
        }
      }
      if (grew) onText(text);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Cloudflare Workers の AI バインディング（env.AI）。Worker で動くときだけ setWorkersAIBinding で渡される */
export interface WorkersAIBinding {
  run(model: string, inputs: Record<string, unknown>, options?: { extraHeaders?: Record<string, string> }): Promise<unknown>;
}

let workersAIBinding: WorkersAIBinding | null = null;

/** Worker の起動時に呼ぶ。以後は APIトークンを使わず、同じ Cloudflare の中から直接 AI を呼ぶ */
export function setWorkersAIBinding(binding: WorkersAIBinding | null | undefined): void {
  workersAIBinding = binding ?? null;
}

/** 応答の形（OpenAI 互換の choices / Workers AI 独自の response）の違いを吸収して文章を取り出す */
function bindingText(data: unknown): string {
  const d = data as { response?: unknown; choices?: { message?: { content?: string }; delta?: { content?: string } }[] };
  if (typeof d?.response === 'string') return d.response;
  if (d?.response && typeof d.response === 'object') return JSON.stringify(d.response);
  return d?.choices?.[0]?.message?.content ?? d?.choices?.[0]?.delta?.content ?? '';
}

async function callWorkersAIBinding(binding: WorkersAIBinding, model: string, words: string[], deadline: number, onRaw?: OnRawStream, references?: (string | null)[]): Promise<Json[]> {
  const inputs = {
    messages: [{ role: 'user', content: buildPrompt(words, references) }],
    response_format: { type: 'json_object' },
    temperature: 0.9,
    max_tokens: OUTPUT_TOKENS_PER_PIECE * words.length,
    ...(WORKERS_AI_THINKING ? {} : { chat_template_kwargs: { enable_thinking: false } }),
    ...(onRaw ? { stream: true } : {}),
  };
  const timeoutMs = callTimeout(words, deadline);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderError(`workers-ai binding timed out after ${timeoutMs}ms`, 504)), timeoutMs);
  });
  try {
    const run = (async () => {
      let result: unknown;
      try {
        result = await binding.run(model, inputs, { extraHeaders: WORKERS_AI_AFFINITY });
      } catch (err) {
        // バインディングのエラーには HTTP の状態がないので、無料枠切れ・混雑を文言から判断する
        const message = (err as Error).message || String(err);
        const status = /daily free allocation|neurons|4006/i.test(message) ? 429 : /capacity|overloaded|3040|timeout/i.test(message) ? 503 : 500;
        throw new ProviderError(`workers-ai binding: ${message.slice(0, 300)}`, status);
      }
      if (result instanceof ReadableStream) {
        const stream = result as ReadableStream<Uint8Array>;
        if (onRaw) return relayAndReadSSE(stream, onRaw);
        return textFromSSE(await new Response(stream).text());
      }
      return bindingText(result);
    })();
    const text = await Promise.race([run, timeout]);
    if (!text) throw new ProviderError(`${model} returned an empty response`);
    return extractPieces(text);
  } finally {
    clearTimeout(timer);
  }
}

export interface Provider {
  name: string;
  /** deadline: この時刻（Date.now()）までに応答がなければ打ち切る */
  run: (words: string[], deadline?: number, onText?: OnText, onRaw?: OnRawStream, references?: (string | null)[]) => Promise<Json[]>;
}

export function configuredProviders(): Provider[] {
  const providers: Provider[] = [];

  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const binding = workersAIBinding;
  if (binding) {
    for (const model of [WORKERS_AI_MODEL, WORKERS_AI_FALLBACK_MODEL].filter((m, i, all) => m && all.indexOf(m) === i)) {
      providers.push({ name: `workers-ai:${model}`, run: (w, d = Infinity, _t, r, refs) => callWorkersAIBinding(binding, model, w, d, r, refs) });
    }
  } else if (cfAccount && cfToken) {
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/v1`;
    for (const model of [WORKERS_AI_MODEL, WORKERS_AI_FALLBACK_MODEL].filter((m, i, all) => m && all.indexOf(m) === i)) {
      const extraBody = WORKERS_AI_THINKING ? undefined : { chat_template_kwargs: { enable_thinking: false } };
      providers.push({ name: `workers-ai:${model}`, run: (w, d = Infinity, t, r, refs) => callOpenAICompatible({ baseUrl, apiKey: cfToken, model, extraBody, extraHeaders: WORKERS_AI_AFFINITY }, w, d, t, refs, r) });
    }
  }

  const fb = { baseUrl: process.env.FALLBACK_LLM_BASE_URL, apiKey: process.env.FALLBACK_LLM_API_KEY, model: process.env.FALLBACK_LLM_MODEL };
  if (fb.baseUrl && fb.apiKey && fb.model) {
    const config = fb as OpenAICompatibleConfig;
    providers.push({ name: `fallback:${config.model}`, run: (w, d = Infinity, t, r, refs) => callOpenAICompatible(config, w, d, t, refs, r) });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (ENABLE_GEMINI && geminiKey) {
    const models = [PRIMARY_MODEL, FALLBACK_MODEL].filter((m, i, all) => m && all.indexOf(m) === i);
    for (const model of models) {
      providers.push({ name: model, run: (w, d = Infinity, _t, _r, refs) => callGeminiAdaptive(model, w, geminiKey, ['schema', 'json', 'plain'], d, refs) });
    }
    if (GEMMA_MODEL) {
      providers.push({ name: GEMMA_MODEL, run: (w, d = Infinity, _t, _r, refs) => callGeminiAdaptive(GEMMA_MODEL, w, geminiKey, ['plain'], d, refs) });
    }
  }
  return providers;
}

export interface BatchResult {
  /** words と同じ順。生成できなかった単語は null */
  pieces: (Json | null)[];
  provider: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 一時的な混雑・上限（429 / 503 / 500 / 502 / 504）。少し待てば通ることがある */
function isTransient(err: unknown): boolean {
  return err instanceof ProviderError && [429, 500, 502, 503, 504].includes(err.status ?? 0);
}

/**
 * 無料枠を使い切ったプロバイダ（Workers AI の「1日 10,000 Neurons」など）は、枠が戻る UTC 0時まで呼ばない。
 * 有料プランではないので超えても課金はされず、エラーが返るだけ。毎回呼んで失敗を待つ無駄を省く（インスタンスごとの記録）
 */
const exhaustedUntil = new Map<string, number>();

/** 無料枠を使い切ったことによる失敗か（呼び出し側で「今日の枠が終わった」と案内するため） */
export function isQuotaExhausted(err: unknown): boolean {
  return isDailyQuotaError(err);
}

function isDailyQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  return /free allocation|neurons|4006|quota/i.test(message) && (!(err instanceof ProviderError) || [429, 403, 400].includes(err.status ?? 0));
}

function nextUtcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

/**
 * 設定済みのプロバイダを順に試し、最初に成功した結果を返す。全滅なら最後のエラーを投げる。
 * 混雑（429 / 503 など）で失敗したプロバイダは、少し待って1回だけ再試行してから次へ進む。
 * 全体で待つ時間は関数の時間制限に収まるよう短くしている。
 */
export async function generatePieces(words: string[], providers = configuredProviders(), deadline = Infinity, onText?: OnText, onRaw?: OnRawStream, references?: (string | null)[]): Promise<BatchResult> {
  if (providers.length === 0) throw new NoProviderError('no LLM provider is configured');
  let lastError: unknown;
  for (const provider of providers) {
    if ((exhaustedUntil.get(provider.name) ?? 0) > Date.now()) {
      lastError = new ProviderError(`${provider.name} has used up today's free allocation`, 429);
      continue;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      // 関数の時間制限を超えると応答そのものが返らない（ブラウザには 504 だけが届く）。
      // 残り時間が少なければ再試行・次のプロバイダを諦め、代替（近い単語・待ち行列）に回す
      if (deadline - Date.now() < MIN_CALL_MS) {
        lastError ??= new ProviderError('no time left for another attempt', 504);
        throw lastError;
      }
      try {
        const pieces = alignToWords(words, await provider.run(words, deadline, onText, onRaw, references));
        if (pieces.every(p => p === null)) throw new ProviderError(`${provider.name} returned no usable piece`);
        return { pieces, provider: provider.name };
      } catch (err) {
        lastError = err;
        console.warn(`[generator] ${provider.name} failed (attempt ${attempt + 1}):`, (err as Error).message);
        if (isDailyQuotaError(err)) {
          exhaustedUntil.set(provider.name, nextUtcMidnight());
          break;
        }
        if (!isTransient(err) || attempt > 0) break;
        await sleep(800 + Math.floor(Math.random() * 700));
      }
    }
  }
  throw lastError;
}

/** 1語だけ生成する */
export async function generatePiece(word: string, providers = configuredProviders(), deadline = Infinity, onText?: OnText, onRaw?: OnRawStream, reference?: string | null): Promise<{ piece: Json; provider: string }> {
  const { pieces, provider } = await generatePieces([word], providers, deadline, onText, onRaw, [reference ?? null]);
  return { piece: pieces[0]!, provider };
}
