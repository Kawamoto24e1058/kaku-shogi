// 能力プログラム（v2）: 能力を「きっかけ・条件・対象・効果」の部品の組み合わせで表す（クライアント・サーバー共通）
// AI はこの形のデータを書き、src/abilityEngine.ts がそれを実行する。AI が書けるのはデータだけなので、
// どんな単語でもプログラムが勝手に動くことはなく、同じデータからは同じ処理になる（オンライン対戦でもずれない）。
// 強さは部品ごとのコストで見積もり、強すぎる能力には自動で充填手番（クールダウン）や1回限りの制限を付ける。
// 効果の説明文（rules text）もこのデータから機械的に作るので、説明と実際の動きが食い違わない。

export const PROGRAM_TRIGGERS = ['ON_MOVE', 'TURN_START', 'EVERY_N_TURNS', 'ON_CAPTURE', 'ON_TAKEN', 'ON_APPROACH', 'ON_PROMOTE'] as const;
export type ProgramTrigger = typeof PROGRAM_TRIGGERS[number];

export const PROGRAM_CONDITIONS = [
  'NONE', 'IN_ENEMY_CAMP', 'IN_OWN_CAMP', 'ENEMIES_NEAR_AT_LEAST', 'ALLIES_NEAR_AT_LEAST', 'NO_ALLY_NEAR',
  'MY_HAND_AT_LEAST', 'ENEMY_HAND_AT_LEAST', 'PROMOTED', 'CHANCE',
] as const;
export type ProgramCondition = typeof PROGRAM_CONDITIONS[number];

export const NAMED_AREAS = [
  'SELF', 'ADJACENT', 'RADIUS_2', 'FRONT_LINE', 'LINES_8', 'DIAGONALS', 'CROSS', 'ROW', 'COLUMN',
  'ALL', 'ENEMY_KING_AROUND', 'ATTACKER',
] as const;
export type NamedArea = typeof NAMED_AREAS[number];

export const TARGET_WHO = ['ENEMY', 'ALLY', 'ANY', 'EMPTY'] as const;
export const TARGET_PICKS = ['ALL', 'NEAREST', 'FARTHEST', 'STRONGEST', 'WEAKEST', 'RANDOM'] as const;
export type TargetWho = typeof TARGET_WHO[number];
export type TargetPick = typeof TARGET_PICKS[number];

export const TILE_KINDS = ['FIRE', 'POISON', 'ICE', 'BOMB', 'TRAP'] as const;
export type TileKind = typeof TILE_KINDS[number];

/** 効果の部品。value の意味は部品ごと（マス数・手番数・体数・枚数） */
export const PROGRAM_OPS = [
  'DESTROY', 'CAPTURE', 'PUSH', 'PULL', 'SWAP', 'TELEPORT', 'FREEZE', 'STUN', 'SILENCE', 'CONTROL',
  'DOOM', 'TRANSFORM_PAWN', 'SHIELD', 'GUARD', 'STEALTH', 'CLEANSE', 'EXTRA_ACTION',
  'SPAWN', 'WALL', 'TILE', 'STEAL_HAND',
] as const;
export type ProgramOp = typeof PROGRAM_OPS[number];

export interface ProgramTarget {
  /** 名前付きの範囲、または 5x5 のマス目（上の行が敵陣側。移動範囲と同じ書き方。例 00100/01110/01210/00000/00000） */
  area: NamedArea | string;
  who: TargetWho;
  pick: TargetPick;
  /** pick が ALL 以外のときに選ぶ数 */
  count: number;
}

export interface ProgramEffect {
  op: ProgramOp;
  value?: number;
  tile?: TileKind;
}

export interface AbilityProgram {
  name: string;
  trigger: ProgramTrigger;
  /** EVERY_N_TURNS のときの間隔（2〜5手番） */
  every?: number;
  condition: ProgramCondition;
  /** 条件の数値（体数・枚数・確率%） */
  condition_value?: number;
  target: ProgramTarget;
  effects: ProgramEffect[];
  /** 発動後の充填手番。99 = 1ゲーム1回 */
  cooldown: number;
}

