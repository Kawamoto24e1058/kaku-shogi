// GET  /api/generate-piece?k=<wordKey> -> { piece } | 404   … 共有キャッシュの参照（CDNでキャッシュされる）
// POST /api/generate-piece  { word: string } -> { piece, source }
//      Accept: application/x-ndjson を付けると、AIが書いている途中の駒も順に送る（streamGeneratePiece）
// LLMのAPIキーはこの関数（サーバー）だけが環境変数で保持する。
// 処理順: 共有キャッシュ → IP単位レート制限 → 全体の1日上限 → LLM（複数プロバイダを順に試す）。
// バズ時に Supabase の無料枠（転送量 5GB/月）を使い切らないよう、
// キャッシュ済みの駒は GET + CDN キャッシュで返し、回数制限はメモリ上で数える。
// どれも使えない場合はエラーを返し（ブラウザ側で簡易生成に切り替わる）、単語を待ち行列に積む。
// 待ち行列は worker/index.ts の Cron Trigger（1日1回）がAI生成して共有キャッシュに登録する。
import { createHash, timingSafeEqual } from 'node:crypto';
import { configuredProviders, generatePiece, isQuotaExhausted, NoProviderError, type Json, type OnRawStream } from './_lib/generator.js';
import { consumeSharedQuota, enqueueWord, findSimilarPiece, getCachedPiece, saveCachedPiece, storeConfigured } from './_lib/pieceCache.js';
import { wordKey } from '../shared/wordKey.js';
import { containsNgWord, pieceHasNgText, setExtraNgWords } from '../shared/moderation.js';
import { featureFlags } from './_lib/flags.js';
import { lookupReferences } from './_lib/reference.js';
import { normalizeFusionWord } from '../shared/challenge.js';
import { extractPartialPiece, type PartialPiece } from '../shared/partialPiece.js';

setExtraNgWords((process.env.NG_WORDS || '').split(','));

const MAX_WORD_LENGTH = 24;
const PER_IP_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR || 10);
const PER_IP_PER_DAY = Number(process.env.RATE_LIMIT_PER_DAY || 40);
const PER_DEVICE_PER_DAY = Number(process.env.RATE_LIMIT_PER_DEVICE_PER_DAY || 30);
const GLOBAL_PER_DAY = Number(process.env.GLOBAL_DAILY_LIMIT || 1000);
// 関数の上限（vercel.json の maxDuration: 30秒）より前に AI を諦め、近い単語の流用・待ち行列への登録まで済ませて応答する
const AI_BUDGET_MS = 22_000;

const json = (status: number, body: Json) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** 入力単語の正規化と検証 */
export function normalizeWord(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const word = normalizeFusionWord(raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim());
  if (word.length === 0 || [...word].length > MAX_WORD_LENGTH) return null;
  if (word.includes('/') || /^__.*__$/.test(word)) return null;
  const key = wordKey(word);
  if (key.length === 0 || key === '.' || key === '..') return null;
  return word;
}

function clientIp(request: Request): string {
  // Cloudflare は接続元のIPを CF-Connecting-IP に入れる（利用者が書き換えられない）
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const fwd = request.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0] : request.headers.get('x-real-ip') || 'unknown').trim();
}

function isAllowedOrigin(request: Request): boolean {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  const origin = request.headers.get('origin');
  return !origin || allowed.includes(origin);
}

// メモリ上の簡易レート制限（インスタンス単位なので目安。LLMはすべて無料枠で、超えても課金されないため概算で十分）
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

/** 予備AIの動作確認（x-kaku-test-provider: fallback と、サーバー用トークンの一致が必要） */
function isProviderTest(request: Request, mode = 'fallback'): boolean {
  if (request.headers.get('x-kaku-test-provider') !== mode) return false;
  const token = process.env.SUPABASE_SERVER_TOKEN || '';
  const given = Buffer.from(request.headers.get('x-kaku-test-token') || '');
  const expected = Buffer.from(token);
  return token.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
}

const hashId = (value: string) => createHash('sha256').update(`kaku-shogi:${value}`).digest('hex').slice(0, 32);

