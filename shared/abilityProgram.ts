// 能力プログラム（v2）: 能力を「きっかけ・条件・対象・効果」の部品の組み合わせで表す（クライアント・サーバー共通）
// AI はこの形のデータを書き、src/abilityEngine.ts がそれを実行する。AI が書けるのはデータだけなので、
// どんな単語でもプログラムが勝手に動くことはなく、同じデータからは同じ処理になる（オンライン対戦でもずれない）。
// 強さは部品ごとのコストで見積もり、強すぎる能力には自動で充填手番（クールダウン）や1回限りの制限を付ける。
// 効果の説明文（rules text）もこのデータから機械的に作るので、説明と実際の動きが食い違わない。

export const PROGRAM_TRIGGERS = ['ON_MOVE', 'TURN_START', 'EVERY_N_TURNS', 'ON_CAPTURE', 'ON_TAKEN', 'ON_APPROACH', 'ON_PROMOTE', 'ON_DROP', 'ON_ALLY_TAKEN'] as const;
export type ProgramTrigger = typeof PROGRAM_TRIGGERS[number];
/** 実際に使う発動タイミング。残りは古い駒を読み込むときに ON_MOVE へ読み替える（normalizeAbility） */
export const PLAYER_TRIGGERS = ['ON_MOVE', 'ON_CAPTURE', 'ON_PROMOTE', 'ON_TAKEN', 'ON_DROP', 'ON_ALLY_TAKEN'] as const;

/**
 * 能力の持ち方。SINGLE = 能力1つ（基本）。RANDOM = 2〜3個の能力から、発動のたびに1つがランダムに選ばれる
 * （ガチャ・サイコロ・気まぐれな猫など、運や気まぐれが本質の単語だけ）
 */
export type AbilityMode = 'SINGLE' | 'RANDOM';

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

export const TILE_KINDS = ['FIRE', 'POISON', 'ICE', 'BOMB', 'TRAP', 'HOLY', 'SEAL', 'SPRING'] as const;
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
  /** 代償（リスク・デメリット）。強い能力はこれを払う代わりに充填が短くなる */
  drawback?: AbilityDrawback;
}

// ===== 代償（強い能力のリスク・デメリット） =====
export const DRAWBACK_KINDS = ['RECOIL', 'SACRIFICE', 'HAND_COST', 'FRIENDLY_FIRE'] as const;
export type DrawbackKind = typeof DRAWBACK_KINDS[number];
export interface AbilityDrawback {
  kind: DrawbackKind;
  /** 反動の手番数・代価の枚数 */
  value?: number;
}
interface DrawbackSpec {
  label: string;
  /** 説明（{n} は value） */
  text: string;
  value?: [number, number, number];
  /** この代償で払える強さ（強さの見積もりから差し引く）。power は能力の強さ */
  relief: (value: number, power: number) => number;
}
export const DRAWBACK_SPECS: Record<DrawbackKind, DrawbackSpec> = {
  // 自動対局: 1手番あたり3を差し引くと「盤上の2体を消す」が勝率69%まで強くなったので2にする
  RECOIL: { label: '反動', text: '使った後、この駒は{n}手番動けない', value: [1, 3, 1], relief: v => 2 * v },
  SACRIFICE: { label: '捨て身', text: '使うと、この駒も消える', relief: () => 9 },
  HAND_COST: { label: '代価', text: '使うたびに自分の持ち駒を{n}枚捨てる（足りなければ使えない）', value: [1, 2, 1], relief: v => 3 * v },
  FRIENDLY_FIRE: { label: '巻き添え', text: '範囲にいる味方の駒にも効く', relief: (_v, power) => power * 0.35 },
};
/** 敵に向けて使う害のある部品（巻き添えで味方にも効く意味があるもの） */
const HARMFUL_OPS = new Set(['DESTROY', 'CAPTURE', 'PUSH', 'PULL', 'FREEZE', 'STUN', 'SILENCE', 'DOOM', 'TRANSFORM_PAWN']);
const DRAWBACK_NAMES: Record<string, DrawbackKind> = { 反動: 'RECOIL', 捨て身: 'SACRIFICE', 自爆: 'SACRIFICE', 代価: 'HAND_COST', 巻き添え: 'FRIENDLY_FIRE' };

