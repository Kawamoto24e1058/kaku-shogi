// LLM による駒生成（API と バックフィルスクリプトで共用）
// 無料枠の上限や障害で1つのモデルが使えなくても止まらないよう、上から順に試す:
//   1. Gemini（GEMINI_MODEL）
//   2. Gemini 軽量モデル（GEMINI_FALLBACK_MODEL。1日の上限はモデルごとに別枠）
//   3. Gemma（GEMMA_MODEL。同じ Gemini APIキーで使え、1日の上限が大きい。構造化出力は非対応）
//   4. OpenAI 互換API（任意。Groq / OpenRouter / Cloudflare Workers AI など。FALLBACK_LLM_* で設定）
// 1日の上限は「リクエスト回数」で数えられるため、複数の単語を1回でまとめて生成できるようにしている。
import { buildPrompt } from './prompt.js';
import { PIECES_RESPONSE_SCHEMA } from './pieceSchema.js';
import { wordKey } from '../../shared/wordKey.js';

export type Json = Record<string, unknown>;

const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite';
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
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end <= start) throw new ProviderError('response did not contain JSON');
  const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
  if (Array.isArray(parsed)) return parsed as Json[];
  const obj = parsed as Json;
  if (Array.isArray(obj.pieces)) return obj.pieces as Json[];
  return [obj];
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

async function callOpenAICompatible(words: string[]): Promise<Json[]> {
  const base = (process.env.FALLBACK_LLM_BASE_URL || '').replace(/\/$/, '');
  const data = await fetchJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.FALLBACK_LLM_API_KEY}` },
    body: JSON.stringify({
      model: process.env.FALLBACK_LLM_MODEL,
      messages: [{ role: 'user', content: buildPrompt(words) }],
      response_format: { type: 'json_object' },
      temperature: 0.9,
      max_tokens: OUTPUT_TOKENS_PER_PIECE * words.length,
    }),
  }, words.length > 1 ? BATCH_TIMEOUT_MS : TIMEOUT_MS) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new ProviderError('fallback LLM returned an empty response');
  return extractPieces(text);
}

export interface Provider {
  name: string;
  run: (words: string[]) => Promise<Json[]>;
}

export function configuredProviders(): Provider[] {
  const providers: Provider[] = [];
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const models = [PRIMARY_MODEL, FALLBACK_MODEL].filter((m, i, all) => m && all.indexOf(m) === i);
    for (const model of models) {
      providers.push({ name: model, run: w => callGeminiAdaptive(model, w, geminiKey, ['schema', 'json', 'plain']) });
    }
    if (GEMMA_MODEL) {
      providers.push({ name: GEMMA_MODEL, run: w => callGeminiAdaptive(GEMMA_MODEL, w, geminiKey, ['plain']) });
    }
  }
  if (process.env.FALLBACK_LLM_BASE_URL && process.env.FALLBACK_LLM_API_KEY && process.env.FALLBACK_LLM_MODEL) {
    providers.push({ name: `fallback:${process.env.FALLBACK_LLM_MODEL}`, run: callOpenAICompatible });
  }
  return providers;
}

export interface BatchResult {
  /** words と同じ順。生成できなかった単語は null */
  pieces: (Json | null)[];
  provider: string;
}

/** 設定済みのプロバイダを順に試し、最初に成功した結果を返す。全滅なら最後のエラーを投げる */
export async function generatePieces(words: string[], providers = configuredProviders()): Promise<BatchResult> {
  if (providers.length === 0) throw new NoProviderError('no LLM provider is configured');
  let lastError: unknown;
  for (const provider of providers) {
    try {
      const pieces = alignToWords(words, await provider.run(words));
      if (pieces.every(p => p === null)) throw new ProviderError(`${provider.name} returned no usable piece`);
      return { pieces, provider: provider.name };
    } catch (err) {
      lastError = err;
      console.warn(`[generator] ${provider.name} failed:`, (err as Error).message);
    }
  }
  throw lastError;
}

/** 1語だけ生成する */
export async function generatePiece(word: string, providers = configuredProviders()): Promise<{ piece: Json; provider: string }> {
  const { pieces, provider } = await generatePieces([word], providers);
  return { piece: pieces[0]!, provider };
}
