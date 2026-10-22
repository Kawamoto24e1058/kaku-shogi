// LLM による駒生成（API と バックフィルスクリプトで共用）
// 無料枠の上限や障害で1つのプロバイダが使えなくても止まらないよう、上から順に試す:
//   1. Gemini（GEMINI_MODEL）
//   2. Gemini 軽量モデル（GEMINI_FALLBACK_MODEL。上限が別枠のことが多い）
//   3. OpenAI 互換API（任意。Groq / OpenRouter / Cloudflare Workers AI など。FALLBACK_LLM_* で設定）
import { buildPrompt } from './prompt.js';
import { PIECE_RESPONSE_SCHEMA } from './pieceSchema.js';

export type Json = Record<string, unknown>;

const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite';
// 思考(thinking)はJSON生成の待ち時間を大きく伸ばすため既定でオフ。品質を優先したい場合は 512 などに上げる
const THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);
const MAX_OUTPUT_TOKENS = 2048;
const TIMEOUT_MS = 25_000;

export class ProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

function parseJsonText(text: string): Json {
  // ```json ... ``` で囲んで返すモデルもあるため、最初の { から最後の } までを取り出す
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ProviderError('response did not contain JSON');
  return JSON.parse(text.slice(start, end + 1)) as Json;
}

async function callGemini(model: string, word: string, apiKey: string, useSchema: boolean): Promise<Json> {
  const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    // キーはURLではなくヘッダーで渡す（URLはログに残りやすいため）
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(word) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(useSchema ? { responseSchema: PIECE_RESPONSE_SCHEMA } : {}),
        temperature: 1.0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(THINKING_BUDGET >= 0 ? { thinkingConfig: { thinkingBudget: THINKING_BUDGET } } : {}),
      },
    }),
  }) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new ProviderError(`Gemini ${model} returned an empty response`);
  return parseJsonText(text);
}

async function callGeminiWithSchemaRetry(model: string, word: string, apiKey: string): Promise<Json> {
  try {
    return await callGemini(model, word, apiKey, true);
  } catch (err) {
    // スキーマが受け付けられない(400)場合はJSONモードのみで再試行（結果はクライアントのサニタイザで補正される）
    if (err instanceof ProviderError && err.status === 400) return callGemini(model, word, apiKey, false);
    throw err;
  }
}

async function callOpenAICompatible(word: string): Promise<Json> {
  const base = (process.env.FALLBACK_LLM_BASE_URL || '').replace(/\/$/, '');
  const data = await fetchJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.FALLBACK_LLM_API_KEY}` },
    body: JSON.stringify({
      model: process.env.FALLBACK_LLM_MODEL,
      messages: [
        { role: 'system', content: 'あなたは将棋の変則駒をデザインするゲームデザイナーです。指示されたJSONオブジェクトだけを出力してください。' },
        { role: 'user', content: buildPrompt(word) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.9,
      max_tokens: MAX_OUTPUT_TOKENS,
    }),
  }) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new ProviderError('fallback LLM returned an empty response');
  return parseJsonText(text);
}

interface Provider {
  name: string;
  run: (word: string) => Promise<Json>;
}

export function configuredProviders(): Provider[] {
  const providers: Provider[] = [];
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    providers.push({ name: PRIMARY_MODEL, run: w => callGeminiWithSchemaRetry(PRIMARY_MODEL, w, geminiKey) });
    if (FALLBACK_MODEL && FALLBACK_MODEL !== PRIMARY_MODEL) {
      providers.push({ name: FALLBACK_MODEL, run: w => callGeminiWithSchemaRetry(FALLBACK_MODEL, w, geminiKey) });
    }
  }
  if (process.env.FALLBACK_LLM_BASE_URL && process.env.FALLBACK_LLM_API_KEY && process.env.FALLBACK_LLM_MODEL) {
    providers.push({ name: `fallback:${process.env.FALLBACK_LLM_MODEL}`, run: callOpenAICompatible });
  }
  return providers;
}

/** LLMプロバイダが1つも設定されていない（＝障害ではなく設定不足） */
export class NoProviderError extends Error {}

export interface GenerationResult {
  piece: Json;
  provider: string;
}

/** 設定済みのプロバイダを順に試し、最初に成功した結果を返す。全滅なら最後のエラーを投げる */
export async function generatePiece(word: string, providers = configuredProviders()): Promise<GenerationResult> {
  if (providers.length === 0) throw new NoProviderError('no LLM provider is configured');
  let lastError: unknown;
  for (const provider of providers) {
    try {
      const piece = await provider.run(word);
      piece.word = word;
      return { piece, provider: provider.name };
    } catch (err) {
      lastError = err;
      console.warn(`[generator] ${provider.name} failed:`, (err as Error).message);
    }
  }
  throw lastError;
}
