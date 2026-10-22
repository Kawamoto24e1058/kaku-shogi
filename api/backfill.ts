// GET /api/backfill … Vercel Cron が1日1回呼ぶ（vercel.json の crons）。処理は _lib/backfill.ts。
// Vercel は環境変数 CRON_SECRET を Authorization: Bearer で付けて呼ぶので、一致しない呼び出しは拒否する。
// Workers AI の無料枠は UTC 0時にリセットされるため、その直前（日本時間 8:30 頃）に余った枠を事前生成に回す。
import { timingSafeEqual } from 'node:crypto';
import { runBackfill } from './_lib/backfill.js';
import { setExtraNgWords } from '../shared/moderation.js';

setExtraNgWords((process.env.NG_WORDS || '').split(','));

// 関数の上限（vercel.json の maxDuration: 300秒）の手前で、新しいまとまりを始めるのをやめる
const BUDGET_MS = 200_000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (!authorized(request)) return new Response('Forbidden', { status: 403 });
    const lines: string[] = [];
    try {
      const generated = await runBackfill({
        limit: Number(process.env.BACKFILL_LIMIT || 40),
        batch: Math.max(1, Number(process.env.BACKFILL_BATCH || 5)),
        intervalMs: Number(process.env.BACKFILL_INTERVAL_MS || 3000),
        deadline: Date.now() + BUDGET_MS,
        log: line => { lines.push(line); console.log(`[backfill] ${line}`); },
      });
      return Response.json({ generated, log: lines }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      console.error('[backfill] failed:', (err as Error).message);
      return Response.json({ error: (err as Error).message, log: lines }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
