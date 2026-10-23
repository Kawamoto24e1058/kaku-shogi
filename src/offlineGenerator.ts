// AIが使えないとき（無料枠切れ・障害・オフライン）の駒生成。
// 単語をキーワード辞書でカテゴリ分けし、ゲームエンジンで動作確認済みの「型（アーキタイプ）」から能力を組み立てる。
// 説明文と実際の効果（ability_spec / custom_ability）を必ず一致させるのが目的。
// 型を追加・変更したら scripts/verify-abilities.ts で実際に発動するか確認すること。
import type { AbilitySpec, CustomAbility, PieceData, VisualEffect } from './types';

type Mechanics = PieceData['mechanics_type'];
type Theme = NonNullable<PieceData['visual_theme']>;

interface Archetype {
  key: string;
  category: string;
  keywords: string[];
  names: string[];
  genre: string;
  mechanics: Mechanics;
  theme: Theme;
  grid: string;
  promotedGrid: string;
  trigger: 'ON_MOVE' | 'TURN_START' | 'ON_TAKEN';
  // custom_ability.targets にそのまま入る。自己強化系は 'SELF'
  target: string;
  actions: CustomAbility['actions'];
  cooldown: number;
  oncePerGame?: boolean;
  successRate?: number;
  visual: Pick<VisualEffect, 'trajectory_type' | 'particle_color'>;
  effectText: string;
  promotedName: string;
  // 成った後の変化。エンジンが反映するのは移動範囲 (promoted_grid) なので、それ以外の約束は書かない
  promotedText: string;
}

// 5x5 移動範囲（上が前方、中央12文字目が自分=2）
const G = {
  KING: '0000001110012100111000000',
  CROSS: '0000000100012100010000000',
  CHARGE: '0010001110012100010000000',
  KNIGHT: '0101000100012100010000000',
  DIAG: '1000101010002000101010001',
  HEAVY: '0000000100112110000000000',
  WIDE: '0111011111112111111101110',
};

