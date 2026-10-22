// POST /api/generate-piece  { word: string } -> { piece, source }
// Gemini APIキーはこの関数（サーバー）だけが環境変数で保持する。
// 無料枠を守るため、共有キャッシュ → IP単位レート制限 → 全体の1日上限 の順にチェックしてから Gemini を呼ぶ。
import { createHash } from 'node:crypto';
import { buildPrompt } from './_lib/prompt.js';
import { PIECE_RESPONSE_SCHEMA } from './_lib/pieceSchema.js';
import { getAdminDb } from './_lib/firebaseAdmin.js';

const MAX_WORD_LENGTH = 24;
const PER_IP_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR || 10);
const GLOBAL_PER_DAY = Number(process.env.GLOBAL_DAILY_LIMIT || 200);
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite';
// 思考(thinking)はJSON生成の待ち時間を大きく伸ばすため既定でオフ。品質を優先したい場合は 512 などに上げる
const THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);
const MAX_OUTPUT_TOKENS = 2048;
const GEMINI_TIMEOUT_MS = 25_000;

type Json = Record<string, unknown>;

const json = (status: number, body: Json) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** 入力単語の正規化と検証。Firestore のドキュメントIDとしても安全な文字列だけを通す */
export function normalizeWord(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const word = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (word.length === 0 || [...word].length > MAX_WORD_LENGTH) return null;
  if (word.includes('/') || word === '.' || word === '..' || /^__.*__$/.test(word)) return null;
  return word;
}

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0] : request.headers.get('x-real-ip') || 'unknown').trim();
}

function isAllowedOrigin(request: Request): boolean {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  const origin = request.headers.get('origin');
  return !origin || allowed.includes(origin);
}

// Firestore が未設定のとき用の簡易レート制限（インスタンス単位なので目安）
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();
function memoryRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

async function consumeQuota(ip: string): Promise<'ok' | 'ip' | 'global'> {
  const ipHash = createHash('sha256').update(`kaku-shogi:${ip}`).digest('hex').slice(0, 32);
  const hour = new Date().toISOString().slice(0, 13);
  const day = hour.slice(0, 10);
  const db = await getAdminDb();
  if (!db) {
    if (!memoryRateLimit(`ip:${ipHash}`, PER_IP_PER_HOUR, 3_600_000)) return 'ip';
    if (!memoryRateLimit('global', GLOBAL_PER_DAY, 86_400_000)) return 'global';
    return 'ok';
  }
  const ipRef = db.collection('rate_limits').doc(`ip_${ipHash}_${hour}`);
  const globalRef = db.collection('rate_limits').doc(`global_${day}`);
  return db.runTransaction(async tx => {
    const [ipSnap, globalSnap] = await Promise.all([tx.get(ipRef), tx.get(globalRef)]);
    const ipCount = (ipSnap.get('count') as number | undefined) ?? 0;
    const globalCount = (globalSnap.get('count') as number | undefined) ?? 0;
    if (ipCount >= PER_IP_PER_HOUR) return 'ip';
    if (globalCount >= GLOBAL_PER_DAY) return 'global';
    // expiresAt は Firestore の TTL ポリシー用（コンソールで rate_limits.expiresAt に設定すると自動削除される）
    const expiresAt = new Date(Date.now() + 2 * 86_400_000);
    tx.set(ipRef, { count: ipCount + 1, expiresAt }, { merge: true });
    tx.set(globalRef, { count: globalCount + 1, expiresAt }, { merge: true });
    return 'ok';
  });
}

async function callGemini(model: string, word: string, apiKey: string, useSchema = true): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
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
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`Gemini ${model} returned ${res.status}: ${detail.slice(0, 300)}`), { status: res.status });
    }
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!text) throw new Error(`Gemini ${model} returned an empty response`);
    return JSON.parse(text) as Json;
  } finally {
    clearTimeout(timer);
  }
}

async function generate(word: string, apiKey: string): Promise<Json> {
  try {
    return await callGemini(PRIMARY_MODEL, word, apiKey);
  } catch (err) {
    // スキーマが受け付けられない(400)場合はJSONモードのみで再試行（結果はクライアントのサニタイザで補正される）
    if ((err as { status?: number }).status === 400) {
      console.warn('[generate-piece] schema rejected, retrying without responseSchema:', (err as Error).message);
      return callGemini(PRIMARY_MODEL, word, apiKey, false);
    }
    // 混雑(429/503)・モデル廃止(404)などは軽量モデルで1回だけ再試行
    if (!FALLBACK_MODEL || FALLBACK_MODEL === PRIMARY_MODEL) throw err;
    console.warn('[generate-piece] primary model failed, falling back:', (err as Error).message);
    return callGemini(FALLBACK_MODEL, word, apiKey);
  }
}

export async function handleGeneratePiece(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    // ウォームアップ用: インスタンスと Firestore 接続を先に用意しておく
    await getAdminDb();
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }
  if (request.method !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!isAllowedOrigin(request)) return json(403, { error: 'Forbidden' });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'リクエスト形式が不正です。' });
  }
  const word = normalizeWord((body as Json | null)?.word);
  if (!word) return json(400, { error: `単語は1〜${MAX_WORD_LENGTH}文字で入力してください（「/」は使えません）。` });

  const db = await getAdminDb();
  const cacheRef = db?.collection('custom_pieces').doc(word);
  try {
    const cached = await cacheRef?.get();
    if (cached?.exists) return json(200, { piece: cached.data() as Json, source: 'cache' });
  } catch (err) {
    console.warn('[generate-piece] cache read failed:', err);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(503, { error: 'AI生成サーバーが未設定のため、簡易生成で作成しました。' });

  const quota = await consumeQuota(clientIp(request)).catch(err => {
    console.warn('[generate-piece] quota check failed:', err);
    return 'ok' as const;
  });
  if (quota === 'ip') return json(429, { error: 'AI生成の回数制限に達しました。少し時間をおいてお試しください（今回は簡易生成で作成しました）。' });
  if (quota === 'global') return json(429, { error: '本日のAI生成枠を使い切りました。明日また試してください（今回は簡易生成で作成しました）。' });

  try {
    const piece = await generate(word, apiKey);
    piece.word = word;
    try {
      await cacheRef?.set({ ...piece, createdAt: Date.now() });
    } catch (err) {
      console.warn('[generate-piece] cache write failed:', err);
    }
    return json(200, { piece, source: 'ai' });
  } catch (err) {
    console.error('[generate-piece] generation failed:', err);
    const status = (err as { status?: number }).status;
    return json(502, {
      error: status === 429
        ? 'AIが混雑しているため、簡易生成で作成しました。'
        : 'AI生成に失敗したため、簡易生成で作成しました。',
    });
  }
}

export default { fetch: handleGeneratePiece };
