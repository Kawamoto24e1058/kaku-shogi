// 実行: npm run dev を起動した状態で、playwright を入れた環境から node scripts/e2e/online-match.mjs
// 2つのブラウザでオンライン対戦を通しで動かす。Supabase は Node 側のメモリ上の偽物で代用する
// （このサンドボックスからは supabase.co に接続できないため。Realtime の websocket も繋がらないので、ポーリングでの同期を試すことになる）
import { chromium, devices } from 'playwright';
import { createHash } from 'node:crypto';
const out = process.env.SHOT_DIR || '.';
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const db = { matches: new Map(), secrets: new Map(), queue: new Map() };
let clock = Date.now();
const now = () => new Date(++clock).toISOString();
function patch(code, p, logs) {
  const m = db.matches.get(code);
  const merged = { ...m.data, ...(p || {}) };
  if (Array.isArray(logs)) merged.logs = Array.isArray(merged.logs) ? [...merged.logs, ...logs] : logs;
  m.data = merged; m.updated_at = now();
}
const rpc = {
  create_match: ({ p_code, p_secret, p_data }) => {
    if (db.matches.has(p_code)) return false;
    db.matches.set(p_code, { data: p_data, updated_at: now() });
    db.secrets.set(p_code, { sente: sha(p_secret), gote: null });
    return true;
  },
  join_match: ({ p_code, p_secret, p_patch, p_logs }) => {
    const s = db.secrets.get(p_code); const h = sha(p_secret);
    if (!s || s.sente === h) return false;
    if (s.gote === null) s.gote = h; else if (s.gote !== h) return false;
    patch(p_code, p_patch, p_logs); return true;
  },
  update_match: ({ p_code, p_secret, p_patch, p_logs }) => {
    const s = db.secrets.get(p_code); const h = sha(p_secret);
    if (!s || (s.sente !== h && s.gote !== h)) return false;
    patch(p_code, p_patch, p_logs); return true;
  },
  delete_match: ({ p_code, p_secret }) => { const s = db.secrets.get(p_code); if (s?.sente === sha(p_secret)) { db.matches.delete(p_code); return true; } return false; },
  enqueue_match: ({ p_id, p_secret, p_room_code }) => { db.queue.set(p_id, { room: p_room_code, h: sha(p_secret), at: Date.now() }); return true; },
  take_waiting_match: ({ p_exclude_id }) => { for (const [id, q] of db.queue) if (id !== p_exclude_id) { db.queue.delete(id); return q.room; } return null; },
  dequeue_match: ({ p_id }) => { db.queue.delete(p_id); return null; },
};
const stats = { rpc: {}, selects: 0, maxPayload: 0 };
async function handleSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = url.pathname.split('/').pop();
    const body = JSON.parse(req.postData() || '{}');
    stats.rpc[fn] = (stats.rpc[fn] || 0) + 1;
    stats.maxPayload = Math.max(stats.maxPayload, (req.postData() || '').length);
    if (!rpc[fn]) return route.fulfill({ status: 404, body: '{}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rpc[fn](body)) });
  }
  if (url.pathname === '/rest/v1/matches') {
    stats.selects++;
    const code = (url.searchParams.get('code') || '').replace('eq.', '');
    const gt = (url.searchParams.get('updated_at') || '').replace('gt.', '');
    const m = db.matches.get(code);
    const rows = m && (!gt || m.updated_at > gt) ? [{ data: m.data, updated_at: m.updated_at }] : [];
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (wantsObject) return rows.length ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows[0]) })
      : route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  }
  return route.fulfill({ status: 404, body: '{}' });
}

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
async function player(name, dev) {
  const ctx = await browser.newContext({ ...devices[dev], locale: 'ja-JP' });
  const page = await ctx.newPage();
  await page.route(/supabase\.co/, handleSupabase);
  await page.route('**/api/generate-piece**', r => r.abort());
  await page.route('**/api/status', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"aiGeneration":true,"onlineMatch":true,"notice":""}' }));
  page.on('pageerror', e => console.log(`[${name}] pageerror`, e.message));
  page.on('dialog', d => { console.log(`[${name}] dialog:`, d.message()); d.dismiss(); });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForTimeout(800);
  await page.locator('input').first().fill(name);
  await page.getByRole('button', { name: '戦場へ出陣する' }).click();
  await page.getByRole('button', { name: /カスタム対戦/ }).click();
  return page;
}
const A = await player('先手さん', 'iPhone 13');
const B = await player('後手さん', 'Pixel 7');
await A.getByRole('button', { name: '部屋を作る', exact: true }).click();
await A.waitForTimeout(1200);
const code = [...db.matches.keys()][0];
console.log('room code', code);
await B.locator('input[placeholder="6桁コード"]').fill(code);
await B.getByRole('button', { name: '入室', exact: true }).click();
await A.waitForTimeout(4000);
console.log('status after join', db.matches.get(code)?.data.status);
for (const [page, words] of [[A, ['猫', '忍者', '大砲']], [B, ['犬', '侍', '盾']]]) {
  for (const w of words) {
    await page.locator('input').first().fill(w);
    await page.getByRole('button', { name: '概念をコンパイルする' }).click();
    await page.waitForTimeout(1200);
  }
  await page.getByRole('button', { name: 'この本質で盤面へ' }).click();
}
await A.waitForTimeout(7000);
console.log('status after ready', db.matches.get(code)?.data.status);
await A.screenshot({ path: `${out}/online-A-1.png` });
await B.screenshot({ path: `${out}/online-B-1.png` });
// 先手: 一番左の歩を1つ進める
const cellCenter = async (page, label) => page.evaluate((label) => {
  const els = [...document.querySelectorAll('.board-wrapper *')].filter(e => e.children.length === 0 && e.textContent === label);
  return els.map(e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
}, label);
const pawns = (await cellCenter(A, '歩兵')).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
const [px, py] = pawns[0];
const cell = (await A.locator('.board-wrapper').boundingBox());
await A.touchscreen.tap(px, py);
await A.waitForTimeout(400);
await A.touchscreen.tap(px, py - cell.height / 9.4);
await A.waitForTimeout(6000);
const d = db.matches.get(code)?.data;
console.log('turn after move', d?.turn, 'status', d?.status, 'logs', (d?.logs || []).length);
await A.screenshot({ path: `${out}/online-A-2.png` });
await B.screenshot({ path: `${out}/online-B-2.png` });
const bTurn = await B.locator('.turn-strip').innerText().catch(() => '(no strip)');
console.log('B turn strip:', bTurn.replace(/\s+/g, ' '));
// ① 後手がページを再読み込みしても対局に戻れるか
await B.reload();
await B.waitForTimeout(6000);
const bStrip2 = await B.locator('.turn-strip').innerText().catch(() => '(no strip)');
console.log('B after reload:', bStrip2.replace(/\s+/g, ' '));
await B.screenshot({ path: `${out}/online-B-3-reload.png` });
// ② 後手が投了 → 先手に勝ちが届くか
B.once('dialog', d => d.accept());
B.removeAllListeners('dialog');
B.on('dialog', d => d.accept());
await B.getByRole('button', { name: '投了', exact: true }).click();
await A.waitForTimeout(6000);
console.log('status after resign', db.matches.get(code)?.data.status, 'winner', db.matches.get(code)?.data.winner);
const aOver = await A.locator('.game-over-title').innerText().catch(() => '(no overlay)');
const bOver = await B.locator('.game-over-title').innerText().catch(() => '(no overlay)');
console.log('A overlay:', aOver, '/ B overlay:', bOver);
await A.screenshot({ path: `${out}/online-A-4-resign.png` });
console.log('stats', JSON.stringify(stats));
await browser.close();