/** AIの書いた代償を読む。発動のきっかけや効果と組み合わせて意味のないものは捨てる */
function normalizeDrawback(raw: unknown, trigger: ProgramTrigger, effects: ProgramEffect[], target: ProgramTarget): AbilityDrawback | undefined {
  if (!raw) return undefined;
  const obj = (typeof raw === 'object' ? raw : { kind: raw }) as Record<string, unknown>;
  const name = String(obj.kind ?? obj.type ?? '').trim();
  const kind = (DRAWBACK_KINDS as readonly string[]).includes(name.toUpperCase()) ? name.toUpperCase() as DrawbackKind : DRAWBACK_NAMES[name];
  if (!kind) return undefined;
  // 取られたときは、この駒はもう盤上にいないので「動けない」「この駒も消える」は意味がない
  if ((kind === 'RECOIL' || kind === 'SACRIFICE') && trigger === 'ON_TAKEN') return undefined;
  // 巻き添えは、敵に害のある効果を範囲に使う能力だけ
  if (kind === 'FRIENDLY_FIRE' && (!effects.some(e => HARMFUL_OPS.has(e.op)) || target.who !== 'ENEMY' || ['SELF', 'ATTACKER'].includes(target.area))) return undefined;
  const spec = DRAWBACK_SPECS[kind];
  const drawback: AbilityDrawback = { kind };
  if (spec.value) drawback.value = clamp(asInt(obj.value, spec.value[2]), spec.value[0], spec.value[1]);
  return drawback;
}

export function describeDrawback(d: AbilityDrawback): string {
  const spec = DRAWBACK_SPECS[d.kind];
  return `${spec.label}：${spec.text.replace('{n}', String(d.value ?? spec.value?.[2] ?? ''))}`;
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
const NEEDS_SELF_ON_BOARD = new Set<ProgramOp>(['SWAP', 'TELEPORT', 'STEALTH', 'EXTRA_ACTION']);
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
  // 捕獲は「相手の駒が減る」＋「自分の持ち駒が増える」。CPUが能力を狙うようにしたら、縦一列の捕獲が勝率80%になった
  CAPTURE: { value: null, cost: 8, label: '捕獲して持ち駒にする' },
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
  // 自動対局で勝率59%と強めだったので、充填手番が長くなるよう重めに見積もる
  EXTRA_ACTION: { value: null, cost: 12, self: true, label: 'もう一度行動できる' },
  SPAWN: { value: [1, 3, 1], cost: 1.5, perValue: 1.5, label: '体の分身を呼び出す' },
  WALL: { value: [1, 4, 2], cost: 0.6, perValue: 0.2, label: '手番残る壁を置く' },
  TILE: { value: [1, 5, 3], cost: 0.8, perValue: 0.2, label: '手番残る地形を置く' },
  // 奪うと「相手が減って自分が増える」ので持ち駒の差は2倍動く。自動対局で「味方が取られたら2枚奪う」が勝率97%だった
  STEAL_HAND: { value: [1, 2, 1], cost: 4, perValue: 4, self: true, label: '枚、相手の持ち駒を奪う' },
};

