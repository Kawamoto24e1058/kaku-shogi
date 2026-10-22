// 共有キャッシュ（Supabase）まわり。API・バックフィルで共用する。スキーマは supabase/schema.sql。
//   public.pieces            … AI生成済みの駒（誰でも読める）
//   public.generation_queue  … AI生成できなかった単語（バックフィル待ち）
// 書き込みは RPC 経由だけで、SUPABASE_SERVER_TOKEN を持つサーバーしか実行できない。
// 起動を軽くするため supabase-js は使わず、PostgREST を fetch で直接呼ぶ。
// 未設定の場合は storeConfigured() が false になり、呼び出し側はキャッシュ無しで動作する。
import type { Json } from './generator.js';

const URL_BASE = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const API_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SERVER_TOKEN = process.env.SUPABASE_SERVER_TOKEN || '';
const TIMEOUT_MS = 8_000;

export function storeConfigured(): boolean {
  return !!(URL_BASE && API_KEY && SERVER_TOKEN);
}

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
      ...init,
      signal: controller.signal,
      headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!res.ok) throw new Error(`supabase ${path.split('?')[0]} returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

const rpc = (name: string, args: Json) => rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

export async function getCachedPiece(key: string): Promise<Json | null> {
  const rows = await rest(`pieces?select=data&key=eq.${encodeURIComponent(key)}&limit=1`) as { data: Json }[];
  return rows[0]?.data ?? null;
}

export async function saveCachedPiece(key: string, piece: Json, meta: { provider: string; backfilled?: boolean }): Promise<void> {
  await rpc('server_save_piece', {
    p_token: SERVER_TOKEN, p_key: key, p_word: String(piece.word ?? key).slice(0, 64),
    p_data: piece, p_provider: meta.provider, p_backfilled: !!meta.backfilled,
  });
}

/**
 * 1日の回数を全サーバー共通で数える（supabase/02_launch_safety.sql の server_consume_quota）。
 * 全部の上限に余裕があれば 0、上限に達したものがあればその番号（1始まり）を返す。
 * DB 側が未設定・障害のときは null（呼び出し側はメモリでの概算に切り替える）
 */
export async function consumeSharedQuota(buckets: string[], limits: number[]): Promise<number | null> {
  if (!storeConfigured()) return null;
  try {
    return await rpc('server_consume_quota', { p_token: SERVER_TOKEN, p_buckets: buckets, p_limits: limits }) as number;
  } catch (err) {
    console.warn('[quota] shared counter unavailable, falling back to memory:', (err as Error).message);
    return null;
  }
}

/** AI生成できなかった単語を待ち行列に積む（何度も要求された単語ほど優先してバックフィルされる） */
export async function enqueueWord(key: string, word: string): Promise<void> {
  await rpc('server_enqueue_word', { p_token: SERVER_TOKEN, p_key: key, p_word: word });
}

export async function listQueue(limit: number): Promise<{ key: string; word: string; requests: number }[]> {
  return await rpc('server_list_queue', { p_token: SERVER_TOKEN, p_limit: limit }) as { key: string; word: string; requests: number }[];
}

export async function deleteQueued(key: string): Promise<void> {
  await rpc('server_delete_queue', { p_token: SERVER_TOKEN, p_key: key });
}

/**
 * 近い単語のAI駒を、入力された単語用に作り替えて返す。
 * 「黒猫」→「猫」のように入力に含まれるキャッシュ語を優先する（探し方は find_similar_key を参照）。
 */
export async function findSimilarPiece(key: string, word: string): Promise<Json | null> {
  const similarKey = await rpc('find_similar_key', { p_key: key }) as string | null;
  if (!similarKey) return null;
  const base = await getCachedPiece(similarKey);
  if (!base) return null;
  const baseWord = typeof base.word === 'string' ? base.word : similarKey;
  const replaceWord = (v: unknown) => (typeof v === 'string' ? v.split(baseWord).join(word) : v);
  return {
    ...base,
    word,
    description: replaceWord(base.description),
    deep_search_analysis: `「${word}」に近い「${baseWord}」のAI駒をもとにしています（AI生成の順番待ち中）。`,
    similarTo: baseWord,
  };
}
