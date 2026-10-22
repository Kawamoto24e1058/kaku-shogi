// 共有キャッシュのバックフィル（api/backfill.ts の Vercel Cron と scripts/backfill.ts で共用）
// 1. 利用者がAI生成できなかった単語（generation_queue）を要求回数の多い順に
// 2. 余った枠で事前生成用の単語（shared/seedWords.ts）を
// AI生成して共有キャッシュに登録する。1回の呼び出しで batch 語をまとめて生成するので、
// 1日の「回数」上限に対して何倍もの単語を登録できる。無料枠の上限に達したら静かに終了する。
import { configuredProviders, generatePieces } from './generator.js';
import { deleteQueued, getCachedPiece, listQueue, saveCachedPiece, storeConfigured } from './pieceCache.js';
import { SEED_WORDS } from '../../shared/seedWords.js';
import { wordKey } from '../../shared/wordKey.js';
import { containsNgWord, pieceHasNgText } from '../../shared/moderation.js';
import { dailyKey, dailyWords } from '../../shared/challenge.js';

export interface BackfillOptions {
  /** 1回の実行で登録する最大語数 */
  limit: number;
  /** 1回の呼び出しでまとめる語数 */
  batch: number;
  /** 呼び出し間隔（分あたりの上限に当たらないように空ける） */
  intervalMs: number;
  /** この時刻（Date.now()）を過ぎたら次のまとまりを始めない */
  deadline?: number;
  log?: (message: string) => void;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runBackfill({ limit, batch, intervalMs, deadline = Infinity, log = console.log }: BackfillOptions): Promise<number> {
  if (!storeConfigured()) throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVER_TOKEN are not set');
  const providers = configuredProviders();
  if (providers.length === 0) throw new Error('no LLM provider is configured');

  // 候補: 待ち行列（要求回数の多い順）→ 事前生成リスト。キーで重複を除き、キャッシュ済みは飛ばす
  const candidates = new Map<string, string>();
  // 今日と明日の「今日のお題」（合体駒は毎日1つ新しくなる）を最優先で用意しておく
  const tomorrow = dailyKey(new Date(Date.now() + 86_400_000));
  for (const word of [...dailyWords(), ...dailyWords(tomorrow)]) candidates.set(wordKey(word), word);
  for (const q of await listQueue(limit * 2)) if (!candidates.has(q.key)) candidates.set(q.key, q.word || q.key);
  for (const word of SEED_WORDS) if (!candidates.has(wordKey(word))) candidates.set(wordKey(word), word);

  const todo: { key: string; word: string }[] = [];
  for (const [key, word] of candidates) {
    if (todo.length >= limit) break;
    if (containsNgWord(word) || await getCachedPiece(key)) {
      await deleteQueued(key);
      continue;
    }
    todo.push({ key, word });
  }

  let generated = 0;
  let consecutiveFailures = 0;
  for (let i = 0; i < todo.length && Date.now() < deadline; i += batch) {
    if (i > 0) await sleep(intervalMs);
    const chunk = todo.slice(i, i + batch);
    try {
      const { pieces, provider } = await generatePieces(chunk.map(c => c.word), providers);
      for (const [j, piece] of pieces.entries()) {
        if (!piece) continue;
        if (pieceHasNgText(piece)) {
          log(`skipped (moderation): ${chunk[j].word}`);
          continue;
        }
        await saveCachedPiece(chunk[j].key, piece, { provider, backfilled: true });
        generated++;
      }
      consecutiveFailures = 0;
      log(`generated ${pieces.filter(Boolean).length}/${chunk.length} via ${provider}: ${chunk.map(c => c.word).join(', ')}`);
    } catch (err) {
      consecutiveFailures++;
      log(`failed: ${chunk.map(c => c.word).join(', ')}: ${(err as Error).message}`);
      // 全プロバイダが続けて失敗＝今日の無料枠を使い切ったとみなして終了
      if (consecutiveFailures >= 2) break;
    }
  }
  log(`done: ${generated} piece(s) generated`);
  return generated;
}
