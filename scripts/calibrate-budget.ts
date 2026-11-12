// 総合力（shared/pieceBudget.ts）の重みを、自動対局の勝率に合わせて決めるためのスクリプト（AI は使わない）
//   1. npx tsx scripts/calibrate-budget.ts make プールのファイル  … 移動の型・能力・性質をでたらめに組み合わせた駒を作る
//   2. ONLY_EXTRA=1 EXTRA_POOL=プール STATS_OUT=結果 npx tsx scripts/simulate-games.ts 1200  … その駒だけで対局
//   3. npx tsx scripts/calibrate-budget.ts fit プール 結果1 [結果2 ...]  … 勝率 ≒ 定数 + a×移動 + b×能力 + c×性質 を当てはめる
import { readFileSync, writeFileSync } from 'node:fs';
import { OP_SPECS, TRAIT_KINDS, NAMED_AREAS } from '../shared/abilityProgram';
import { MOVE_STYLES, MOVE_STYLE_SPECS, MOVE_EXTRAS, MOVE_EXTRA_SPECS } from '../shared/moveStyles';
import { moveScore } from '../shared/pieceBudget';
import { pieceStrength } from '../shared/pieceBudget';

(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { sanitizePieceData } = await import('../src/aiGenerator');

let seed = 11;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

const [mode, poolFile, ...statFiles] = process.argv.slice(2);

if (mode === 'make') {
  const OPS = Object.keys(OP_SPECS).filter(op => op !== 'TILE' && op !== 'WALL');
  const pool = Array.from({ length: 150 }, (_, i) => ({
    word: `較${i}`, effect_name: `較${i}`, ability_genre: '試験', description: '試験',
    move_style: pick(MOVE_STYLES),
    range_geometry: { normal_grid: MOVE_STYLE_SPECS[pick(MOVE_STYLES)].grid },
    // 能力なし・弱い・強いが混ざるように
    abilities: rand() < 0.15 ? [] : [{
      name: `較${i}`, trigger: pick(['ON_MOVE', 'ON_MOVE', 'ON_CAPTURE', 'ON_TAKEN', 'ON_DROP', 'ON_ALLY_TAKEN']),
      condition: 'NONE',
      target: { area: pick(NAMED_AREAS.filter(a => a !== 'SELF' && a !== 'ATTACKER')), who: 'ENEMY', pick: pick(['NEAREST', 'ALL', 'STRONGEST']), count: 1 + Math.floor(rand() * 2) },
      effects: [{ op: pick(OPS), value: 1 + Math.floor(rand() * 2) }],
      cooldown: 0,
    }],
    trait: rand() < 0.5 ? { kind: pick(TRAIT_KINDS) } : null,
    logic_code: 'normal',
  }));
  writeFileSync(poolFile, JSON.stringify(pool));
  console.log(`${pool.length} 駒を ${poolFile} に書きました`);
} else if (mode === 'make-move') {
  // 移動だけの駒（能力・性質なし）。移動の特徴の強さを測る
  const pool = Array.from({ length: 180 }, (_, i) => {
    const kind = rand() < 0.8 ? pick(MOVE_EXTRAS) : null;
    const spec = kind ? MOVE_EXTRA_SPECS[kind] : null;
    const range = spec?.range ? spec.range[0] + Math.floor(rand() * (spec.range[1] - spec.range[0] + 1)) : undefined;
    return {
      word: `移${i}`, effect_name: `移${i}`, ability_genre: '試験', description: '試験',
      move_style: pick(MOVE_STYLES), move_extra: kind ? { kind, range } : null,
      // 総合力の調整で範囲が縮まないよう、性質で「新しい駒」として扱わせる（点数0の性質）
      trait: { kind: 'INVISIBLE' }, logic_code: 'normal',
    };
  });
  writeFileSync(poolFile, JSON.stringify(pool));
  console.log(`${pool.length} 駒を ${poolFile} に書きました`);
} else if (mode === 'fit-move') {
  const pool = JSON.parse(readFileSync(poolFile, 'utf8')) as Record<string, unknown>[];
  const stats: Record<string, { games: number; wins: number }> = {};
  for (const f of statFiles) for (const [name, st] of Object.entries(JSON.parse(readFileSync(f, 'utf8')) as Record<string, { games: number; wins: number }>)) {
    const cur = stats[name] ?? { games: 0, wins: 0 }; stats[name] = { games: cur.games + st.games, wins: cur.wins + st.wins };
  }
  // 勝率 = c + a*マス目の点数 + 特徴ごとの効果（特徴×範囲） を、特徴ごとに分けて当てはめる
  const rows = pool.map(raw => {
    const piece = sanitizePieceData(structuredClone(raw), String(raw.word));
    const st = stats[`AI:${raw.word}`];
    return st ? { grid: moveScore(piece.range_geometry?.normal_grid), extra: piece.move_extra as { kind: string; range?: number } | undefined, rate: st.wins / st.games, games: st.games } : null;
  }).filter((r): r is NonNullable<typeof r> => r !== null);
  const none = rows.filter(r => !r.extra);
  // マス目の点数1点あたりの勝率の伸び（特徴なしの駒で回帰）
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const gx = none.map(r => r.grid), gy = none.map(r => r.rate);
  const slope = gx.reduce((s, x, i) => s + (x - mean(gx)) * (gy[i] - mean(gy)), 0) / gx.reduce((s, x) => s + (x - mean(gx)) ** 2, 0);
  console.log(`特徴なし ${none.length}駒: 勝率 ${(mean(gy) * 100).toFixed(1)}%、マス目1点あたり ${(slope * 100).toFixed(2)}%`);
  const base = (g: number) => mean(gy) + slope * (g - mean(gx));
  const groups = new Map<string, number[]>();
  for (const r of rows.filter(r => r.extra)) {
    const key = `${r.extra!.kind}${r.extra!.range !== undefined ? `:${r.extra!.range}` : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), r.rate - base(r.grid)]);
  }
  for (const [key, diffs] of [...groups].sort()) {
    const d = mean(diffs);
    console.log(`  ${key.padEnd(20)} ${diffs.length}駒  勝率の上乗せ ${(d * 100).toFixed(1)}%  → マス目換算 ${(d / slope).toFixed(1)}点`);
  }
} else if (mode === 'fit') {
  const pool = JSON.parse(readFileSync(poolFile, 'utf8')) as Record<string, unknown>[];
  const stats: Record<string, { games: number; wins: number }> = {};
  for (const f of statFiles) {
    for (const [name, s] of Object.entries(JSON.parse(readFileSync(f, 'utf8')) as Record<string, { games: number; wins: number }>)) {
      const cur = stats[name] ?? { games: 0, wins: 0 };
      stats[name] = { games: cur.games + s.games, wins: cur.wins + s.wins };
    }
  }
  const rows = pool.map(raw => {
    const piece = sanitizePieceData(structuredClone(raw), String(raw.word));
    const s = stats[`AI:${raw.word}`];
    return s && s.games >= 20 ? { ...pieceStrength(piece), rate: s.wins / s.games, games: s.games, word: String(raw.word) } : null;
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  // 最小二乗法: rate = c + a*move + b*ability + t*trait
  const X = rows.map(r => [1, r.move, r.ability, r.trait]);
  const y = rows.map(r => r.rate);
  const n = X[0].length;
  const XtX = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => X.reduce((s, row) => s + row[i] * row[j], 0)));
  const Xty = Array.from({ length: n }, (_, i) => X.reduce((s, row, k) => s + row[i] * y[k], 0));
  // ガウスの消去法
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let i = 0; i < n; i++) {
    const p = A.slice(i).reduce((best, row, k) => (Math.abs(row[i]) > Math.abs(A[best][i]) ? i + k : best), i);
    [A[i], A[p]] = [A[p], A[i]];
    for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j <= n; j++) A[k][j] -= f * A[i][j]; }
  }
  const beta = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) beta[i] = (A[i][n] - A[i].slice(i + 1, n).reduce((s, v, k) => s + v * beta[i + 1 + k], 0)) / A[i][i];
  const corr = (a: number[], b: number[]) => {
    const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    const cov = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0);
    return cov / Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0));
  };
  const pred = X.map(row => row.reduce((s, v, i) => s + v * beta[i], 0));
  console.log(`駒 ${rows.length} 個（20局以上）。平均対局数 ${(rows.reduce((s, r) => s + r.games, 0) / rows.length).toFixed(0)}`);
  console.log(`勝率 ≒ ${beta[0].toFixed(3)} + ${beta[1].toFixed(4)}×移動 + ${beta[2].toFixed(4)}×能力 + ${beta[3].toFixed(4)}×性質`);
  console.log(`移動1点あたりの重みを1としたとき: 能力 ${(beta[2] / beta[1]).toFixed(2)} / 性質 ${(beta[3] / beta[1]).toFixed(2)}`);
  console.log(`当てはまりの良さ（予測と勝率の相関）${corr(pred, y).toFixed(2)} / 移動だけ ${corr(rows.map(r => r.move), y).toFixed(2)} / 能力だけ ${corr(rows.map(r => r.ability), y).toFixed(2)} / 性質だけ ${corr(rows.map(r => r.trait), y).toFixed(2)}`);
  const sorted = rows.map((r, i) => ({ ...r, pred: pred[i] })).sort((a, b) => b.rate - a.rate);
  console.log('勝率の高い駒:', sorted.slice(0, 5).map(r => `${r.word} ${(r.rate * 100).toFixed(0)}% 移動${r.move} 能力${r.ability.toFixed(1)} 性質${r.trait}`).join(' / '));
} else {
  console.log('使い方: make <プール> / fit <プール> <結果...>');
}