const ARCHETYPES: Archetype[] = [
  {
    key: 'blaze', category: '炎・爆発',
    keywords: ['火', '炎', '焔', '爆', '燃', 'マグマ', '火山', '太陽', '花火', 'ドラゴン', '竜', '龍', 'fire'],
    names: ['業火爆砕', '烈火突進', '紅蓮一閃'], genre: '武力・突撃', mechanics: 'MOVEMENT_HACK', theme: 'WARRIOR_IRON',
    grid: G.CHARGE, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'FRONT_3_LINE', actions: ['DESTROY'], cooldown: 3,
    visual: { trajectory_type: 'BURST', particle_color: '#ff5a1f' },
    effectText: '前方一直線3マス以内の敵駒をまとめて消し飛ばす（玉将を除く）',
    promotedName: '劫火覚醒', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'frost', category: '氷・水',
    keywords: ['氷', '雪', '冬', '冷', '凍', '水', '海', '雨', '川', '湖', '波', 'ペンギン', 'アイス', 'ice', 'water'],
    names: ['氷結陣', '凍て霧', '静水封'], genre: '行動封印', mechanics: 'RULE_BREAK', theme: 'MYSTIC_MIST',
    grid: G.KING, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'SQUARE_3X3', actions: ['FREEZE'], cooldown: 3,
    visual: { trajectory_type: 'SPIRAL', particle_color: '#7dd3fc' },
    effectText: '周囲1マスの敵駒を凍らせ、しばらく動けなくする',
    promotedName: '絶対零度', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'thunder', category: '雷・光',
    keywords: ['雷', '電', '光', 'ビーム', 'レーザー', '稲妻', 'スマホ', 'ゲーム機', 'パソコン', 'ロボ', 'AI', 'thunder'],
    names: ['迅雷貫通', '天雷一閃'], genre: '貫通・狙撃', mechanics: 'MOVEMENT_HACK', theme: 'SPACE_NATURE',
    grid: G.CROSS, promotedGrid: G.KING, trigger: 'ON_MOVE', target: 'LINE_STRAIGHT', actions: ['DESTROY'], cooldown: 99, oncePerGame: true,
    visual: { trajectory_type: 'BEAM', particle_color: '#facc15' },
    effectText: '縦横斜めの直線上にいる敵駒をすべて撃ち抜く（玉将を除く）',
    promotedName: '雷神降臨', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'gale', category: '風・空',
    keywords: ['風', '嵐', '台風', '竜巻', '鳥', '翼', '飛行機', '扇風機', '空', '雲', 'wind'],
    names: ['疾風払い', '旋風陣'], genre: '空間操作', mechanics: 'DYNAMICS_HACK', theme: 'NATURE_STONE',
    grid: G.KNIGHT, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'SQUARE_3X3', actions: ['KNOCKBACK'], cooldown: 2,
    visual: { trajectory_type: 'SPIRAL', particle_color: '#a7f3d0' },
    effectText: '周囲1マスの敵駒を1マス外側へ吹き飛ばす',
    promotedName: '天嵐', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'beast', category: '獣・生き物',
    keywords: ['犬', '猫', '虎', 'ライオン', '狼', '熊', '獣', '牙', '鮫', 'サメ', 'ゴリラ', 'ワニ', '恐竜', 'dog', 'cat'],
    names: ['猛獣捕食', '牙狩り'], genre: '強制捕獲', mechanics: 'MOVEMENT_HACK', theme: 'NATURE_STONE',
    grid: G.CHARGE, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'FRONT_3_LINE', actions: ['FORCE_CAPTURE'], cooldown: 4,
    visual: { trajectory_type: 'STRIKE', particle_color: '#b45309' },
    effectText: '前方一直線3マス以内の敵駒を捕まえて自分の持ち駒にする（玉将を除く）',
    promotedName: '百獣の王', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'fortress', category: '守り・堅さ',
    keywords: ['盾', '壁', '岩', '石', '山', '城', '鉄', '鎧', '亀', '要塞', 'ダム', '金庫', 'shield'],
    names: ['金剛不壊', '鉄壁の構え'], genre: '防御・結界', mechanics: 'RULE_BREAK', theme: 'NATURE_STONE',
    grid: G.HEAVY, promotedGrid: G.KING, trigger: 'TURN_START', target: 'SELF', actions: ['GUARD_STANCE'], cooldown: 3,
    visual: { trajectory_type: 'BURST', particle_color: '#94a3b8' },
    effectText: '自身が1手番のあいだ、効果や捕獲を受け付けない絶対防護になる',
    promotedName: '不落城塞', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'shadow', category: '影・隠密',
    keywords: ['忍', '影', '闇', '夜', '霧', '幽霊', 'お化け', '暗殺', '透明', 'スパイ', '泥棒猫', 'ninja'],
    names: ['影潜り', '朧隠れ'], genre: 'ステルス・隠密', mechanics: 'STEALTH_TRAP', theme: 'SHADOW_NIGHT',
    grid: G.DIAG, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'SELF', actions: ['STEALTH_ON'], cooldown: 2,
    visual: { trajectory_type: 'SPIRAL', particle_color: '#6b21a8' },
    effectText: '自身が隠密状態になり、相手から正体が見えなくなる',
    promotedName: '影分身', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'mine', category: '罠・爆弾',
    keywords: ['爆弾', '地雷', '罠', 'トラップ', 'ダイナマイト', '手榴弾', 'ミサイル', 'bomb'],
    names: ['道連れ爆破', '仕込み地雷'], genre: '因果・罠', mechanics: 'STEALTH_TRAP', theme: 'SHADOW_NIGHT',
    grid: G.CROSS, promotedGrid: G.KING, trigger: 'ON_TAKEN', target: 'SQUARE_3X3', actions: ['DESTROY'], cooldown: 99, oncePerGame: true,
    visual: { trajectory_type: 'BURST', particle_color: '#ef4444' },
    effectText: '自身が取られた瞬間に爆発し、周囲1マスの敵駒を巻き込んで消滅させる',
    promotedName: '連鎖爆破', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'plague', category: '毒・呪い',
    keywords: ['毒', '病', 'ウイルス', '菌', '呪', '蛇', 'ヘビ', '蜘蛛', 'クモ', 'カビ', '沼', 'poison'],
    names: ['蝕みの瘴気', '呪縛の毒'], genre: '弱体化', mechanics: 'DYNAMICS_HACK', theme: 'MYSTIC_MIST',
    grid: G.KING, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'SQUARE_3X3', actions: ['TRANSFORM_PAWN'], cooldown: 4,
    visual: { trajectory_type: 'SPIRAL', particle_color: '#84cc16' },
    effectText: '周囲1マスの敵駒を、ただの歩兵に弱体化させる（玉将を除く）',
    promotedName: '蔓延', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'gravity', category: '宇宙・引力',
    keywords: ['磁石', '宇宙', '星', '惑星', 'ブラックホール', '月', '重力', '地球', '銀河', 'UFO', 'magnet'],
    names: ['重力崩壊', '引力の渦'], genre: '空間操作', mechanics: 'DYNAMICS_HACK', theme: 'SPACE_NATURE',
    grid: G.KING, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'SELF', actions: ['GRAVITY_PULL'], cooldown: 3,
    visual: { trajectory_type: 'SPIRAL', particle_color: '#818cf8' },
    effectText: '盤上の敵駒を自分のほうへ1マスずつ引き寄せる',
    promotedName: '事象の地平', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'blessing', category: '聖・癒し',
    keywords: ['神', '天使', '聖', '仏', '医', '薬', '病院', '祈', '癒', '寺', '神社', 'お守り', 'ケーキ', 'プリン', '寿司', 'ラーメン', 'カレー', 'ご飯', 'パン', '料理'],
    names: ['加護の光', '滋養の恵み'], genre: '支援・強化', mechanics: 'RULE_BREAK', theme: 'MYSTIC_MIST',
    grid: G.KING, promotedGrid: G.WIDE, trigger: 'TURN_START', target: 'SELF', actions: ['SHIELD_GAIN'], cooldown: 3,
    visual: { trajectory_type: 'BURST', particle_color: '#fde68a' },
    effectText: '自身に、攻撃や効果を1度だけ防ぐ聖盾をまとう',
    promotedName: '大いなる加護', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'thief', category: '盗み・お金',
    keywords: ['泥棒', '盗', '金', 'お金', '銀行', '怪盗', '海賊', 'カラス', '財布', '税', 'money'],
    names: ['掠め取り', '怪盗の手'], genre: '強奪', mechanics: 'DYNAMICS_HACK', theme: 'SHADOW_NIGHT',
    grid: G.KNIGHT, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'SELF', actions: ['STEAL_HAND'], cooldown: 3,
    visual: { trajectory_type: 'PARABOLA', particle_color: '#eab308' },
    effectText: '相手の持ち駒を1枚奪って自分の持ち駒にする',
    promotedName: '大怪盗', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'time', category: '時間',
    keywords: ['時', '時計', '時間', '歴史', 'タイム', '砂時計', '過去', '未来', 'clock'],
    names: ['刻止め', '時空凍結'], genre: '行動封印', mechanics: 'RULE_BREAK', theme: 'MYSTIC_MIST',
    grid: G.CROSS, promotedGrid: G.KING, trigger: 'ON_MOVE', target: 'RANGE_2', actions: ['FREEZE'], cooldown: 99, oncePerGame: true,
    visual: { trajectory_type: 'SPIRAL', particle_color: '#c4b5fd' },
    effectText: '周囲2マスの敵駒すべての時間を止め、動けなくする',
    promotedName: '永劫回帰', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'swarm', category: '群れ・増殖',
    keywords: ['人', '増', '虫', 'アリ', '蜂', '植物', '種', '草', '森', '木', '花', '桜', 'キノコ', '軍', '学校', 'クラス', '会社'],
    names: ['群生増殖', '芽吹き'], genre: '置物・量産', mechanics: 'RULE_BREAK', theme: 'NATURE_STONE',
    grid: G.CROSS, promotedGrid: G.KING, trigger: 'TURN_START', target: 'SQUARE_3X3', actions: ['SPAWN_TOKEN'], cooldown: 4,
    visual: { trajectory_type: 'BURST', particle_color: '#4ade80' },
    effectText: '周囲の空きマスに分身を生み出す（盤上に最大2体まで）',
    promotedName: '大繁殖', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'rush', category: '速さ・乗り物',
    keywords: ['車', '電車', '新幹線', '馬', '走', '速', 'ロケット', '自転車', 'チーター', 'バイク', '船', 'car'],
    names: ['全速前進', '限界突破'], genre: '機動強化', mechanics: 'MOVEMENT_HACK', theme: 'WARRIOR_IRON',
    grid: G.CHARGE, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'SELF', actions: ['OVERDRIVE_BOOST'], cooldown: 3,
    visual: { trajectory_type: 'BEAM', particle_color: '#38bdf8' },
    effectText: 'その手番だけ移動範囲が2倍になる。ただし次の手番は反動で行動できない',
    promotedName: '音速', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'gamble', category: '運・遊び',
    keywords: ['運', 'サイコロ', 'ギャンブル', 'くじ', '宝くじ', 'コイン', 'カジノ', 'トランプ', 'じゃんけん', 'ルーレット'],
    names: ['一か八か', '運命の賽'], genre: '確率・博打', mechanics: 'DYNAMICS_HACK', theme: 'UNIQUE',
    grid: G.KING, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'SQUARE_3X3', actions: ['PROBABILITY_STRIKE'], cooldown: 2, successRate: 0.5,
    visual: { trajectory_type: 'PARABOLA', particle_color: '#f472b6' },
    effectText: '周囲1マスの敵駒それぞれを50%の確率で撃破する（玉将を除く）',
    promotedName: '大当たり', promotedText: '移動範囲が大きく広がる。',
  },
  {
    key: 'blade', category: '武器・戦い',
    keywords: ['剣', '刀', '侍', '斧', '槍', '弓', '銃', '武', '騎士', '戦', '兵', 'ナイフ', 'sword'],
    names: ['一刀両断', '居合斬り', '三連突き'], genre: '武力・突撃', mechanics: 'MOVEMENT_HACK', theme: 'WARRIOR_IRON',
    grid: G.CHARGE, promotedGrid: G.WIDE, trigger: 'ON_MOVE', target: 'FRONT_3_LINE', actions: ['DESTROY'], cooldown: 3,
    visual: { trajectory_type: 'STRIKE', particle_color: '#e5e7eb' },
    effectText: '前方一直線3マス以内の敵駒を斬り伏せて消滅させる（玉将を除く）',
    promotedName: '剣聖', promotedText: '移動範囲が大きく広がる。',
  },
];