export interface PieceAppearance {
  /** 駒の地の色 #rrggbb */
  color: string;
  /** 縁取り・文字の色 #rrggbb */
  accent: string;
  /** 駒に大きく表示する1〜2文字（漢字・かな・記号） */
  emblem: string;
  aura: typeof AURAS[number];
}
export const AURAS = ['NONE', 'GLOW', 'FLAME', 'SPARK', 'MIST', 'RIPPLE', 'SHADOW'] as const;

const MAX_ABILITIES = 3;
const MAX_EFFECTS = 4;

// ===== 値の範囲 =====
interface OpSpec {
  /** value の [最小, 最大, 既定]。value を使わない部品は null */
  value: [number, number, number] | null;
  /** 1対象あたりの基本コスト */
  cost: number;
  /** value 1あたりの追加コスト */
  perValue?: number;
  /** 自分自身にだけ効く部品（対象の指定を無視する） */
  self?: boolean;
  label: string;
}

export const OP_SPECS: Record<ProgramOp, OpSpec> = {
  DESTROY: { value: null, cost: 5, label: '消滅させる' },
  CAPTURE: { value: null, cost: 6, label: '捕獲して持ち駒にする' },
  PUSH: { value: [1, 8, 1], cost: 0.8, perValue: 0.3, label: 'マス押し出す' },
  PULL: { value: [1, 8, 1], cost: 0.8, perValue: 0.3, label: 'マス引き寄せる' },
  SWAP: { value: null, cost: 2, label: '自分と位置を入れ替える' },
  TELEPORT: { value: null, cost: 2, label: 'そのマスへ自分が瞬間移動する' },
  FREEZE: { value: [1, 3, 1], cost: 1.5, perValue: 1, label: '手番凍結させる' },
  STUN: { value: [1, 3, 1], cost: 1.2, perValue: 0.8, label: '手番麻痺させる' },
  SILENCE: { value: [1, 4, 2], cost: 0.8, perValue: 0.5, label: '手番能力を封じる' },
  CONTROL: { value: [1, 2, 1], cost: 4, perValue: 1.5, label: '手番寝返らせる' },
  DOOM: { value: [2, 5, 3], cost: 4.5, perValue: -0.5, label: '手番後に消滅する呪いをかける' },
  TRANSFORM_PAWN: { value: null, cost: 3.5, label: '歩兵に変える' },
  SHIELD: { value: null, cost: 1.5, label: '1回だけ攻撃を防ぐ盾を付ける' },
  GUARD: { value: [1, 3, 1], cost: 1.2, perValue: 0.8, label: '手番、能力による効果を受けなくする' },
  STEALTH: { value: null, cost: 1.2, self: true, label: '姿を隠す' },
  CLEANSE: { value: null, cost: 0.8, label: '状態異常を治す' },
  EXTRA_ACTION: { value: null, cost: 6, self: true, label: 'もう一度行動できる' },
  SPAWN: { value: [1, 3, 1], cost: 1.5, perValue: 1.5, label: '体の分身を呼び出す' },
  WALL: { value: [1, 4, 2], cost: 0.6, perValue: 0.2, label: '手番残る壁を置く' },
  TILE: { value: [1, 5, 3], cost: 0.8, perValue: 0.2, label: '手番残る地形を置く' },
  STEAL_HAND: { value: [1, 2, 1], cost: 2, perValue: 2, self: true, label: '枚、相手の持ち駒を奪う' },
};

export const TRIGGER_LABELS: Record<ProgramTrigger, string> = {
  ON_MOVE: '自分が動いた後',
  TURN_START: '自分の手番の開始時',
  EVERY_N_TURNS: '{n}手番ごと（手番の開始時）',
  ON_CAPTURE: '敵駒を取ったとき',
  ON_TAKEN: '自分が取られたとき',
  ON_APPROACH: '敵駒が隣に来たとき',
  ON_PROMOTE: '成ったとき',
};

const CONDITION_LABELS: Record<ProgramCondition, string> = {
  NONE: '',
  IN_ENEMY_CAMP: '敵陣にいれば',
  IN_OWN_CAMP: '自陣にいれば',
  ENEMIES_NEAR_AT_LEAST: '周囲1マスに敵が{n}体以上いれば',
  ALLIES_NEAR_AT_LEAST: '周囲1マスに味方が{n}体以上いれば',
  NO_ALLY_NEAR: '周囲1マスに味方がいなければ',
  MY_HAND_AT_LEAST: '自分の持ち駒が{n}枚以上なら',
  ENEMY_HAND_AT_LEAST: '相手の持ち駒が{n}枚以上なら',
  PROMOTED: '成っていれば',
  CHANCE: '{n}%の確率で',
};

