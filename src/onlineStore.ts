// オンライン対戦のデータ保存（Supabase）。スキーマと権限は supabase/schema.sql。
// - ブラウザは対戦データを「読む」ことしかできず、書き込みはすべて RPC（create_match / update_match など）経由。
// - 匿名ログインの代わりに、タブごとにランダムな秘密の文字列を作り、DB にはそのハッシュだけを保存する。
//   部屋を作った人・入室した人だけが、その対戦を書き換えられる。
// - 無料枠（転送量 5GB/月、Realtime の1件 1MB まで）に収まるよう、大きな項目は gzip して保存する。
// - Realtime の同時接続（無料枠 200）を超えたときは、変更があったときだけ取得するポーリングに切り替える。
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Vite 以外（テストやスクリプト）から読み込まれても落ちないようにする
const env: Partial<ImportMetaEnv> = import.meta.env ?? {};
const SUPABASE_URL = env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

/** 未設定の間はオンライン対戦を「準備中」として無効化する */
export const onlineConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!onlineConfigured) throw new OnlineError('unconfigured', 'オンライン対戦は準備中です。');
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export type OnlineErrorCode = 'unconfigured' | 'quota' | 'network' | 'forbidden' | 'unknown';
export class OnlineError extends Error {
  readonly code: OnlineErrorCode;
  constructor(code: OnlineErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function toOnlineError(err: { message?: string; code?: string; status?: number } | null | undefined): OnlineError {
  const message = err?.message || 'unknown error';
  const status = err?.status;
  if (status === 402 || status === 429 || /quota|exceed|too many/i.test(message)) return new OnlineError('quota', message);
  if (status === 401 || status === 403 || err?.code === '42501') return new OnlineError('forbidden', message);
  if (/fetch|network|timeout/i.test(message)) return new OnlineError('network', message);
  return new OnlineError('unknown', message);
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

/** タブごとの値（再読み込みしても同じ。別タブは別のプレイヤーとして扱う） */
function tabValue(name: string, make: () => string): string {
  try {
    let value = sessionStorage.getItem(name);
    if (!value) {
      value = make();
      sessionStorage.setItem(name, value);
    }
    return value;
  } catch {
    return (memoryValues[name] ??= make());
  }
}
const memoryValues: Record<string, string> = {};
const playerSecret = () => tabValue('kaku_player_secret', () => randomHex(24));
/** ランダムマッチの待ち行列での自分の ID */
export const playerId = () => tabValue('kaku_player_id', () => randomHex(8));

// ===== 大きな項目の圧縮 =====
const COMPRESS_PREFIX = 'gz1:';
const COMPRESS_MIN_LENGTH = 1500;
// 盤面・駒データなど。logs は DB 側で末尾に追加するため圧縮しない
const COMPRESSED_KEYS = new Set([
  'board', 'customPieces', 'sentePieces', 'gotePieces', 'customDecksJson',
  'destroyedPiecesJson', 'capturedPieces', 'sharedPieces', 'tileBoardJson',
]);
const canCompress = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function gzipBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function gunzipBase64(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export type MatchData = Record<string, unknown>;

export async function encode(patch: MatchData): Promise<MatchData> {
  const out: MatchData = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const json = JSON.stringify(value);
    out[key] = canCompress && COMPRESSED_KEYS.has(key) && json.length >= COMPRESS_MIN_LENGTH
      ? COMPRESS_PREFIX + await gzipBase64(json)
      : JSON.parse(json);
  }
  return out;
}

export async function decode(data: MatchData): Promise<MatchData> {
  const out: MatchData = { ...data };
  await Promise.all(Object.entries(data).map(async ([key, value]) => {
    if (typeof value === 'string' && value.startsWith(COMPRESS_PREFIX)) {
      out[key] = JSON.parse(await gunzipBase64(value.slice(COMPRESS_PREFIX.length)));
    }
  }));
  return out;
}

// 長い対局で対戦データが大きくなりすぎないよう、保存するログは直近の分だけにする
const MAX_LOGS = 150;
export const trimLogs = <T,>(logs: T[]): T[] => (logs.length > MAX_LOGS ? logs.slice(-MAX_LOGS) : logs);

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error, status } = await supabase().rpc(fn, args);
  if (error) throw toOnlineError({ ...error, status });
  return data as T;
}

// ===== 対戦 =====
export async function getMatch(code: string): Promise<{ data: MatchData; updatedAt: string } | null> {
  const { data, error, status } = await supabase().from('matches').select('data, updated_at').eq('code', code).maybeSingle();
  if (error) throw toOnlineError({ ...error, status });
  return data ? { data: await decode(data.data as MatchData), updatedAt: data.updated_at as string } : null;
}

/** 新しい部屋を作る。空いている6桁のコードを返す */
export async function createMatch(build: (code: string) => MatchData): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(100000 + Math.floor(Math.random() * 900000));
    if (await call<boolean>('create_match', { p_code: code, p_secret: playerSecret(), p_data: await encode(build(code)) })) return code;
  }
  throw new OnlineError('unknown', '部屋コードの生成に失敗しました。もう一度お試しください。');
}

