// 能力アクションのカタログ（クライアント・サーバー共通）
// ゲームエンジン (src/gameLogic.ts の ActionRegistry) が実際に実行できるアクションだけをここに列挙し、
// AIへの指示（responseSchema）とサニタイザの両方で同じリストを参照する。
// ActionRegistry にアクションを追加したら、ここにも追加すること。

export const SUPPORTED_ACTIONS = [
  'DESTROY', 'FREEZE', 'KNOCKBACK', 'KNOCKBACK_MAX', 'SWAP_POSITION', 'PULL_1', 'RE_ACTION',
  'AUTO_FOLLOW_UP', 'STEALTH_ON', 'SHIELD_GAIN', 'SPAWN_TOKEN', 'INVERT_DIR', 'FORCE_CAPTURE',
  'TRANSFORM_PAWN', 'STEAL_HAND', 'TIME_REWIND', 'BOOMERANG', 'GRAVITY_PULL', 'SHARE_FATE',
  'WALL_CREATE', 'LEAVE_TRAIL_FIRE', 'EVOLUTION', 'MIND_CONTROL', 'CLEAR_DEBUFF', 'MAGNET_PULL',
  'KNOCKBACK_BUMP', 'POS_SWAP_ENEMY', 'STUN_LOCK', 'PENETRATE_STRIKE', 'VAULT_EXECUTE',
  'CLEAVE_LINE', 'GUARD_STANCE', 'SILENCE_SEAL', 'OVERDRIVE_BOOST', 'PROBABILITY_STRIKE',
  'CHAOS_GAMBLE', 'LUCKY_DODGE', 'SET_TILE_FIRE', 'SET_TILE_POISON', 'SET_TILE_ICE',
  'SET_TILE_BOMB', 'SET_TILE_TRAP', 'DELAYED_BURST', 'CHARGE_TURN', 'SACRIFICE_COST',
  'SELF_STUN', 'EVOLUTION_CHECK',
] as const;

export type SupportedAction = typeof SUPPORTED_ACTIONS[number];

// 旧プロンプトで案内していたがエンジンに実装が無いキー → 実装済みキーへの読み替え
export const ACTION_ALIASES: Record<string, SupportedAction | null> = {
  CAPTURE: 'FORCE_CAPTURE',
  IMMOBILIZE: 'STUN_LOCK',
  SWAP: 'SWAP_POSITION',
  PULL: 'MAGNET_PULL',
  PUSH: 'KNOCKBACK_BUMP',
  STEALTH: 'STEALTH_ON',
  SPAWN: 'SPAWN_TOKEN',
  TRANSFORM: 'TRANSFORM_PAWN',
  RESURRECT: null, // 蘇生はアクションではなく logic_code 'recycle_dead' 側で扱う
};

