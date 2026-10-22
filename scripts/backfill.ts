// 共有キャッシュのバックフィル（GitHub Actions で1日1回実行）
// 1. 利用者がAI生成できなかった単語（generation_queue）を要求回数の多い順に
// 2. 余った枠で事前生成用の単語（shared/seedWords.ts）を
// AI生成して custom_pieces に登録する。無料枠の上限に達したら静かに終了する。
//
// 実行: GEMINI_API_KEY=... FIREBASE_SERVICE_ACCOUNT='{...}' npx tsx scripts/backfill.ts
// 任意: BACKFILL_LIMIT（1回の最大生成数, 既定20）, BACKFILL_INTERVAL_MS（呼び出し間隔, 既定7000）
import { getAdminDb } from '../api/_lib/firebaseAdmin.js';
import { configuredProviders, generatePiece } from '../api/_lib/generator.js';
import { SEED_WORDS } from '../shared/seedWords.js';

const LIMIT = Number(process.env.BACKFILL_LIMIT || 20);
const INTERVAL_MS = Number(process.env.BACKFILL_INTERVAL_MS || 7000);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const db = await getAdminDb();
  if (!db) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  const providers = configuredProviders();
  if (providers.length === 0) throw new Error('no LLM provider is configured');

  const queued = await db.collection('generation_queue').orderBy('requests', 'desc').limit(LIMIT * 2).get();
  const candidates = [...queued.docs.map(d => d.id), ...SEED_WORDS];

  let generated = 0;
  let consecutiveFailures = 0;
  for (const word of [...new Set(candidates)]) {
    if (generated >= LIMIT) break;
    const cacheRef = db.collection('custom_pieces').doc(word);
    if ((await cacheRef.get()).exists) {
      await db.collection('generation_queue').doc(word).delete();
      continue;
    }
    try {
      const { piece, provider } = await generatePiece(word, providers);
      await cacheRef.set({ ...piece, createdAt: Date.now(), provider, backfilled: true });
      await db.collection('generation_queue').doc(word).delete();
      generated++;
      consecutiveFailures = 0;
      console.log(`generated: ${word} (${provider})`);
    } catch (err) {
      consecutiveFailures++;
      console.warn(`failed: ${word}: ${(err as Error).message}`);
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
