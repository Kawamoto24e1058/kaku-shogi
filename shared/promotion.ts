// 成ったときの変化（キャラごとに AI が選ぶ）。
//   GROW_MOVE … 移動が広がる（成った後のマス目＋滑る動きが1マス伸びる）。指定がない駒もこれ
//   POWER_UP  … 技が強くなる（効果の数値+1・充填-1）
//   AWAKEN    … 別の技に目覚める（成ると能力が入れ替わる）
//   TRANSFORM_TRAIT … 性質が変わる（蛹→蝶で飛行が付く、など。null なら性質がなくなる）
// 成ったときに駒の能力・性質を入れ替え、元の姿を unpromoted に残す。取られて持ち駒に戻るときは元に戻す（demotePiece）
import { OP_SPECS, describeAbilities, describeTrait, normalizeAbilityPrograms, normalizeTrait, type AbilityProgram, type PieceTrait } from './abilityProgram.js';

export const PROMOTION_KINDS = ['GROW_MOVE', 'POWER_UP', 'AWAKEN', 'TRANSFORM_TRAIT'] as const;
export type PromotionKind = typeof PROMOTION_KINDS[number];

export interface PromotionSpec {
  kind: PromotionKind;
  /** AWAKEN: 成った後の能力 */
  ability?: AbilityProgram;
  /** TRANSFORM_TRAIT: 成った後の性質（null = 性質がなくなる） */
  trait?: PieceTrait | null;
}

export const PROMOTION_SPECS: Record<PromotionKind, { label: string; fits: string }> = {
  GROW_MOVE: { label: '移動が広がる', fits: '乗り物・成長・速さ・大きくなる' },
  POWER_UP: { label: '技が強くなる', fits: '達人・修行・極める・本気を出す' },
  AWAKEN: { label: '別の技に目覚める', fits: '変身・覚醒・二面性・正体を現す' },
  TRANSFORM_TRAIT: { label: '性質が変わる', fits: '蛹→蝶・卵→ひな・羽化・脱皮' },
};

/** AI の出力を読む。使えない指定なら「移動が広がる」にする */
export function normalizePromotion(raw: unknown): PromotionSpec {
  const obj = (raw && typeof raw === 'object' ? raw : { kind: raw }) as Record<string, unknown>;
  const name = String(obj.kind ?? '').trim().toUpperCase();
  const kind = (PROMOTION_KINDS as readonly string[]).includes(name) ? name as PromotionKind
    : PROMOTION_KINDS.find(k => PROMOTION_SPECS[k].label === String(obj.kind ?? '').trim()) ?? 'GROW_MOVE';
  if (kind === 'AWAKEN') {
    const ability = normalizeAbilityPrograms(obj.ability ? [obj.ability] : [])?.[0];
    return ability ? { kind, ability } : { kind: 'GROW_MOVE' };
  }
  if (kind === 'TRANSFORM_TRAIT') {
    // 性質がなくなる（null / NONE）か、知っている性質に変わる。知らない性質の名前なら「移動が広がる」にする
    if (obj.trait === null || obj.trait === 'NONE') return { kind, trait: null };
    const trait = normalizeTrait(obj.trait);
    return trait ? { kind, trait } : { kind: 'GROW_MOVE' };
  }
  return { kind };
}

/** 技が強くなる: 効果の数値を1上げ（上限まで）、充填を1減らす（1ゲーム1回はそのまま） */
export function poweredUp(abilities: AbilityProgram[]): AbilityProgram[] {
  return abilities.map(a => ({
    ...a,
    cooldown: a.cooldown >= 99 ? 99 : Math.max(0, a.cooldown - 1),
    effects: a.effects.map(e => {
      const range = OP_SPECS[e.op].value;
      return range && e.value !== undefined ? { ...e, value: Math.min(range[1], e.value + 1) } : e;
    }),
  }));
}

export function describePromotion(p: PromotionSpec | undefined, currentTrait?: PieceTrait | null): string {
  const spec = PROMOTION_SPECS[p?.kind ?? 'GROW_MOVE'];
  switch (p?.kind) {
    case 'POWER_UP': return `【成ると：${spec.label}】能力の数値が1上がり、充填が1手番短くなる`;
    case 'AWAKEN': return `【成ると：${spec.label}】${p.ability ? describeAbilities([p.ability]).replace(/^【[^】]*】/, `《${p.ability.name}》`) : ''}`;
    case 'TRANSFORM_TRAIT': return `【成ると：${spec.label}】${p.trait ? describeTrait(p.trait).replace(/^【性質：([^】]*)】/, '「$1」になる：') : currentTrait ? '性質がなくなる' : ''}`;
    default: return `【成ると：${spec.label}】移動範囲が広がり、滑る動きが1マス伸びる`;
  }
}

type Promotable = {
  isPromoted?: boolean;
  promotion?: PromotionSpec;
  abilities?: AbilityProgram[];
  ability_mode?: string;
  trait?: PieceTrait | null;
  rules_text?: string;
  abilityCooldowns?: number[];
  unpromoted?: { abilities?: AbilityProgram[]; trait?: PieceTrait | null; rules_text?: string };
};

/** 成った直後に呼ぶ。キャラごとの変化を当てはめ、元の能力・性質を unpromoted に残す（二度目は何もしない） */
export function promotePiece<T extends Promotable>(p: T): T {
  if (!p.promotion || p.unpromoted) return p;
  const unpromoted = { abilities: p.abilities, trait: p.trait, rules_text: p.rules_text };
  let next: T = { ...p, unpromoted };
  switch (p.promotion.kind) {
    case 'POWER_UP':
      if (p.abilities?.length) next = { ...next, abilities: poweredUp(p.abilities), abilityCooldowns: (p.abilityCooldowns ?? []).map(c => (c >= 99 ? c : Math.max(0, c - 1))) };
      break;
    case 'AWAKEN':
      if (p.promotion.ability) next = { ...next, abilities: [p.promotion.ability], ability_mode: 'SINGLE', abilityCooldowns: [0] };
      break;
    case 'TRANSFORM_TRAIT':
      next = { ...next, trait: p.promotion.trait ?? null };
      break;
    default:
      break;
  }
  const lines = [next.trait ? describeTrait(next.trait) : '', next.abilities?.length ? describeAbilities(next.abilities) : ''].filter(Boolean);
  return { ...next, rules_text: lines.length ? `（成り）\n${lines.join('\n')}` : next.rules_text };
}

/** 取られて持ち駒に戻るとき・成りが解けたときに呼ぶ。成る前の能力・性質に戻す */
export function demotePiece<T extends Promotable>(p: T): T {
  if (!p.unpromoted) return p;
  const { abilities, trait, rules_text } = p.unpromoted;
  return { ...p, abilities, trait, rules_text, unpromoted: undefined, abilityCooldowns: abilities?.map(() => 0) };
}