export const TRIGGER_LABELS: Record<ProgramTrigger, string> = {
  ON_MOVE: '自分が動いた後',
  TURN_START: '自分の手番の開始時',
  EVERY_N_TURNS: '{n}手番ごと（手番の開始時）',
  ON_CAPTURE: '敵駒を取ったとき',
  ON_TAKEN: '自分が取られたとき',
  ON_APPROACH: '敵駒が隣に来たとき',
  ON_PROMOTE: '成ったとき',
  ON_DROP: '持ち駒から打ったとき',
  ON_ALLY_TAKEN: '味方の駒が取られたとき（仇討ち）',
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
/** 地形の名前。HOLY は味方を守り、ほかは敵が乗ると発動する（設置型の能力） */
export const TILE_LABELS: Record<TileKind, string> = { FIRE: '炎', POISON: '毒沼', ICE: '氷床', BOMB: '時限爆弾', TRAP: '見えない罠', HOLY: '聖域', SEAL: '封印陣', SPRING: '跳ね床' };

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
/**
 * 駒を盤から取り除く・奪う部品。1回の発動で何体にでも効くと「盤上の敵を全部消す」で即勝ちになるため
 * （自動対局で勝率98%）、対象は最大 MAX_REMOVAL_TARGETS 体に絞る
 */
const REMOVAL_OPS = new Set<ProgramOp>(['DESTROY', 'CAPTURE', 'TRANSFORM_PAWN', 'CONTROL', 'DOOM']);
export const MAX_REMOVAL_TARGETS = 2;

function reconcileTarget(target: ProgramTarget, effects: ProgramEffect[]): ProgramTarget {
  const reconciled = reconcileTargetKind(target, effects);
  if (effects.some(e => REMOVAL_OPS.has(e.op)) && reconciled.area !== 'SELF' && reconciled.area !== 'ATTACKER') {
    return {
      ...reconciled,
      // 「全員」は「近い順に2体」にする。選び方の指定（最も強い・ランダムなど）はそのまま
      pick: reconciled.pick === 'ALL' ? 'NEAREST' : reconciled.pick,
      count: Math.min(reconciled.pick === 'ALL' ? MAX_REMOVAL_TARGETS : reconciled.count, MAX_REMOVAL_TARGETS),
    };
  }
  return reconciled;
}

function reconcileTargetKind(target: ProgramTarget, effects: ProgramEffect[]): ProgramTarget {
  const needsEmpty = effects.some(e => e.op === 'SPAWN' || e.op === 'WALL' || e.op === 'TELEPORT');
  const allSelf = effects.every(e => OP_SPECS[e.op].self);
  if (allSelf) return { area: 'SELF', who: 'ALLY', pick: 'ALL', count: 1 };
  if (needsEmpty) {
    const area = target.area === 'SELF' || target.area === 'ATTACKER' ? 'ADJACENT' : target.area;
    return { ...target, area, who: 'EMPTY' };
  }
  if (target.who === 'EMPTY' && !effects.some(e => e.op === 'TILE')) return { ...target, who: 'ENEMY' };
  // 隣の駒はそれ以上引き寄せられない。「周囲1マスを引き寄せる」は何も起きないので、周囲2マスに広げる
  if (effects.some(e => e.op === 'PULL') && target.area === 'ADJACENT') return { ...target, area: 'RADIUS_2' };
  // 味方を強化する部品は味方に、敵を弱める部品は敵に向ける（SELF はそのまま）
  const buffs = effects.every(e => ['SHIELD', 'GUARD', 'CLEANSE', 'STEALTH'].includes(e.op) || (e.op === 'TILE' && e.tile === 'HOLY'));
  if (buffs && target.area !== 'SELF') return { ...target, who: 'ALLY' };
  if (target.area === 'SELF' && !buffs && !effects.some(e => e.op === 'TILE')) {
    return { ...target, area: 'ADJACENT', who: 'ENEMY' };
  }
  return target;
}

function normalizeAbility(raw: unknown, index: number): AbilityProgram | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  // 発動は「自分の操作がきっかけ」のものだけにする（動いた後・取ったとき・成ったとき）＋「取られたとき（罠）」。
  // 手番の開始時・◯手番ごと・敵が隣に来たときは、操作と関係なく勝手に発動して分かりにくいので「動いた後」に読み替える
  let trigger = oneOf(PROGRAM_TRIGGERS, a.trigger, 'ON_MOVE');
  if (!(PLAYER_TRIGGERS as readonly string[]).includes(trigger)) trigger = 'ON_MOVE';
  const validEffects = (Array.isArray(a.effects) ? a.effects : [])
    .map(normalizeEffect)
    .filter((e): e is ProgramEffect => e !== null);
  // 「取られたら逃げる」（取られたときの瞬間移動・入れ替え・隠れる）は、取られた後では実行できない。
  // 能力ごと捨てずに「動いた後に逃げる・隠れる」へ読み替えて、AIの狙いを残す
  if (trigger === 'ON_TAKEN' && validEffects.length > 0 && validEffects.every(e => NEEDS_SELF_ON_BOARD.has(e.op))) {
    trigger = 'ON_MOVE';
  }
  const effects = validEffects
    // 取られたときは自分はもう盤上にいないので、自分が動く・自分に掛ける部品は使えない
    .filter(e => trigger !== 'ON_TAKEN' || !NEEDS_SELF_ON_BOARD.has(e.op))
    // 同じ部品の重複は1つにまとめる
    .filter((e, i, all) => all.findIndex(o => o.op === e.op && o.tile === e.tile) === i)
    .slice(0, MAX_EFFECTS);
  if (effects.length === 0) return null;
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
  const drawback = normalizeDrawback(a.drawback, trigger, effects, target);
  if (drawback) {
    ability.drawback = drawback;
    // 巻き添え: 範囲の味方にも同じ効果が及ぶ
    if (drawback.kind === 'FRIENDLY_FIRE') ability.target = { ...ability.target, who: 'ANY' };
  }
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
  ON_MOVE: 1, TURN_START: 1.3, EVERY_N_TURNS: 1, ON_CAPTURE: 0.8, ON_TAKEN: 0.7, ON_APPROACH: 0.9, ON_PROMOTE: 0.5, ON_DROP: 0.7,
  // 仇討ちは相手の手番に、手を使わずに何度も起きる
  ON_ALLY_TAKEN: 1.1,
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
  // 自動対局での実測に合わせた補正:
  // 動かずに手番開始で遠くの駒を取り除ける能力は、繰り返すだけで駒得が積み上がる（「盤上の近い2体を消す」が勝率96%）
  const removes = a.effects.some(e => REMOVAL_OPS.has(e.op));
  const passive = a.trigger === 'TURN_START' || a.trigger === 'EVERY_N_TURNS';
  const remote = !['SELF', 'ADJACENT', 'ATTACKER'].includes(a.target.area);
  if (removes && passive && remote) power *= 2;
  else if (removes && remote) power *= 1.4;
  // 盤上全体・敵玉の周りを狙えること自体が強い
  if (a.target.area === 'ALL' || a.target.area === 'ENEMY_KING_AROUND') power *= 1.5;
  // 確率（CHANCE）は1回あたりの強さを下げない。外れても次の手番にまた引けるので、使える頻度だけが下がる
  // （balanceAbility で充填手番から「当たるまでの平均の待ち」を差し引く）。
  // 以前は強さに確率を掛けていたため「20%で盤上の敵を捕獲」がほぼ毎回使え、自動対局で勝率80%になった
  if (a.condition !== 'NONE' && a.condition !== 'CHANCE') power *= 0.75;
  return Math.round(power * 10) / 10;
}

