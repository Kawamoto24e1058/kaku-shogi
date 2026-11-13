// オンライン対戦（部屋コード）を2つのブラウザで通しで確かめる。実行: node scripts/e2e-online.cjs [URL]
// 駒はキャッシュ済みの言葉で作るので、ふつうは AI を呼ばない（キャッシュにない言葉だと AI を1回ずつ使う）
const { chromium, devices } = require('playwright');

const URL = process.argv[2] || 'https://kaku-shogi.momotech.workers.dev/';
const WORDS = { A: ['忍者', '雷', '爆弾'], B: ['ゴリラ', '桜', '寿司'] };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (label, opts) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('dialog', d => { errors.push(`${label} dialog: ${d.message()}`); d.dismiss(); });
    await page.goto(URL, { waitUntil: 'networkidle' });
    return page;
  };
  const shot = async (page, name) => page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/online-${name}.png` });
  const A = await open('A', { viewport: { width: 1280, height: 900 } });
  const B = await open('B', { ...devices['iPhone 13'] });
  const step = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

  try {
    // 1. A が部屋を作る
    await A.fill('#player-name', 'テストA');
    await A.click('text=はじめる');
    await A.click('text=友達と対戦');
    await A.click('button:has-text("部屋を作る")');
    const codeEl = await A.waitForSelector('.text-3xl.font-mono', { timeout: 20000 });
    const code = (await codeEl.innerText()).replace(/\D/g, '');
    step(`部屋コード ${code}`);

    // 2. B が合言葉で入る
    await B.fill('#player-name', 'テストB');
    await B.click('text=はじめる');
    await B.click('text=友達と対戦');
    await B.fill('input[aria-label="6桁の合言葉"]', code);
    await B.click('button:has-text("入る")');

    // 3. 両方が駒を3枚作って準備完了
    for (const [label, page] of [['A', A], ['B', B]]) {
      await page.waitForSelector('input[aria-label="駒にする言葉"]', { timeout: 30000 });
      step(`${label}: 駒づくり画面`);
      for (const w of WORDS[label]) {
        await page.fill('input[aria-label="駒にする言葉"]', w);
        await page.click('button:has-text("作る")');
        await page.waitForTimeout(300);
      }
    }
    for (const [label, page] of [['A', A], ['B', B]]) {
      await page.waitForSelector('text=3枚そろいました', { timeout: 90000 });
      await page.click('text=この3枚で準備完了');
      step(`${label}: 準備完了`);
    }

    // 4. 対局: 交互に歩を1つ前へ進める
    const cells = async (page) => page.$$('[style*="aspect-ratio: 1"][style*="min-width: 0"]');
    const movePawn = async (page) => {
      let cs = await cells(page);
      for (let k = cs.length - 1; k >= 0; k--) {
        if (!(await cs[k].innerText()).replace(/\s/g, '').includes('歩')) continue;
        await cs[k].click();
        await page.waitForTimeout(250);
        cs = await cells(page);
        const cls = await Promise.all(cs.map(e => e.getAttribute('class')));
        const mv = cls.map((c, i) => ((c || '').includes('move-highlight') ? i : -1)).filter(i => i >= 0);
        if (mv.length) { await cs[mv[0]].click(); return true; }
      }
      return false;
    };
    const boardText = async (page) => (await Promise.all((await cells(page)).map(c => c.innerText()))).map(t => t.replace(/\s/g, '')).join('|');
    for (let turn = 0; turn < 6; turn++) {
      const [mover, waiter, ml, wl] = turn % 2 === 0 ? [A, B, 'A', 'B'] : [B, A, 'B', 'A'];
      await mover.waitForSelector('text=あなたの手番', { timeout: 45000 });
      const before = await boardText(waiter);
      if (!(await movePawn(mover))) throw new Error(`${ml}: 動かせる歩が見つからない`);
      // 相手の画面に反映されるのを待つ
      const started = Date.now();
      let synced = false;
      while (Date.now() - started < 20000) {
        await waiter.waitForTimeout(500);
        if ((await boardText(waiter)) !== before) { synced = true; break; }
      }
      step(`${turn + 1}手目 ${ml}→${wl} 反映 ${synced ? `${Date.now() - started}ms` : 'されず'}`);
      if (!synced) throw new Error(`${wl} の画面に ${ml} の手が反映されない`);
    }
    await shot(A, 'A-final');
    await shot(B, 'B-final');
    step('6手まで同期を確認');
  } catch (err) {
    console.log('失敗:', err.message);
    await shot(A, 'A-error').catch(() => {});
    await shot(B, 'B-error').catch(() => {});
    process.exitCode = 1;
  }
  console.log('ページのエラー:', errors.length ? errors : 'なし');
  await browser.close();
})();