/** ブラウザが送る端末ID（localStorage に保存したランダムな文字列）。形式が違えば使わない */
function deviceId(request: Request): string | null {
  const raw = request.headers.get('x-kaku-device') || '';
  return /^[A-Za-z0-9_-]{6,64}$/.test(raw) ? raw : null;
}

/**
 * AI生成の回数制限。AI を実際に呼ぶとき（キャッシュに無い単語）だけ数える。
 * 1. 1時間あたりの IP ごとの上限（メモリ。サーバーのインスタンスごとの目安で、DB に触れずに連打を弾く）
 * 2. 1日あたりの IP ごと・端末ごと・サイト全体の上限（Supabase で全インスタンス共通に数える）
 *    DB 側が未設定・障害のときはメモリでの概算に切り替える
 * 端末IDは消せば作り直せるので、主な守りは IP の上限。端末IDは同じ回線（学校・会社など）の人を巻き込みにくくするための補助
 */
async function consumeQuota(request: Request): Promise<'ok' | 'ip' | 'global'> {
  const ipHash = hashId(clientIp(request));
  if (!memoryRateLimit(`ip:${ipHash}`, PER_IP_PER_HOUR, 3_600_000)) return 'ip';
  const day = new Date().toISOString().slice(0, 10);
  const device = deviceId(request);
  const buckets = [`global:${day}`, `ip:${ipHash}:${day}`, ...(device ? [`dev:${hashId(device)}:${day}`] : [])];
  const limits = [GLOBAL_PER_DAY, PER_IP_PER_DAY, ...(device ? [PER_DEVICE_PER_DAY] : [])];
  const exceeded = await consumeSharedQuota(buckets, limits);
  if (exceeded === null) {
    if (!memoryRateLimit(`ipday:${ipHash}`, PER_IP_PER_DAY, 86_400_000)) return 'ip';
    if (!memoryRateLimit('global', GLOBAL_PER_DAY, 86_400_000)) return 'global';
    return 'ok';
  }
  if (exceeded === 1) return 'global';
  return exceeded === 0 ? 'ok' : 'ip';
}

// 同じ単語への同時リクエストは1回の生成を共有する（流行りの単語が一斉に入力されたときの無駄打ちを防ぐ）。
// 完了後もしばらく結果を残し、キャッシュ確認とほぼ同時に届いた後続リクエストも二重に生成しないようにする。
const SHARED_RESULT_TTL_MS = 60_000;
const inFlight = new Map<string, Promise<{ piece: Json; provider: string }>>();

class ModerationError extends Error {}

type OnPartial = (partial: PartialPiece) => void;

/**
 * AIの途中経過から、書き終わった項目だけを onPartial に渡す。同じ内容は送らず、不適切な表現を含むものも送らない
 */
