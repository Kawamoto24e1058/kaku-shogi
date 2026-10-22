// Gemini の構造化出力 (responseSchema) 定義
// enum でエンジンが実行できる値だけに制限し、「説明文はあるのに効果が不発」を防ぐ。
import {
  SUPPORTED_ACTIONS, AREA_SHAPES, ACTIVATION_TRIGGERS, TARGET_SELECTIONS,
  AFFECTS_WHO, ACTIVATION_TYPES, TRAJECTORIES, VISUAL_THEMES,
} from '../../shared/abilityCatalog.js';

const str = (description?: string) => ({ type: 'STRING', ...(description ? { description } : {}) });
const enumOf = (values: readonly string[], description?: string) => ({ type: 'STRING', enum: [...values], ...(description ? { description } : {}) });
const GRID_DESC = '5x5グリッドを25文字の0/1/2で表す。中央(13文字目)は自分自身で必ず2';
// エンジン (getValidMoves / 自律行動) が解釈できる移動パターンだけを許可する
const LOGIC_CODES = ['normal', 'move_like_rook', 'move_like_bishop', 'move_like_lance', 'move_like_knight', 'move_like_gold', 'move_like_queen_limit_3', 'move_like_cannon', 'runaway_drive', 'random_teleport'];

const abilitySpec = {
  type: 'OBJECT',
  properties: {
    activation_type: enumOf(ACTIVATION_TYPES),
    activation_trigger: enumOf(ACTIVATION_TRIGGERS),
    range: { type: 'INTEGER', description: '射程 1〜5' },
    target_selection: enumOf(TARGET_SELECTIONS),
    area_shape: enumOf(AREA_SHAPES),
    effect_type: enumOf(SUPPORTED_ACTIONS),
    actions: { type: 'ARRAY', items: enumOf(SUPPORTED_ACTIONS), description: '1〜3個。配列順に連続実行' },
    affects_who: enumOf(AFFECTS_WHO),
    cooldown_turns: { type: 'INTEGER', description: '0〜4。1ゲーム1回の場合は99' },
    success_rate: { type: 'NUMBER', description: '確率系アクションのみ 0.1〜0.9' },
  },
  required: ['activation_type', 'activation_trigger', 'range', 'target_selection', 'area_shape', 'effect_type', 'actions', 'affects_who', 'cooldown_turns'],
};

const visualEffect = {
  type: 'OBJECT',
  properties: {
    trajectory_type: enumOf(TRAJECTORIES),
    particle_color: str('#rrggbb'),
    particle_count: { type: 'INTEGER' },
    particle_speed: { type: 'NUMBER' },
    screen_shake: { type: 'INTEGER' },
  },
  required: ['trajectory_type', 'particle_color', 'particle_count', 'particle_speed', 'screen_shake'],
};

const PIECE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    word: str(),
    effect_name: str('漢字の能力名'),
    mechanics_type: enumOf(['FORCE_CRUSH', 'HACK_AND_STEAL', 'STEALTH_GHOST', 'SUPPORT_BUFF', 'SPAWNER_BUILD', 'TRAP_MINE', 'AUTOMATIC_DRIVE', 'VIRUS_INFECT', 'SPACE_WARP', 'NECROMANCY', 'UNKNOWN_HERESY']),
    ability_genre: str('表示用の日本語ジャンル名（10文字以内）'),
    visual_theme: enumOf(VISUAL_THEMES),
    trigger: enumOf(ACTIVATION_TRIGGERS),
    is_once_per_game: { type: 'BOOLEAN' },
    cool_down_turns: { type: 'INTEGER' },
    isAutonomous: { type: 'BOOLEAN' },
    range_geometry: {
      type: 'OBJECT',
      // charging_grid（充填中の移動範囲）は全駒共通の十字移動なのでAIに出力させず、サニタイザで補完する
      properties: {
        normal_grid: str(GRID_DESC),
        promoted_grid: str(GRID_DESC),
      },
      required: ['normal_grid', 'promoted_grid'],
    },
    ability_spec: abilitySpec,
    visual_effect: visualEffect,
    description: str('【発動条件】【効果内容】【制限・代償】の3部構成。全体で150文字以内'),
    spawn_config: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        spawn_piece_name: { type: 'STRING', nullable: true },
        max_limit: { type: 'INTEGER' },
        spawn_range_geometry: { type: 'STRING', nullable: true },
      },
    },
    // 成り後の演出(visual_effect)は通常時のものを流用するため出力させない（出力トークン削減）
    promoted_effect: {
      type: 'OBJECT',
      properties: {
        effect_name: str(),
        description: str('80文字以内'),
        logic_code: { ...enumOf([...LOGIC_CODES, 'move_like_queen', 'teleport_move']), nullable: true },
        ability_spec: abilitySpec,
      },
      required: ['effect_name', 'description', 'ability_spec'],
    },
    logic_code: enumOf(LOGIC_CODES),
    deep_search_analysis: str('単語の特徴を能力にどう反映したか。60文字以内'),
  },
  required: [
    'word', 'effect_name', 'mechanics_type', 'ability_genre', 'visual_theme', 'trigger',
    'is_once_per_game', 'cool_down_turns', 'range_geometry', 'ability_spec', 'visual_effect',
    'description', 'promoted_effect', 'logic_code', 'deep_search_analysis',
  ],
};

/** 複数の単語をまとめて1回で生成するための形（{ pieces: [...] }） */
export const PIECES_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    pieces: { type: 'ARRAY', items: PIECE_SCHEMA },
  },
  required: ['pieces'],
};