/** 1発動あたりこの強さまでは毎回使えてよい */
const FREE_POWER = 3;
/** これを超える強さは1ゲーム1回だけ */
const ONCE_POWER = 18;
/** 代償があっても、これを超える強さ（代償を引く前）は1ゲーム1回だけ */
const ONCE_POWER_RAW = 20;

/** これより強い能力で代償が書かれていなければ、自動で「反動」を付ける（充填だけで抑えると、強い能力がどれも同じ「たまにしか使えない技」になる） */
const AUTO_DRAWBACK_POWER = 10;

/**
 * 強さに見合う充填手番を付ける（AI が付けた値の方が長ければそちらを使う）。
 * 代償（反動・捨て身・代価・巻き添え）がある能力は、その分だけ強さを差し引いて充填を短くする
 */
export function balanceAbility(a: AbilityProgram): AbilityProgram {
  const power = abilityPower(a);
  let drawback = a.drawback;
  if (!drawback && power > AUTO_DRAWBACK_POWER && a.trigger !== 'ON_TAKEN') {
    drawback = { kind: 'RECOIL', value: power > 16 ? 2 : 1 };
  }
  const relief = drawback ? DRAWBACK_SPECS[drawback.kind].relief(drawback.value ?? DRAWBACK_SPECS[drawback.kind].value?.[2] ?? 1, power) : 0;
  const effective = Math.max(0, power - relief);
  let required = effective <= FREE_POWER ? 0 : Math.ceil((effective - FREE_POWER) / 2.5);
  // 確率で発動する能力は、当たるまで平均 (1/確率 - 1) 手番待つので、その分だけ充填手番を短くする
  if (a.condition === 'CHANCE') required = Math.max(0, required - Math.floor(100 / (a.condition_value ?? 50) - 1));
  if (effective > ONCE_POWER || (power > ONCE_POWER_RAW && drawback?.kind !== 'SACRIFICE')) required = 99;
  // EVERY_N_TURNS は間隔そのものが充填手番になる
  if (a.trigger === 'EVERY_N_TURNS') required = Math.max(required, (a.every ?? 3) - 1);
  const cooldown = required >= 99 || a.cooldown >= 99 ? 99 : Math.min(Math.max(a.cooldown, required), 8);
  return drawback ? { ...a, cooldown, drawback } : { ...a, cooldown };
}

