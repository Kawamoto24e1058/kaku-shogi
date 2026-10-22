// 共有キャッシュのバックフィルを手元で実行する（本番は api/backfill.ts を Vercel Cron が1日1回呼ぶ）
// 実行: npm run backfill   （.env.local の CLOUDFLARE_* と SUPABASE_* を読む）
// 任意: BACKFILL_LIMIT（1回の実行で登録する最大語数, 既定60）
//       BACKFILL_BATCH（1回の呼び出しでまとめる語数, 既定5）
//       BACKFILL_INTERVAL_MS（呼び出し間隔, 既定15000。分あたりの上限に当たらないように空ける）
import { readFileSync, existsSync } from 'node:fs';
import { setExtraNgWords } from '../shared/moderation.js';

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
setExtraNgWords((process.env.NG_WORDS || '').split(','));

// 環境変数を読み込んでから import する（モジュールの読み込み時に設定を読むため）
const { runBackfill } = await import('../api/_lib/backfill.js');
try {
  await runBackfill({
    limit: Number(process.env.BACKFILL_LIMIT || 60),
    batch: Math.max(1, Number(process.env.BACKFILL_BATCH || 5)),
    intervalMs: Number(process.env.BACKFILL_INTERVAL_MS || 15000),
  });
} catch (err) {
  console.error(err);
  process.exit(1);
}