const AREA_LABELS: Record<NamedArea, string> = {
  SELF: '自分',
  ADJACENT: '周囲1マス',
  RADIUS_2: '周囲2マス',
  FRONT_LINE: '前方一直線',
  LINES_8: '8方向の直線上',
  DIAGONALS: '斜めの直線上',
  CROSS: '縦横の直線上',
  ROW: '同じ横一列',
  COLUMN: '同じ縦一列',
  ALL: '盤上すべて',
  ENEMY_KING_AROUND: '敵玉の周囲1マス',
  ATTACKER: '自分を取った駒',
};

const WHO_LABELS: Record<TargetWho, string> = { ENEMY: '敵駒', ALLY: '味方の駒', ANY: '駒', EMPTY: '空きマス' };
const TILE_LABELS: Record<TileKind, string> = { FIRE: '炎', POISON: '毒沼', ICE: '氷床', BOMB: '時限爆弾', TRAP: '見えない罠' };

// ===== 検証・正規化 =====
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const asInt = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : fallback;
};
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return (list as readonly string[]).includes(s) ? (s as T) : fallback;
};

const GRID_RE = /^[012]{5}(\/?[012]{5}){4}$/;

/** 5x5 のマス目を「上の行から」の25文字に揃える。不正なら null */
export function normalizeAreaGrid(raw: string): string | null {
  const flat = raw.replace(/\//g, '');
  if (!GRID_RE.test(raw) || flat.length !== 25) return null;
  const cells = flat.split('');
  cells[12] = '2';
  return cells.includes('1') ? cells.join('') : null;
}

function normalizeTarget(raw: unknown, selfOnly: boolean): ProgramTarget {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (selfOnly) return { area: 'SELF', who: 'ALLY', pick: 'ALL', count: 1 };
  let area: string = 'ADJACENT';
  if (typeof t.area === 'string') {
    const named = t.area.trim().toUpperCase();
    if ((NAMED_AREAS as readonly string[]).includes(named)) area = named;
    else area = normalizeAreaGrid(t.area.trim()) ?? 'ADJACENT';
  }
  const who = oneOf(TARGET_WHO, t.who, area === 'SELF' ? 'ALLY' : 'ENEMY');
  const pick = oneOf(TARGET_PICKS, t.pick, 'ALL');
  return { area, who, pick, count: clamp(asInt(t.count, 1), 1, 9) };
}

function normalizeEffect(raw: unknown): ProgramEffect | null {
  const e = (raw && typeof raw === 'object' ? raw : { op: raw }) as Record<string, unknown>;
  const op = oneOf(PROGRAM_OPS, e.op, '' as ProgramOp);
  if (!op) return null;
  const spec = OP_SPECS[op];
  const out: ProgramEffect = { op };
  if (spec.value) out.value = clamp(asInt(e.value, spec.value[2]), spec.value[0], spec.value[1]);
  if (op === 'TILE') out.tile = oneOf(TILE_KINDS, e.tile, 'FIRE');
  return out;
}

/** 効果の組み合わせに合わせて対象を直す（空きマスにしか置けない部品、駒にしか効かない部品など） */
function reconcileTarget(target: ProgramTarget, effects: ProgramEffect[]): ProgramTarget {
  const needsEmpty = effects.some(e => e.op === 'SPAWN' || e.op === 'WALL' || e.op === 'TELEPORT');
  const allSelf = effects.every(e => OP_SPECS[e.op].self);
  if (allSelf) return { area: 'SELF', who: 'ALLY', pick: 'ALL', count: 1 };
  if (needsEmpty) {
    const area = target.area === 'SELF' || target.area === 'ATTACKER' ? 'ADJACENT' : target.area;
    return { ...target, area, who: 'EMPTY' };
  }
  if (target.who === 'EMPTY' && !effects.some(e => e.op === 'TILE')) return { ...target, who: 'ENEMY' };
  // 味方を強化する部品は味方に、敵を弱める部品は敵に向ける（SELF はそのまま）
  const buffs = effects.every(e => ['SHIELD', 'GUARD', 'CLEANSE', 'STEALTH'].includes(e.op));
  if (buffs && target.area !== 'SELF') return { ...target, who: 'ALLY' };
  if (target.area === 'SELF' && !buffs && !effects.some(e => e.op === 'TILE')) {
    return { ...target, area: 'ADJACENT', who: 'ENEMY' };
  }
  return target;
}

function normalizeAbility(raw: unknown, index: number): AbilityProgram | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const effects = (Array.isArray(a.effects) ? a.effects : [])
    .map(normalizeEffect)
    .filter((e): e is ProgramEffect => e !== null)
    // 同じ部品の重複は1つにまとめる
    .filter((e, i, all) => all.findIndex(o => o.op === e.op && o.tile === e.tile) === i)
    .slice(0, MAX_EFFECTS);
  if (effects.length === 0) return null;
  const trigger = oneOf(PROGRAM_TRIGGERS, a.trigger, 'ON_MOVE');
  const condition = oneOf(PROGRAM_CONDITIONS, a.condition, 'NONE');
  const selfOnly = effects.every(e => OP_SPECS[e.op].self);
  let target = reconcileTarget(normalizeTarget(a.target, selfOnly), effects);
  // 「自分を取った駒」は取られたときにしか存在しない
  if (target.area === 'ATTACKER' && trigger !== 'ON_TAKEN') target = { ...target, area: 'ADJACENT' };
  const ability: AbilityProgram = {
    name: typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 12) : `能力${index + 1}`,
    trigger,
    condition,
    target,
    effects,
    cooldown: clamp(asInt(a.cooldown, 0), 0, 99),
  };
  if (trigger === 'EVERY_N_TURNS') ability.every = clamp(asInt(a.every, 3), 2, 5);
  if (condition === 'CHANCE') ability.condition_value = clamp(asInt(a.condition_value, 50), 10, 90);
  else if (['ENEMIES_NEAR_AT_LEAST', 'ALLIES_NEAR_AT_LEAST'].includes(condition)) ability.condition_value = clamp(asInt(a.condition_value, 2), 1, 4);
  else if (['MY_HAND_AT_LEAST', 'ENEMY_HAND_AT_LEAST'].includes(condition)) ability.condition_value = clamp(asInt(a.condition_value, 2), 1, 6);
  return ability;
}