// AIに見せるアクションの日本語説明（プロンプト・UIで共用）
export const ACTION_LABELS: Record<SupportedAction, string> = {
  DESTROY: '対象を消滅（墓地送り）',
  FREEZE: '対象を凍結し行動不能にする',
  KNOCKBACK: '対象を1マス押し出す',
  KNOCKBACK_MAX: '対象を盤端まで吹き飛ばす',
  SWAP_POSITION: '対象と位置を入れ替える',
  PULL_1: '対象を1マス引き寄せる',
  RE_ACTION: 'もう一度行動できる',
  AUTO_FOLLOW_UP: '追撃を自動で行う',
  STEALTH_ON: '自身を隠密状態にする',
  SHIELD_GAIN: '自身または味方に聖盾を付与',
  SPAWN_TOKEN: '空きマスに分身トークンを召喚（最大2体）',
  INVERT_DIR: '対象の移動方向を反転させる',
  FORCE_CAPTURE: '対象を強制捕獲して持ち駒にする',
  TRANSFORM_PAWN: '対象を歩兵に弱体化',
  STEAL_HAND: '相手の持ち駒を1枚奪う',
  TIME_REWIND: '対象を前の手番の位置へ戻す',
  BOOMERANG: '行動後に元のマスへ帰還',
  GRAVITY_PULL: '敵駒を自分へ1マス引き寄せる',
  SHARE_FATE: '自分が倒されたとき対象も道連れ',
  WALL_CREATE: '空きマスに障害物を生成',
  LEAVE_TRAIL_FIRE: '移動経路に炎の足跡を残す',
  EVOLUTION: '自身が成長して強化される',
  MIND_CONTROL: '対象を一時的に寝返らせる',
  CLEAR_DEBUFF: '味方の状態異常を解除',
  MAGNET_PULL: '対象を手前へ引き寄せる',
  KNOCKBACK_BUMP: '体当たりで弾き飛ばす',
  POS_SWAP_ENEMY: '敵同士または敵と位置交換',
  STUN_LOCK: '対象を数手番麻痺させる',
  PENETRATE_STRIKE: '直線上を貫通して撃破',
  VAULT_EXECUTE: '飛び越えた敵を撃破',
  CLEAVE_LINE: '縦一列を一掃',
  GUARD_STANCE: '一定手番、絶対防護になる',
  SILENCE_SEAL: '対象の能力を封印',
  OVERDRIVE_BOOST: '一時的に機動力が倍増',
  PROBABILITY_STRIKE: '確率で対象を撃破',
  CHAOS_GAMBLE: '良くも悪くもランダムな効果',
  LUCKY_DODGE: '確率で捕獲を回避',
  SET_TILE_FIRE: '数手番残る炎のマスを置き、そこにいる敵駒を焼き払う',
  SET_TILE_POISON: '数手番残る毒沼を置き、そこにいる敵駒を1手番麻痺させる',
  SET_TILE_ICE: '数手番残る氷床を置き、そこにいる敵駒を1手番止める',
  SET_TILE_BOMB: '時限爆弾を置き、数手番後に周囲1マスの駒（敵味方問わず・玉将以外）を吹き飛ばす',
  SET_TILE_TRAP: '見えない罠を置き、踏んだ敵駒を倒す',
  DELAYED_BURST: '数手番後に遅れて発動（代償）',
  CHARGE_TURN: '発動前に溜めが必要（代償）',
  SACRIFICE_COST: '味方を犠牲にして発動（代償）',
  SELF_STUN: '発動後に自身が麻痺（代償）',
  EVOLUTION_CHECK: '条件を満たすと進化',
};

export const AREA_SHAPES = [
  'POINT', 'SQUARE_3X3', 'SQUARE_5X5', 'CROSS', 'LINE_STRAIGHT', 'RANGE_2', 'RANGE_3',
  'LINE_DIAGONAL', 'KNIGHT_JUMP_ALL', 'FRONT_3_LINE', 'ALL_ENEMY_PIECES', 'LEADER_SURROUND',
] as const;

export const ACTIVATION_TRIGGERS = ['ON_MOVE', 'TURN_START', 'ON_TAKEN', 'ON_APPROACH', 'ALWAYS'] as const;
export const TARGET_SELECTIONS = ['CLICK_ZONE', 'AUTOMATIC', 'SELF'] as const;
export const AFFECTS_WHO = ['ENEMY_ONLY', 'ALL_PIECES', 'ALLY_ONLY', 'EMPTY_ONLY'] as const;
export const ACTIVATION_TYPES = ['ACTIVE', 'AUTO_TRIGGER', 'PASSIVE'] as const;
export const TRAJECTORIES = ['PARABOLA', 'BEAM', 'STRIKE', 'SPIRAL', 'BURST'] as const;
export const VISUAL_THEMES = ['WARRIOR_IRON', 'MYSTIC_MIST', 'SHADOW_NIGHT', 'NATURE_STONE', 'SPACE_NATURE', 'UNIQUE'] as const;

const SUPPORTED_SET = new Set<string>(SUPPORTED_ACTIONS);

/** 未知・旧形式のアクションキーを実装済みキーへ正規化し、重複を除いて最大3つに丸める */
export function normalizeActions(raw: unknown): SupportedAction[] {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
  const out: SupportedAction[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const key = item.trim().toUpperCase();
    const mapped = SUPPORTED_SET.has(key) ? (key as SupportedAction) : ACTION_ALIASES[key];
    if (mapped && !out.includes(mapped)) out.push(mapped);
    if (out.length >= 3) break;
  }
  return out;
}
