// 駒の総合力（裏で使う強さの数値）。移動範囲・能力・性質をそれぞれ点数にして合計し、
// 上限を超える駒は「能力の充填を延ばす → 2マス先の移動を減らす」の順で削って釣り合いを取る。
// 能力と性質の両方が強い駒が、どちらか片方だけの駒より大きく強くならないようにするため。
// 重みは自動対局の勝率に合わせて決めた（scripts/calibrate-budget.ts）
import { abilityPower, DRAWBACK_SPECS, TRAIT_SPECS, type AbilityProgram, type PieceTrait } from './abilityProgram.js';
import { moveExtraScore, MOVE_EXTRA_SPECS, type MoveExtra } from './moveStyles.js';
import { promotePiece, type PromotionSpec } from './promotion.js';

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

type BudgetPiece = { range_geometry?: { normal_grid?: string }; abilities?: AbilityProgram[]; ability_mode?: string; trait?: PieceTrait | null; move_extra?: MoveExtra | null };

/**
 * 総合力の重み（マス目の1マス＝1点を基準）。scripts/calibrate-budget.ts の自動対局で決めた:
 *   - 性質1点はマス目1点の約3倍、勝率に効く（較正用の駒150個・2100局の回帰）
 *   - 移動の特徴の点数は、マス目1点と同じ単位で測った（shared/moveStyles.ts）
 *   - 能力は充填手番の自動調整ですでに釣り合っていて、1手番あたりの強さと勝率はほぼ無関係（相関 -0.15）。極端な能力だけ拾えるよう小さく入れる
 * 「勝率+1%＝1点」に単位をそろえて性質の重みを1.4にした版も試したが、駒ごとの勝率のばらつき（ノイズを除いた推定）が
 * 4.2% → 5.9% に広がったので、この値に戻している
 */
export const BUDGET_WEIGHTS = { grid: 1, ability: 0.3, trait: 3 };
/** 総合力の上限。これを超える駒は移動の特徴・充填・移動範囲で削る */
export const BUDGET_LIMIT = 14;
/** 総合力の下限。これを下回る駒（弱点の性質＋狭い移動など）は、充填を短くし、周囲1マスを3マスまで足して底上げする */
export const BUDGET_FLOOR = 4;

export function pieceStrength(p: BudgetPiece): PieceStrength {
  // 移動 = マス目の点数（重み付き） + 移動の特徴（斜めに滑るなど）の点数
  const move = moveScore(p.range_geometry?.normal_grid) * BUDGET_WEIGHTS.grid + moveExtraScore(p.move_extra);
  const ability = abilityScore(p.abilities, p.ability_mode === 'RANDOM');
  const trait = traitScore(p.trait);
  const total = move + ability * BUDGET_WEIGHTS.ability + trait * BUDGET_WEIGHTS.trait;
  return { move: Math.round(move * 10) / 10, ability, trait, total: Math.round(total * 10) / 10 };
}

/**
 * 総合力が上限を超えていたら削る（元の駒は変えずに新しい値を返す）。
 *   1. 移動の特徴の範囲（滑るマス数など）を1ずつ縮める（特徴そのものは残す＝キャラの個性は残る）
 *   2. 能力の充填手番を1ずつ延ばす（最大8。1ゲーム1回の能力はそのまま）
 *   3. それでも超えていれば、2マス先の移動を後ろから順に外し、次に周囲1マスの後ろ側を外す（最低3マスは残す）
 *   4. 最後に、移動の特徴そのものを外す
 */
export function fitToBudget<T extends BudgetPiece>(piece: T): T {
  let next = piece;
  for (let guard = 0; guard < 24 && pieceStrength(next).total > BUDGET_LIMIT; guard++) {
    const extra = next.move_extra;
    const minRange = extra ? MOVE_EXTRA_SPECS[extra.kind].range?.[0] : undefined;
    if (extra && minRange !== undefined && (extra.range ?? minRange) > minRange) {
      next = { ...next, move_extra: { ...extra, range: (extra.range ?? minRange) - 1 } };
      continue;
    }
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
    if (drop === undefined) {
      // 最後の手段: 移動の特徴そのものを外す（ここまで削っても超えるのは、得な性質と強い特徴が重なったときだけ）
      if (next.move_extra) { next = { ...next, move_extra: null }; continue; }
      break;
    }
    const trimmed = [...grid].map((c, i) => (i === drop ? '0' : c)).join('');
    next = { ...next, range_geometry: { ...next.range_geometry, normal_grid: trimmed } };
  }
  // 弱すぎる駒は、まず能力の充填を短くし、それでも足りなければ周囲1マスの動けないマスを前から順に足す。
  // 足すのは3マスまで・2マス先は足さない（ゾウ＝重い型＋重量のような駒が、何でも動ける駒になってキャラが消えたため）
  for (let guard = 0; guard < 8 && pieceStrength(next).total < BUDGET_FLOOR; guard++) {
    const abilities = next.abilities;
    if (!abilities?.some(a => a.cooldown > 0 && a.cooldown < 99)) break;
    next = { ...next, abilities: abilities.map(a => (a.cooldown > 0 && a.cooldown < 99 ? { ...a, cooldown: a.cooldown - 1 } : a)) };
  }
  const ORDER = [7, 11, 13, 6, 8, 17, 16, 18];
  let added = 0;
  for (const i of ORDER) {
    if (added >= 3 || pieceStrength(next).total >= BUDGET_FLOOR) break;
    const grid = (next.range_geometry?.normal_grid ?? '').replace(/\//g, '');
    if (grid.length !== 25 || grid[i] === '1') continue;
    next = { ...next, range_geometry: { ...next.range_geometry, normal_grid: [...grid].map((c, k) => (k === i ? '1' : c)).join('') } };
    added++;
  }
  return next;
}

/** 成った後の総合力の上限（成るのは終盤なので、通常の上限より少し高い） */
export const PROMOTED_LIMIT = BUDGET_LIMIT + 4;

/**
 * 成ったときの変化を、成った後の総合力が上限以内に収まるよう調整する。
 * 別の技に目覚める場合はその技の充填を延ばし、それでも強すぎる変化は「移動が広がる」にする
 */
export function fitPromotion(base: BudgetPiece & { range_geometry?: { normal_grid?: string; promoted_grid?: string } }, promotion: PromotionSpec): PromotionSpec {
  let current = promotion;
  for (let guard = 0; guard < 12; guard++) {
    const promoted = promotePiece({ ...base, isPromoted: true, promotion: current, unpromoted: undefined });
    const strength = pieceStrength({ ...promoted, range_geometry: { normal_grid: base.range_geometry?.promoted_grid ?? base.range_geometry?.normal_grid } });
    if (strength.total <= PROMOTED_LIMIT) return current;
    if (current.kind === 'AWAKEN' && current.ability && current.ability.cooldown < 8) {
      current = { ...current, ability: { ...current.ability, cooldown: current.ability.cooldown + 1 } };
      continue;
    }
    return { kind: 'GROW_MOVE' };
  }
  return current;
}
