// 共有キャッシュのバックフィル（GitHub Actions で1日1回実行）
// 1. 利用者がAI生成できなかった単語（generation_queue）を要求回数の多い順に
// 2. 余った枠で事前生成用の単語（shared/seedWords.ts）を
// AI生成して custom_pieces に登録する。1回の呼び出しで BACKFILL_BATCH 語をまとめて生成するので、
// 1日の「回数」上限に対して何倍もの単語を登録できる。無料枠の上限に達したら静かに終了する。
//
// 実行: CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... FIREBASE_SERVICE_ACCOUNT='{...}' npx tsx scripts/backfill.ts
// 任意: BACKFILL_LIMIT（1回の実行で登録する最大語数, 既定60）
//       BACKFILL_BATCH（1回の呼び出しでまとめる語数, 既定5）
//       BACKFILL_INTERVAL_MS（呼び出し間隔, 既定15000。分あたりの上限に当たらないように空ける）
import { getAdminDb } from '../api/_lib/firebaseAdmin.js';
import { configuredProviders, generatePieces } from '../api/_lib/generator.js';
import { getCachedPiece, saveCachedPiece } from '../api/_lib/pieceCache.js';
import { SEED_WORDS } from '../shared/seedWords.js';
import { wordKey } from '../shared/wordKey.js';
import { containsNgWord, pieceHasNgText, setExtraNgWords } from '../shared/moderation.js';

setExtraNgWords((process.env.NG_WORDS || '').split(','));

const LIMIT = Number(process.env.BACKFILL_LIMIT || 60);
const BATCH = Math.max(1, Number(process.env.BACKFILL_BATCH || 5));
const INTERVAL_MS = Number(process.env.BACKFILL_INTERVAL_MS || 15000);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const db = await getAdminDb();
  if (!db) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  const providers = configuredProviders();
  if (providers.length === 0) throw new Error('no LLM provider is configured');

  // 候補: 待ち行列（要求回数の多い順）→ 事前生成リスト。キーで重複を除き、キャッシュ済みは飛ばす
  const queued = await db.collection('generation_queue').orderBy('requests', 'desc').limit(LIMIT * 2).get();
  const candidates = new Map<string, string>();
  for (const doc of queued.docs) candidates.set(doc.id, (doc.get('word') as string) || doc.id);
  for (const word of SEED_WORDS) if (!candidates.has(wordKey(word))) candidates.set(wordKey(word), word);

  const todo: { key: string; word: string }[] = [];
  for (const [key, word] of candidates) {
    if (todo.length >= LIMIT) break;
    if (containsNgWord(word) || await getCachedPiece(db, key)) {
      await db.collection('generation_queue').doc(key).delete();
      continue;
    }
    todo.push({ key, word });
  }

  let generated = 0;
  let consecutiveFailures = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    try {
      const { pieces, provider } = await generatePieces(chunk.map(c => c.word), providers);
      for (const [j, piece] of pieces.entries()) {
        if (!piece) continue;
        if (pieceHasNgText(piece)) {
          console.warn(`skipped (moderation): ${chunk[j].word}`);
          continue;
        }
        await saveCachedPiece(db, chunk[j].key, piece, { provider, backfilled: true });
        generated++;
      }
      consecutiveFailures = 0;
      console.log(`generated ${pieces.filter(Boolean).length}/${chunk.length} via ${provider}: ${chunk.map(c => c.word).join(', ')}`);
    } catch (err) {
      consecutiveFailures++;
      console.warn(`failed: ${chunk.map(c => c.word).join(', ')}: ${(err as Error).message}`);
      // 全プロバイダが続けて失敗＝今日の無料枠を使い切ったとみなして終了
      if (consecutiveFailures >= 2) break;
    }
    await sleep(INTERVAL_MS);
  }
  console.log(`done: ${generated} piece(s) generated`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