// ===== 強さの見積もりと自動調整 =====
function estimatedTargetCount(t: ProgramTarget): number {
  const areaSize: Record<string, number> = {
    SELF: 1, ADJACENT: 2.5, RADIUS_2: 4, FRONT_LINE: 1.5, LINES_8: 3, DIAGONALS: 2, CROSS: 2.5,
    ROW: 2, COLUMN: 2, ALL: 8, ENEMY_KING_AROUND: 2, ATTACKER: 1,
  };
  const size = areaSize[t.area] ?? Math.max(1, t.area.split('').filter(c => c === '1').length * 0.35);
  return t.pick === 'ALL' ? size : Math.min(size, t.count);
}

const TRIGGER_WEIGHT: Record<ProgramTrigger, number> = {
  ON_MOVE: 1, TURN_START: 1.3, EVERY_N_TURNS: 1, ON_CAPTURE: 0.8, ON_TAKEN: 0.7, ON_APPROACH: 0.9, ON_PROMOTE: 0.5,
};

/** 1回の発動の強さ（だいたい「駒1枚を消す」= 5） */
export function abilityPower(a: AbilityProgram): number {
  const targets = estimatedTargetCount(a.target);
  let power = 0;
  for (const e of a.effects) {
    const spec = OP_SPECS[e.op];
    const base = spec.cost + (spec.perValue ?? 0) * (e.value ?? 0);
    power += spec.self ? base : base * targets;
  }
  power *= TRIGGER_WEIGHT[a.trigger];
  if (a.condition === 'CHANCE') power *= (a.condition_value ?? 50) / 100;
  else if (a.condition !== 'NONE') power *= 0.75;
  return Math.round(power * 10) / 10;
}

/** 1発動あたりこの強さまでは毎回使えてよい */
const FREE_POWER = 3;
/** これを超える強さは1ゲーム1回だけ */
const ONCE_POWER = 18;