function hashWord(word: string): number {
  let hash = 0;
  for (let i = 0; i < word.length; i++) hash = (Math.imul(hash, 31) + word.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function matchArchetype(word: string): Archetype | null {
  const lower = word.toLowerCase();
  // 長いキーワードほど具体的なので優先（例: 「泥棒猫」を「猫」より先に判定）
  let best: { a: Archetype; len: number } | null = null;
  for (const a of ARCHETYPES) {
    for (const kw of a.keywords) {
      if (lower.includes(kw.toLowerCase()) && (!best || kw.length > best.len)) best = { a, len: kw.length };
    }
  }
  return best ? best.a : null;
}

/** キーワード辞書で能力型を選ぶ。該当しなければ単語から決まる疑似ランダムで選ぶ（同じ単語なら毎回同じ型） */
export function pickArchetype(word: string): Archetype {
  return matchArchetype(word) ?? ARCHETYPES[hashWord(word) % ARCHETYPES.length];
}

export const OFFLINE_ARCHETYPES: readonly Archetype[] = ARCHETYPES;

const TRIGGER_TEXT: Record<string, string> = {
  ON_MOVE: '自身の移動完了時（自動発動）',
  TURN_START: '自分の手番の開始時（自動発動）',
  ON_TAKEN: '自身が敵に取られた瞬間（自動発動）',
};

export function buildOfflinePiece(word: string, archetype: Archetype = pickArchetype(word)): PieceData {
  const a = archetype;
  const name = a.names[hashWord(word) % a.names.length];
  const limitText = a.oncePerGame
    ? '1ゲームに1回限り。使用後は前後左右1マスの十字移動のみになる。'
    : `使用後${a.cooldown}手番は充填中となり、前後左右1マスの十字移動のみになる。`;
  const spec: AbilitySpec = {
    activation_type: a.trigger === 'ON_TAKEN' ? 'PASSIVE' : 'AUTO_TRIGGER',
    activation_trigger: a.trigger,
    range: a.target === 'RANGE_2' ? 2 : 1,
    target_selection: a.target === 'SELF' ? 'SELF' : 'AUTOMATIC',
    area_shape: (a.target === 'SELF' ? 'POINT' : a.target) as AbilitySpec['area_shape'],
    effect_type: a.actions[0] as AbilitySpec['effect_type'],
    actions: [...a.actions] as AbilitySpec['actions'],
    affects_who: a.target === 'SELF' ? 'ALLY_ONLY' : 'ENEMY_ONLY',
    cooldown_turns: a.cooldown,
    ...(a.successRate ? { success_rate: a.successRate } : {}),
  };
  const visual: VisualEffect = { ...a.visual, particle_count: 50, particle_speed: 1.2, screen_shake: a.oncePerGame ? 4 : 2 };

  return {
    word,
    effect_name: name,
    mechanics_type: a.mechanics,
    ability_genre: a.genre,
    visual_theme: a.theme,
    trigger: a.trigger,
    cool_down_turns: a.cooldown,
    is_once_per_game: !!a.oncePerGame,
    range_geometry: { normal_grid: a.grid, charging_grid: G.CROSS, promoted_grid: a.promotedGrid },
    description: `【発動条件】${TRIGGER_TEXT[a.trigger]}。\n【効果内容】「${word}」の力で、${a.effectText}。\n【制限・代償】${limitText}`,
    spawn_piece_name: a.key === 'swarm' ? `${word}の分身` : null,
    ...(a.key === 'swarm' ? { spawn_config: { spawn_piece_name: `${word}の分身`, max_limit: 2, spawn_range_geometry: G.KING } } : {}),
    ability_spec: spec,
    // エンジンは custom_ability を優先して実行するため、ここで明示して説明文と一致させる
    custom_ability: {
      ability_name: name,
      flavor_text: a.effectText,
      triggers: [a.trigger],
      targets: [a.target],
      actions: [...a.actions],
      constraints: a.oncePerGame ? ['ONCE'] : [`COOLDOWN_${a.cooldown}`],
      remaining_uses: 3,
      target_mode: 'SELF_CENTERED',
      ...(a.successRate ? { success_rate: a.successRate } : {}),
    } as CustomAbility,
    visual_effect: visual,
    promoted_effect: {
      effect_name: a.promotedName,
      description: `【発動条件】成ることで自動適用。\n【効果内容】${a.promotedText}\n【制限・代償】基本の制限は維持される。`,
      ability_spec: { ...spec },
      visual_effect: visual,
    },
    logic_code: 'normal',
    deep_search_analysis: matchArchetype(word) === a
      ? `「${word}」を「${a.category}」系の言葉と判定し、その性質に合う能力型を割り当てました（簡易生成）。`
      : `「${word}」に合うキーワードが見つからなかったため、能力型を自動で割り当てました（簡易生成）。`,
  };
}