/** 後手として入室する。満室・存在しない場合は false */
export async function joinMatch(code: string, patch: MatchData, logs?: unknown[]): Promise<boolean> {
  return call<boolean>('join_match', { p_code: code, p_secret: playerSecret(), p_patch: await encode(patch), p_logs: logs ?? null });
}

/** patch の項目を上書きし、appendLogs をログの末尾に追加する（相手の書き込みとぶつかってもログが消えない） */
export async function updateMatch(code: string, patch: MatchData, appendLogs?: unknown[]): Promise<void> {
  const ok = await call<boolean>('update_match', { p_code: code, p_secret: playerSecret(), p_patch: await encode(patch), p_logs: appendLogs ?? null });
  if (!ok) throw new OnlineError('forbidden', 'この対局を更新する権限がありません。');
}

export async function deleteMatch(code: string): Promise<void> {
  await call<boolean>('delete_match', { p_code: code, p_secret: playerSecret() });
}

// ===== ランダムマッチ =====
/** 待っている人がいればその部屋コードを返す（同時に1人だけが取れる） */
export async function takeWaitingMatch(): Promise<string | null> {
  return call<string | null>('take_waiting_match', { p_exclude_id: playerId() });
}

export async function enqueueMatch(roomCode: string): Promise<void> {
  await call<boolean>('enqueue_match', { p_id: playerId(), p_secret: playerSecret(), p_room_code: roomCode });
}

export async function dequeueMatch(): Promise<void> {
  await call<null>('dequeue_match', { p_id: playerId(), p_secret: playerSecret() });
}

// ===== 変更の購読 =====
const POLL_INTERVAL_MS = 2500;

/**
 * 対戦データの変更を受け取る。Realtime が使えないとき（同時接続の上限など）は、
 * updated_at が進んだときだけ取得するポーリングで代わりに受け取る。戻り値は購読の解除関数。
 */
export function subscribeMatch(code: string, onData: (data: MatchData) => void): () => void {
  let stopped = false;
  let lastUpdatedAt = '';
  let chain = Promise.resolve();
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  // 受け取った順に展開して反映する（展開は非同期なので、古いデータで上書きしないように直列にする）
  const deliver = (raw: MatchData, updatedAt: string) => {
    chain = chain.then(async () => {
      if (stopped || (lastUpdatedAt && updatedAt <= lastUpdatedAt)) return;
      const data = await decode(raw);
      if (stopped) return;
      lastUpdatedAt = updatedAt;
      onData(data);
    }).catch(err => console.warn('[online] failed to apply match data:', err));
  };

  const fetchLatest = async () => {
    let request = supabase().from('matches').select('data, updated_at').eq('code', code);
    if (lastUpdatedAt) request = request.gt('updated_at', lastUpdatedAt);
    const { data } = await request.maybeSingle();
    if (data) deliver(data.data as MatchData, data.updated_at as string);
  };

  const startPolling = () => {
    if (pollTimer || stopped) return;
    const tick = async () => {
      await fetchLatest().catch(err => console.warn('[online] polling failed:', err));
      if (!stopped) pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
  };

  const channel = supabase()
    .channel(`match:${code}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `code=eq.${code}` }, payload => {
      const row = payload.new as { data?: MatchData; updated_at?: string };
      // 1件が上限（1MB）を超えると大きな項目が省かれて届くので、そのときは取り直す
      if (row.data && row.updated_at) deliver(row.data, row.updated_at);
      else fetchLatest().catch(err => console.warn('[online] refetch failed:', err));
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        // 購読開始までの間に起きた変更を取りこぼさないよう、一度取り直す
        fetchLatest().catch(() => undefined);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (!stopped) startPolling();
      }
    });

  return () => {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    supabase().removeChannel(channel).catch(() => undefined);
  };
}