/** AI の出力（abilities 配列）を検証・正規化・強さ調整する。使えるものが1つも無ければ null */
export function normalizeAbilityPrograms(raw: unknown, mode: AbilityMode = 'SINGLE'): AbilityProgram[] | null {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  let abilities = list
    .map(normalizeAbility)
    .filter((a): a is AbilityProgram => a !== null);
  if (mode === 'RANDOM') {
    // ランダム型は、どれが選ばれても同じタイミングで発動するようにそろえる
    // 毎手番は回せないよう、どの結果にも最低2手番の充填を付ける（エンジン側でランダム型の充填は全能力で共有する）
    abilities = abilities.slice(0, MAX_ABILITIES).map(a => ({ ...a, trigger: abilities[0].trigger, cooldown: Math.max(a.cooldown, 2) }));
  } else if (abilities.length > 1) {
    // 能力は1つ。AIが複数書いたとき（古い駒も含む）は、いちばん強い＝その駒の主役の能力を残す
    abilities = [abilities.reduce((best, a) => (abilityPower(a) > abilityPower(best) ? a : best))];
  }
  abilities = abilities.map(balanceAbility);
  return abilities.length > 0 ? abilities : null;
}

/** AI の出力から能力の持ち方を読む。2つ以上の能力を書いていても、RANDOM と明示されていなければ SINGLE */
export function normalizeAbilityMode(raw: unknown): AbilityMode {
  return raw === 'RANDOM' ? 'RANDOM' : 'SINGLE';
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
  const cost = a.drawback ? `【代償】${describeDrawback(a.drawback)}` : '';
  return `【${a.name}】${trigger}${cond ? '、' + cond : ''}→ ${body}${limit}${cost}`;
}

/** 駒の全能力の説明（UI・ログ用） */
export function describeAbilities(list: AbilityProgram[], mode: AbilityMode = 'SINGLE'): string {
  const lines = list.map(describeAbility);
  if (mode === 'RANDOM' && list.length > 1) return ['発動のたびに、次のうち1つがランダムに選ばれる（選ばれた能力の充填中は、どれも使えない）', ...lines].join('\n');
  return lines.join('\n');
}

// ===== 性質（ずっと働く、駒の動き方そのものの特徴。能力の一種として、発動の能力と組み合わせて持てる） =====
export const TRAIT_KINDS = ['WILD', 'FICKLE', 'WARP', 'UNDYING', 'GROWTH', 'LIFESPAN', 'SLOW', 'COWARD', 'FLYING', 'TAUNT', 'SPLIT', 'REFLECT', 'HEAVY', 'INVISIBLE'] as const;
export type TraitKind = typeof TRAIT_KINDS[number];

export interface PieceTrait {
  kind: TraitKind;
  /** 寿命の手番数など（性質によって使わない） */
  value?: number;
}

interface TraitSpec {
  label: string;
  /** 説明（{n} は value） */
  text: string;
  /** value の範囲と既定値 [最小, 最大, 既定] */
  value?: [number, number, number];
  /**
   * 発動の能力の充填手番に足す数。弱点になる性質（操作できない・寿命など）は短くし、
   * 得をする性質（不死身・成長）は長くして釣り合いを取る
   */
  cooldownDelta: number;
  /**
   * 総合力（shared/pieceBudget.ts）での点数。得な性質は正、弱点の性質は負。
   * 較正用の自動対局（2100局）で測った勝率の差から決め、標本が少ないので半分に縮めている
   */
  power: number;
}

