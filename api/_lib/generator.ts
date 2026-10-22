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

async function callGemini(model: string, words: string[], apiKey: string, mode: GeminiMode): Promise<Json[]> {
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
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: buildPrompt(words) }] }], generationConfig }),
  }, words.length > 1 ? BATCH_TIMEOUT_MS : TIMEOUT_MS) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new ProviderError(`${model} returned an empty response`);
  return extractPieces(text);
}

/** スキーマ → JSONモード → プレーンの順に、モデルが受け付ける形式まで落として呼ぶ */
async function callGeminiAdaptive(model: string, words: string[], apiKey: string, modes: GeminiMode[]): Promise<Json[]> {
  let lastError: unknown;
  for (const mode of modes) {
    try {
      return await callGemini(model, words, apiKey, mode);
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
  /** プロバイダ固有の追加パラメータ */
  extraBody?: Json;
}

/** OpenAI 互換の chat/completions を呼ぶ。JSONモードに非対応のモデルなら(400)、指定なしで再試行する */
async function callOpenAICompatible(config: OpenAICompatibleConfig, words: string[]): Promise<Json[]> {
  const call = async (jsonMode: boolean) => {
    const data = await fetchJson(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: buildPrompt(words) }],
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        temperature: 0.9,
        max_tokens: OUTPUT_TOKENS_PER_PIECE * words.length,
        ...(config.extraBody || {}),
      }),
    }, words.length > 1 ? BATCH_TIMEOUT_MS : TIMEOUT_MS) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content || '';
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

export interface Provider {
  name: string;
  run: (words: string[]) => Promise<Json[]>;
}

export function configuredProviders(): Provider[] {
  const providers: Provider[] = [];

  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  if (cfAccount && cfToken) {
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/v1`;
    for (const model of [WORKERS_AI_MODEL, WORKERS_AI_FALLBACK_MODEL].filter((m, i, all) => m && all.indexOf(m) === i)) {
      const extraBody = WORKERS_AI_THINKING ? undefined : { chat_template_kwargs: { enable_thinking: false } };
      providers.push({ name: `workers-ai:${model}`, run: w => callOpenAICompatible({ baseUrl, apiKey: cfToken, model, extraBody }, w) });
    }
  }

  const fb = { baseUrl: process.env.FALLBACK_LLM_BASE_URL, apiKey: process.env.FALLBACK_LLM_API_KEY, model: process.env.FALLBACK_LLM_MODEL };
  if (fb.baseUrl && fb.apiKey && fb.model) {
    const config = fb as OpenAICompatibleConfig;
    providers.push({ name: `fallback:${config.model}`, run: w => callOpenAICompatible(config, w) });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (ENABLE_GEMINI && geminiKey) {
    const models = [PRIMARY_MODEL, FALLBACK_MODEL].filter((m, i, all) => m && all.indexOf(m) === i);
    for (const model of models) {
      providers.push({ name: model, run: w => callGeminiAdaptive(model, w, geminiKey, ['schema', 'json', 'plain']) });
    }
    if (GEMMA_MODEL) {
      providers.push({ name: GEMMA_MODEL, run: w => callGeminiAdaptive(GEMMA_MODEL, w, geminiKey, ['plain']) });
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
 * 設定済みのプロバイダを順に試し、最初に成功した結果を返す。全滅なら最後のエラーを投げる。
 * 混雑（429 / 503 など）で失敗したプロバイダは、少し待って1回だけ再試行してから次へ進む。
 * 全体で待つ時間は関数の時間制限に収まるよう短くしている。
 */
export async function generatePieces(words: string[], providers = configuredProviders()): Promise<BatchResult> {
  if (providers.length === 0) throw new NoProviderError('no LLM provider is configured');
  let lastError: unknown;
  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const pieces = alignToWords(words, await provider.run(words));
        if (pieces.every(p => p === null)) throw new ProviderError(`${provider.name} returned no usable piece`);
        return { pieces, provider: provider.name };
      } catch (err) {
        lastError = err;
        console.warn(`[generator] ${provider.name} failed (attempt ${attempt + 1}):`, (err as Error).message);
        if (!isTransient(err) || attempt > 0) break;
        await sleep(800 + Math.floor(Math.random() * 700));
      }
    }
  }
  throw lastError;
}

/** 1語だけ生成する */
export async function generatePiece(word: string, providers = configuredProviders()): Promise<{ piece: Json; provider: string }> {
  const { pieces, provider } = await generatePieces([word], providers);
  return { piece: pieces[0]!, provider };
}