/** 強さに見合う充填手番を付ける（AI が付けた値の方が長ければそちらを使う） */
export function balanceAbility(a: AbilityProgram): AbilityProgram {
  const power = abilityPower(a);
  let required = power <= FREE_POWER ? 0 : Math.ceil((power - FREE_POWER) / 2.5);
  if (power > ONCE_POWER) required = 99;
  // EVERY_N_TURNS は間隔そのものが充填手番になる
  if (a.trigger === 'EVERY_N_TURNS') required = Math.max(required, (a.every ?? 3) - 1);
  const cooldown = required >= 99 || a.cooldown >= 99 ? 99 : Math.min(Math.max(a.cooldown, required), 8);
  return { ...a, cooldown };
}

/** AI の出力（abilities 配列）を検証・正規化・強さ調整する。使えるものが1つも無ければ null */
export function normalizeAbilityPrograms(raw: unknown): AbilityProgram[] | null {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const abilities = list
    .map(normalizeAbility)
    .filter((a): a is AbilityProgram => a !== null)
    .slice(0, MAX_ABILITIES)
    .map(balanceAbility);
  return abilities.length > 0 ? abilities : null;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
export function normalizeAppearance(raw: unknown, fallbackEmblem: string): PieceAppearance {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const emblem = typeof a.emblem === 'string' ? [...a.emblem.trim()].slice(0, 2).join('') : '';
  return {
    color: typeof a.color === 'string' && HEX_RE.test(a.color) ? a.color : '#f3e2b8',
    accent: typeof a.accent === 'string' && HEX_RE.test(a.accent) ? a.accent : '#3b2a14',
    emblem: emblem || [...fallbackEmblem].slice(0, 1).join(''),
    aura: oneOf(AURAS, a.aura, 'NONE'),
  };
}

// ===== 説明文 =====
function describeArea(area: string): string {
  if ((NAMED_AREAS as readonly string[]).includes(area)) return AREA_LABELS[area as NamedArea];
  return '指定範囲';
}

function describeTarget(t: ProgramTarget): string {
  if (t.area === 'SELF') return '自分';
  if (t.area === 'ATTACKER') return '自分を取った駒';
  const where = describeArea(t.area);
  const who = WHO_LABELS[t.who];
  const pickLabel: Record<TargetPick, string> = {
    ALL: 'すべての', NEAREST: '最も近い', FARTHEST: '最も遠い', STRONGEST: '最も強い', WEAKEST: '最も弱い', RANDOM: 'ランダムな',
  };
  if (t.pick === 'ALL') return `${where}の${pickLabel.ALL}${who}`;
  return `${where}の${pickLabel[t.pick]}${who}${t.count}${t.who === 'EMPTY' ? 'か所' : '体'}`;
}

function describeEffect(e: ProgramEffect): string {
  const spec = OP_SPECS[e.op];
  if (e.op === 'TILE') return `${e.value}手番残る${TILE_LABELS[e.tile ?? 'FIRE']}を置く`;
  if (e.op === 'STEAL_HAND') return `相手の持ち駒を${e.value}枚奪う`;
  if (e.op === 'SPAWN') return `分身を${e.value}体呼び出す`;
  if (e.op === 'DOOM') return `${e.value}手番後に消滅する呪いをかける`;
  if (spec.value) return `${e.value}${spec.label}`;
  return spec.label;
}

export function describeAbility(a: AbilityProgram): string {
  const trigger = TRIGGER_LABELS[a.trigger].replace('{n}', String(a.every ?? 3));
  const cond = CONDITION_LABELS[a.condition].replace('{n}', String(a.condition_value ?? ''));
  const effects = a.effects.map(describeEffect).join('、');
  const selfOps = a.effects.every(e => OP_SPECS[e.op].self);
  const prefix = selfOps ? '' : a.target.area === 'SELF'
    ? (a.effects.some(e => e.op === 'TILE') ? '自分のマスに：' : '自分に：')
    : `${describeTarget(a.target)}に：`;
  const body = `${prefix}${effects}`;
  const limit = a.cooldown >= 99 ? '（1ゲーム1回）' : a.cooldown > 0 ? `（使用後${a.cooldown}手番は充填中）` : '';
  return `【${a.name}】${trigger}${cond ? '、' + cond : ''}→ ${body}${limit}`;
}

/** 駒の全能力の説明（UI・ログ用） */
export function describeAbilities(list: AbilityProgram[]): string {
  return list.map(describeAbility).join('\n');
}
