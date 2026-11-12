// 駒の総合力（裏で使う強さの数値）。移動範囲・能力・性質をそれぞれ点数にして合計し、
// 上限を超える駒は「能力の充填を延ばす → 2マス先の移動を減らす」の順で削って釣り合いを取る。
// 能力と性質の両方が強い駒が、どちらか片方だけの駒より大きく強くならないようにするため。
// 重みは自動対局の勝率に合わせて決めた（scripts/calibrate-budget.ts）
import { abilityPower, DRAWBACK_SPECS, TRAIT_SPECS, type AbilityProgram, type PieceTrait } from './abilityProgram.js';

/** 移動範囲の点数: 周囲1マスは1点、2マス先（飛び越えられる）は1.6点 */
export function moveScore(grid: string | undefined): number {
  const g = (grid ?? '').replace(/\//g, '');
  if (g.length !== 25) return 8;
  let score = 0;
  for (let i = 0; i < 25; i++) {
    if (g[i] !== '1') continue;
    const far = Math.max(Math.abs(Math.floor(i / 5) - 2), Math.abs((i % 5) - 2)) === 2;
    score += far ? 1.6 : 1;
  }
  return score;
}

/** 能力の点数: 1回の強さ（代償を差し引く）を、使える頻度（充填手番）で割った「1手番あたりの強さ」 */
export function abilityScore(abilities: AbilityProgram[] | undefined, random = false): number {
  if (!abilities?.length) return 0;
  const per = abilities.map(a => {
    const power = abilityPower(a);
    const d = a.drawback;
    const relief = d ? DRAWBACK_SPECS[d.kind].relief(d.value ?? DRAWBACK_SPECS[d.kind].value?.[2] ?? 1, power) : 0;
    const effective = Math.max(0, power - relief);
    return a.cooldown >= 99 ? effective * 0.3 : effective / (a.cooldown + 1);
  });
  // ランダム型は、毎回どれか1つ（平均的な強さ）
  return random ? per.reduce((s, v) => s + v, 0) / per.length : Math.max(...per);
}

/** 性質の点数（得な性質は正、弱点の性質は負） */
export function traitScore(trait: PieceTrait | null | undefined): number {
  return trait ? TRAIT_SPECS[trait.kind].power : 0;
}

export interface PieceStrength { move: number; ability: number; trait: number; total: number }

/**
 * 総合力の重み（移動1点を1とした、勝率への効き方）。calibrate-budget.ts の回帰（較正用の駒150個・2100局）で決めた:
 *   性質1点は移動1点の約3倍効く。能力は充填手番の自動調整ですでに釣り合っていて、1手番あたりの強さと勝率はほぼ無関係だった
 *   （相関 -0.15）ので、極端な能力だけ拾えるよう小さく入れる
 */
export const BUDGET_WEIGHTS = { move: 1, ability: 0.3, trait: 3 };
/** 総合力の上限。これを超える駒は移動範囲・充填で削る */
export const BUDGET_LIMIT = 14;
/** 総合力の下限。これを下回る駒（弱点の性質＋狭い移動など）は、周囲1マスの移動を足して底上げする */
export const BUDGET_FLOOR = 4;

export function pieceStrength(p: { range_geometry?: { normal_grid?: string }; abilities?: AbilityProgram[]; ability_mode?: string; trait?: PieceTrait | null }): PieceStrength {
  const move = moveScore(p.range_geometry?.normal_grid);
  const ability = abilityScore(p.abilities, p.ability_mode === 'RANDOM');
  const trait = traitScore(p.trait);
  const total = move * BUDGET_WEIGHTS.move + ability * BUDGET_WEIGHTS.ability + trait * BUDGET_WEIGHTS.trait;
  return { move, ability, trait, total: Math.round(total * 10) / 10 };
}

/**
 * 総合力が上限を超えていたら削る（元の駒は変えずに新しい値を返す）。
 *   1. 能力の充填手番を1ずつ延ばす（最大8。1ゲーム1回の能力はそのまま）
 *   2. それでも超えていれば、2マス先の移動を後ろから順に外す（周囲1マスは残す＝動き方の個性は残る）
 */
export function fitToBudget<T extends { range_geometry?: { normal_grid?: string }; abilities?: AbilityProgram[]; ability_mode?: string; trait?: PieceTrait | null }>(piece: T): T {
  let next = piece;
  for (let guard = 0; guard < 16 && pieceStrength(next).total > BUDGET_LIMIT; guard++) {
    const abilities = next.abilities;
    const canSlow = abilities?.some(a => a.cooldown < 8);
    if (abilities?.length && canSlow) {
      next = { ...next, abilities: abilities.map(a => (a.cooldown >= 99 || a.cooldown >= 8 ? a : { ...a, cooldown: a.cooldown + 1 })) };
      continue;
    }
    const grid = (next.range_geometry?.normal_grid ?? '').replace(/\//g, '');
    const farCells = [...grid].map((c, i) => ({ c, i })).filter(({ c, i }) => c === '1' && Math.max(Math.abs(Math.floor(i / 5) - 2), Math.abs((i % 5) - 2)) === 2);
    // 2マス先がなくなったら、周囲1マスの後ろ側から外す（前・横は残す。最低3マスは動けるように）
    const BACK_FIRST = [16, 18, 17, 6, 8];
    const moves = [...grid].filter(c => c === '1').length;
    const drop = farCells.length ? farCells[farCells.length - 1].i : moves > 3 ? BACK_FIRST.find(i => grid[i] === '1') : undefined;
    if (drop === undefined) break;
    const trimmed = [...grid].map((c, i) => (i === drop ? '0' : c)).join('');
    next = { ...next, range_geometry: { ...next.range_geometry, normal_grid: trimmed } };
  }
  // 弱すぎる駒は、動けないマスを前から順に足す（キャラの動き方はなるべく残す）
  // 周囲1マスが埋まっても足りなければ、2マス前・2マス後ろ（飛び越えられる）も足す
  const ORDER = [7, 11, 13, 6, 8, 17, 16, 18, 2, 22];
  for (const i of ORDER) {
    if (pieceStrength(next).total >= BUDGET_FLOOR) break;
    const grid = (next.range_geometry?.normal_grid ?? '').replace(/\//g, '');
    if (grid.length !== 25 || grid[i] === '1') continue;
    next = { ...next, range_geometry: { ...next.range_geometry, normal_grid: [...grid].map((c, k) => (k === i ? '1' : c)).join('') } };
  }
  return next;
}
