// GET /api/status -> { aiGeneration, onlineMatch, notice }
// ブラウザは起動時にこれを読み、止まっている機能を案内付きで無効化する。CDN で1分キャッシュする。
import { featureFlags } from './_lib/flags.js';

export default {
  fetch(): Response {
    return new Response(JSON.stringify(featureFlags()), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      },
    });
  },
};
