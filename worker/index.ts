// Cloudflare Worker の入口。
//   /api/generate-piece … 駒の生成・共有キャッシュの参照（api/generate-piece.ts）
//   /api/status         … 緊急スイッチの状態（api/_lib/flags.ts）
//   それ以外            … dist/ の静的ファイル（wrangler.jsonc の assets。Worker を通らないので無料・回数無制限）
//   毎日 23:30 UTC      … 共有キャッシュのバックフィル（api/_lib/backfill.ts）
// Worker の環境変数・シークレットは nodejs_compat により process.env にも入るので、api/ のコードはそのまま動く。
import { handleGeneratePiece } from '../api/generate-piece.js';
import { featureFlags } from '../api/_lib/flags.js';
import { runBackfill } from '../api/_lib/backfill.js';
import { setWorkersAIBinding, type WorkersAIBinding } from '../api/_lib/generator.js';

interface Env {
  AI: WorkersAIBinding;
  ASSETS: { fetch(request: Request): Promise<Response> };
  BACKFILL_LIMIT?: string;
  BACKFILL_BATCH?: string;
  BACKFILL_INTERVAL_MS?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Cron の実行時間の上限より十分手前で、新しいまとまりを始めるのをやめる
const BACKFILL_BUDGET_MS = 200_000;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setWorkersAIBinding(env.AI);
    const { pathname } = new URL(request.url);
    if (pathname === '/api/generate-piece') return handleGeneratePiece(request, task => ctx.waitUntil(task));
    if (pathname === '/api/status') {
      return new Response(JSON.stringify(featureFlags()), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
      });
    }
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    setWorkersAIBinding(env.AI);
    ctx.waitUntil(
      runBackfill({
        limit: Number(env.BACKFILL_LIMIT || 60),
        batch: Math.max(1, Number(env.BACKFILL_BATCH || 5)),
        intervalMs: Number(env.BACKFILL_INTERVAL_MS || 3000),
        deadline: Date.now() + BACKFILL_BUDGET_MS,
        log: line => console.log(`[backfill] ${line}`),
      }).catch(err => console.error('[backfill] failed:', (err as Error).message)),
    );
  },
};
