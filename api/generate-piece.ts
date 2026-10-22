// POST /api/generate-piece  { word: string } -> { piece, source }
// LLMのAPIキーはこの関数（サーバー）だけが環境変数で保持する。
// 処理順: 共有キャッシュ → IP単位レート制限 → 全体の1日上限 → LLM（複数プロバイダを順に試す）。
// どれも使えない場合はエラーを返し（ブラウザ側で簡易生成に切り替わる）、単語を待ち行列に積む。
// 待ち行列は scripts/backfill.ts（GitHub Actions で定期実行）がAI生成して共有キャッシュに登録する。
import { createHash } from 'node:crypto';
import { getAdminDb } from './_lib/firebaseAdmin.js';
import { generatePiece, NoProviderError, type Json } from './_lib/generator.js';
import { enqueueWord, findSimilarPiece, getCachedPiece, saveCachedPiece } from './_lib/pieceCache.js';
import { wordKey } from '../shared/wordKey.js';

const MAX_WORD_LENGTH = 24;
const PER_IP_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR || 10);
const GLOBAL_PER_DAY = Number(process.env.GLOBAL_DAILY_LIMIT || 1000);

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
  if (word.includes('/') || /^__.*__$/.test(word)) return null;
  const key = wordKey(word);
  if (key.length === 0 || key === '.' || key === '..') return null;
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

// 同じ単語への同時リクエストは1回の生成を共有する（流行りの単語が一斉に入力されたときの無駄打ちを防ぐ）。
// 完了後もしばらく結果を残し、キャッシュ確認とほぼ同時に届いた後続リクエストも二重に生成しないようにする。
const SHARED_RESULT_TTL_MS = 60_000;
const inFlight = new Map<string, Promise<{ piece: Json; provider: string }>>();

function generateShared(key: string, word: string) {
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const result = await generatePiece(word);
      const db = await getAdminDb();
      if (db) {
        await saveCachedPiece(db, key, result.piece, { provider: result.provider })
          .catch(err => console.warn('[generate-piece] cache write failed:', err));
      }
      return result;
    })();
    const entry = pending;
    inFlight.set(key, entry);
    entry.then(
      () => {
        const timer = setTimeout(() => { if (inFlight.get(key) === entry) inFlight.delete(key); }, SHARED_RESULT_TTL_MS);
        // このタイマーのためにプロセスの終了を待たせない
        (timer as unknown as { unref?: () => void }).unref?.();
      },
      () => { if (inFlight.get(key) === entry) inFlight.delete(key); },
    );
  }
  return pending;
}

/**
 * AI生成できなかったときの代替。単語を待ち行列に積み（後でバックフィルがAI版を作る）、
 * 近い単語のAI駒があればそれを流用して返す。無ければエラーを返し、ブラウザ側の簡易生成に任せる。
 */
async function fallbackResponse(key: string, word: string, status: number, reason: string): Promise<Response> {
  const db = await getAdminDb();
  if (db) {
    try {
      await enqueueWord(db, key, word);
      const similar = await findSimilarPiece(db, key, word);
      if (similar) {
        return json(200, {
          piece: similar,
          source: 'similar',
          notice: `${reason}、近い言葉「${similar.similarTo}」のAI駒をもとに作成しました。「${word}」のAI版は後で登録されます。`,
        });
      }
    } catch (err) {
      console.warn('[generate-piece] fallback lookup failed:', err);
    }
  }
  return json(status, { error: `${reason}、簡易生成で作成しました。${db ? '「' + word + '」のAI版は後で登録されます。' : ''}`, queued: !!db });
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

  const key = wordKey(word);
  // 同じ単語を生成中・生成直後なら、その結果を使う（回数制限も消費しない）
  const shared = inFlight.get(key);
  if (shared) {
    try {
      const { piece } = await shared;
      return json(200, { piece: { ...piece, word }, source: 'cache' });
    } catch {
      // 共有元が失敗した場合は通常の流れで処理する
    }
  }

  const db = await getAdminDb();
  try {
    const cached = db ? await getCachedPiece(db, key) : null;
    if (cached) return json(200, { piece: { ...cached, word }, source: 'cache' });
  } catch (err) {
    console.warn('[generate-piece] cache read failed:', err);
  }

  const quota = await consumeQuota(clientIp(request)).catch(err => {
    console.warn('[generate-piece] quota check failed:', err);
    return 'ok' as const;
  });
  if (quota === 'ip') return fallbackResponse(key, word, 429, 'AI生成の回数制限に達したため');
  if (quota === 'global') return fallbackResponse(key, word, 429, '本日のAI生成枠が混雑しているため');

  try {
    const { piece } = await generateShared(key, word);
    return json(200, { piece: { ...piece, word }, source: 'ai' });
  } catch (err) {
    if (err instanceof NoProviderError) {
      return json(503, { error: 'AI生成サーバーが未設定のため、簡易生成で作成しました。' });
    }
    console.error('[generate-piece] all providers failed:', (err as Error).message);
    return fallbackResponse(key, word, 502, 'AIが混雑しているため');
  }
}

export default { fetch: handleGeneratePiece };