function partialRelay(onPartial: OnPartial) {
  let last = '';
  let checkedLength = 0;
  let complete = false;
  return (text: string) => {
    // 無料プランの CPU 時間（1回 10ms 程度）に収めるため、読み直す回数を絞る:
    // 表示に使う5項目がそろったら以後は何もしない。値が閉じうる文字（" } ]）が届いたときだけ読み直す
    if (complete) return;
    const added = text.slice(checkedLength);
    checkedLength = text.length;
    if (!/["}\]]/.test(added)) return;
    const partial = extractPartialPiece(text);
    complete = !!(partial.deep_search_analysis && partial.effect_name && partial.ability_genre && partial.description && partial.appearance && partial.range_geometry);
    const serialized = JSON.stringify(partial);
    if (serialized === '{}' || serialized === last || pieceHasNgText(partial as Json)) return;
    last = serialized;
    onPartial(partial);
  };
}

function generateShared(key: string, word: string, deadline: number, onPartial?: OnPartial, onRaw?: OnRawStream, reference?: Promise<string | null>) {
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const result = await generatePiece(word, undefined, deadline, onPartial ? partialRelay(onPartial) : undefined, onRaw, await reference);
      if (pieceHasNgText(result.piece)) {
        // 不適切な文章を含む結果は使わず、キャッシュもしない（ブラウザ側で簡易生成になる）
        throw new ModerationError(`generated text for "${word}" was blocked`);
      }
      if (storeConfigured()) {
        await saveCachedPiece(key, result.piece, { provider: result.provider })
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
 * 近い単語のAI駒があればそれを流用して返す。無ければエラーと一緒に参考情報（Wikipedia の要約）を返し、
 * ブラウザ側の簡易生成が単語の意味に合う能力型を選べるようにする。
 */
async function fallbackResponse(key: string, word: string, status: number, reason: string, reference?: Promise<string | null>): Promise<Response> {
  const queued = storeConfigured();
  const ref = reference ? await reference.catch(() => null) : null;
  if (queued) {
    try {
      await enqueueWord(key, word);
      const similar = await findSimilarPiece(key, word);
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
  return json(status, {
    error: `${reason}、仮の駒（簡易生成）で作成しました。${queued ? '「' + word + '」のAI版は後で自動で登録されます。' : ''}`,
    queued,
    ...(ref ? { reference: ref } : {}),
  });
}

/**
 * 共有キャッシュの参照。同じ単語への2回目以降のアクセスは Vercel の CDN が返すので、
 * 関数の実行も Supabase への問い合わせも発生しない（キーは表記ゆれを吸収した wordKey）。
 */
async function lookupCached(k: string): Promise<Response> {
  const notFound = () => new Response(JSON.stringify({ error: 'not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=60' },
  });
  if (k.length > 64 || k !== wordKey(k) || containsNgWord(k) || !storeConfigured()) return notFound();
  try {
    const cached = await getCachedPiece(k);
    if (!cached) return notFound();
    return new Response(JSON.stringify({ piece: cached, source: 'cache' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // 報告で消された駒が長く残らないよう、CDN には1日だけ置く
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600',
      },
    });
  } catch (err) {
    console.warn('[generate-piece] cache lookup failed:', err);
    return notFound();
  }
}

export async function handleGeneratePiece(request: Request, waitUntil?: (task: Promise<unknown>) => void): Promise<Response> {
  if (request.method === 'POST' && (request.headers.get('accept') || '').includes('application/x-ndjson')) {
    return streamGeneratePiece(request, waitUntil);
  }
  return handleRequest(request);
}

/**
 * 途中経過つきの生成。次の行が順に届く（ブラウザ側は src/aiGenerator.ts の readGenerateStream）:
 *   {"type":"reset"}                         … AIの出力が（最初から／再試行で）始まる
 *   data: {...}                              … AIの出力そのもの（Server-Sent Events）。Worker では JavaScript を通さずに流す
 *   {"type":"partial","piece":{...}}         … AIの出力を JavaScript で読める環境（Vercel など）での途中経過
 *   {"type":"done","status":200,"body":{...}} … 最後に1回。中身は通常の応答と同じ
 * AIの出力を塊ごとに解析すると、Workers の無料プランの CPU 時間（1回 10ms 程度）を大きく超えるため、
 * 途中経過の解析はブラウザに任せている。
 */
function streamGeneratePiece(request: Request, waitUntil?: (task: Promise<unknown>) => void): Response {
  // Workers の IdentityTransformStream はバイト列をそのまま流す（JavaScript を通らない）。無い環境では標準の TransformStream
  const Identity = (globalThis as { IdentityTransformStream?: new () => TransformStream<Uint8Array, Uint8Array> }).IdentityTransformStream;
  const { readable, writable } = Identity ? new Identity() : new TransformStream<Uint8Array, Uint8Array>();
  const encoder = new TextEncoder();
  // 書き込みは順番に行う（AIの出力を流している間は、その完了を待ってから次の行を書く）
  let chain: Promise<void> = Promise.resolve();
  const writeLine = (line: Json) => {
    chain = chain.then(async () => {
      const writer = writable.getWriter();
      try {
        await writer.write(encoder.encode(`\n${JSON.stringify(line)}\n`));
      } finally {
        writer.releaseLock();
      }
    });
  };
  const pipeRaw: OnRawStream = stream => {
    writeLine({ type: 'reset' });
    chain = chain
      .then(() => stream.pipeTo(writable, { preventClose: true, preventAbort: true }))
      .catch(err => console.warn('[generate-piece] relay interrupted:', (err as Error).message));
  };
  const task = (async () => {
    try {
      const res = await handleRequest(request, piece => writeLine({ type: 'partial', piece: piece as Json }), pipeRaw);
      writeLine({ type: 'done', status: res.status, body: await res.json().catch(() => ({})) as Json });
    } catch (err) {
      console.error('[generate-piece] stream failed:', (err as Error).message);
      writeLine({ type: 'done', status: 500, body: { error: 'AI生成サーバーでエラーが起きたため、簡易生成で作成しました。' } });
    }
    await chain.catch(() => undefined);
    await writable.close().catch(() => undefined);
  })();
  // 利用者が途中で画面を閉じても、生成と共有キャッシュへの保存は最後まで行う
  waitUntil?.(task);
  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}

async function handleRequest(request: Request, onPartial?: OnPartial, onRaw?: OnRawStream): Promise<Response> {
  const startedAt = Date.now();
  // 運営者の動作確認用: 予備AIで使えるモデルの一覧（サーバー用トークンが必要）
  if (request.method === 'POST' && isProviderTest(request, 'models')) {
    const res = await fetch(`${(process.env.FALLBACK_LLM_BASE_URL || '').replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${process.env.FALLBACK_LLM_API_KEY || ''}` },
    });
    const data = await res.json().catch(() => ({})) as { data?: { id: string; active?: boolean; context_window?: number }[] };
    return json(res.status, { models: (data.data ?? []).map(m => m.id).sort() });
  }
  if (request.method === 'GET') {
    const k = new URL(request.url).searchParams.get('k');
    if (!k) {
      // ウォームアップ用: 関数のインスタンスを先に起こしておく
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }
    return lookupCached(k);
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
  if (containsNgWord(word)) return json(400, { error: 'その単語は使えません。別の単語を入力してください。', blocked: true });

  const key = wordKey(word);
  // 運営者の動作確認用: 予備のAIだけで生成する（共有キャッシュは読まず、保存もしない）。
  // サーバー用トークンを知っている人だけが使える
  if (isProviderTest(request)) {
    const reference = await lookupReferences([word]).then(refs => refs[0]).catch(() => null);
    const providers = configuredProviders().filter(p => p.name.startsWith('fallback:'));
    try {
      const { piece, provider } = await generatePiece(word, providers, startedAt + AI_BUDGET_MS,
        onPartial ? partialRelay(onPartial) : undefined, onRaw, reference);
      return json(200, { piece: { ...piece, word }, source: 'ai', provider });
    } catch (err) {
      return json(502, { error: (err as Error).message.slice(0, 300) });
    }
  }
  // 元ネタの参考情報（Wikipedia）は、キャッシュ確認・回数制限と並行して調べておく
  const reference = inFlight.has(key) ? undefined : lookupReferences([word]).then(refs => refs[0]).catch(() => null);
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

  try {
    const cached = storeConfigured() ? await getCachedPiece(key) : null;
    if (cached) return json(200, { piece: { ...cached, word }, source: 'cache' });
  } catch (err) {
    console.warn('[generate-piece] cache read failed:', err);
  }

  // 緊急スイッチ: AI生成を止めている間は、キャッシュ・近い単語・簡易生成だけで動かす
  if (!featureFlags().aiGeneration) return fallbackResponse(key, word, 503, '現在AI生成を一時停止しているため', reference);

  const quota = await consumeQuota(request);
  if (quota === 'ip') return fallbackResponse(key, word, 429, 'AI生成の回数制限に達したため', reference);
  if (quota === 'global') return fallbackResponse(key, word, 429, '本日のAI生成枠が混雑しているため', reference);

  try {
    const { piece } = await generateShared(key, word, startedAt + AI_BUDGET_MS, onPartial, onRaw, reference);
    return json(200, { piece: { ...piece, word }, source: 'ai' });
  } catch (err) {
    if (err instanceof ModerationError) {
      return json(422, { error: '生成された能力に不適切な表現が含まれていたため、簡易生成で作成しました。' });
    }
    if (err instanceof NoProviderError) {
      return json(503, { error: 'AI生成サーバーが未設定のため、簡易生成で作成しました。' });
    }
    console.error('[generate-piece] all providers failed:', (err as Error).message);
    return fallbackResponse(key, word, 502, isQuotaExhausted(err) ? '本日の無料AI枠を使い切ったため' : 'AIが混雑しているため', reference);
  }
}

export default { fetch: handleGeneratePiece };