export const TRAIT_SPECS: Record<TraitKind, TraitSpec> = {
  WILD: { label: '暴れ馬', text: '操作できない。自分の手番の終わりに、敵に向かって勝手に動く（取れる敵がいれば取りにいく）', cooldownDelta: -2, power: 2 },
  FICKLE: { label: '気まぐれ', text: '動かすと、3回に1回くらい指示とは別のマスへ動いてしまう', cooldownDelta: -1, power: -1 },
  WARP: { label: 'ワープ癖', text: '自分の手番の終わりに、周囲2マスの空きマスへ勝手に瞬間移動する', cooldownDelta: 0, power: -1.5 },
  UNDYING: { label: '不死身', text: '1回だけ、取られても自陣の空きマスによみがえる', cooldownDelta: 2, power: 3 },
  GROWTH: { label: '成長', text: '敵を取るたびに移動範囲が広がる（2段階まで）', cooldownDelta: 1, power: 3 },
  LIFESPAN: { label: '寿命', text: '盤上に出てから自分の手番{n}回で消える', value: [4, 10, 7], cooldownDelta: -2, power: -2 },
  SLOW: { label: '鈍足', text: '一度動くと、次の自分の手番は休み（2手番に1回しか動けない）', cooldownDelta: -2, power: 2 },
  COWARD: { label: '臆病', text: '敵が隣に来ると、相手の手番の終わりに自動で1マス逃げる', cooldownDelta: 0, power: -2 },
  FLYING: { label: '飛行', text: '空を飛ぶので、地形（炎・毒沼・氷・隠し罠）の効果を受けない', cooldownDelta: 0, power: 2 },
  TAUNT: { label: '挑発', text: '敵の能力は、届く範囲にこの駒がいれば必ずこの駒を先に狙う（味方の身代わりになる）', cooldownDelta: -2, power: -1 },
  SPLIT: { label: '分裂', text: '1回だけ、取られると隣の空きマスに分身が残る（本体は普通に取られる。分身は能力を持たない）', cooldownDelta: 1, power: 3.5 },
  REFLECT: { label: '反射', text: '1回だけ、敵の能力を受けずに跳ね返す（凍結・麻痺・封印・呪いは使った駒に返る）', cooldownDelta: 2, power: 2 },
  HEAVY: { label: '重量', text: '重すぎて、敵の能力で押す・引く・入れ替えることができない', cooldownDelta: 0, power: -2 },
  INVISIBLE: { label: '透明', text: '自分の手番の終わりに、隣に敵がいなければ姿を消す（相手からは見えない。取ったり取られたりすると姿を現す）', cooldownDelta: 1, power: 0 },
};

/** AI の出力（trait: { kind, value } / "WILD" / 日本語の名前）を読む。性質なしなら null */
export function normalizeTrait(raw: unknown): PieceTrait | null {
  if (!raw) return null;
  const obj = (typeof raw === 'object' ? raw : { kind: raw }) as Record<string, unknown>;
  const name = String(obj.kind ?? obj.type ?? '').trim();
  const kind = (TRAIT_KINDS as readonly string[]).includes(name.toUpperCase())
    ? name.toUpperCase() as TraitKind
    : TRAIT_KINDS.find(k => TRAIT_SPECS[k].label === name);
  if (!kind) return null;
  const spec = TRAIT_SPECS[kind];
  const trait: PieceTrait = { kind };
  if (spec.value) trait.value = clamp(asInt(obj.value, spec.value[2]), spec.value[0], spec.value[1]);
  return trait;
}

/** 性質の説明（能力一覧・説明文用） */
export function describeTrait(trait: PieceTrait): string {
  const spec = TRAIT_SPECS[trait.kind];
  return `【性質：${spec.label}】${spec.text.replace('{n}', String(trait.value ?? spec.value?.[2] ?? ''))}`;
}

/** 性質に合わせて、発動の能力の充填手番を調整する（1ゲーム1回の能力はそのまま） */
export function applyTraitBalance(abilities: AbilityProgram[], trait: PieceTrait | null): AbilityProgram[] {
  if (!trait) return abilities;
  const delta = TRAIT_SPECS[trait.kind].cooldownDelta;
  if (!delta) return abilities;
  return abilities.map(a => (a.cooldown >= 99 ? a : { ...a, cooldown: Math.max(0, Math.min(8, a.cooldown + delta)) }));
}
