// Gemini の構造化出力 (responseSchema) 定義
// enum でエンジンが実行できる値だけに制限する（能力は shared/abilityProgram.ts の部品）。
import { TRAJECTORIES, VISUAL_THEMES } from '../../shared/abilityCatalog.js';
import {
  PROGRAM_TRIGGERS, PROGRAM_CONDITIONS, PROGRAM_OPS, TARGET_WHO, TARGET_PICKS, TILE_KINDS, AURAS,
} from '../../shared/abilityProgram.js';

const str = (description?: string) => ({ type: 'STRING', ...(description ? { description } : {}) });
const enumOf = (values: readonly string[], description?: string) => ({ type: 'STRING', enum: [...values], ...(description ? { description } : {}) });
const GRID_DESC = '5x5グリッド。上の行（敵陣側）から5行を / 区切りで書く（例 00100/01110/01210/00000/00000）。中央は自分自身で必ず2';
// エンジン (getValidMoves / 自律行動) が解釈できる移動パターンだけを許可する
const LOGIC_CODES = ['normal', 'move_like_rook', 'move_like_bishop', 'move_like_lance', 'move_like_knight', 'move_like_gold', 'move_like_queen_limit_3', 'move_like_cannon', 'runaway_drive', 'random_teleport'];

// 能力プログラム（shared/abilityProgram.ts）。area は名前付きの範囲か 5x5 のマス目なので文字列のまま受け、サニタイザで検証する
const abilityProgram = {
  type: 'OBJECT',
  properties: {
    name: str('2〜6文字の漢字の技名'),
    trigger: enumOf(PROGRAM_TRIGGERS),
    every: { type: 'INTEGER', description: 'EVERY_N_TURNS の間隔 2〜5' },
    condition: enumOf(PROGRAM_CONDITIONS),
    condition_value: { type: 'INTEGER' },
    target: {
      type: 'OBJECT',
      properties: {
        area: str('SELF/ADJACENT/RADIUS_2/FRONT_LINE/LINES_8/DIAGONALS/CROSS/ROW/COLUMN/ALL/ENEMY_KING_AROUND/ATTACKER または 5x5 のマス目'),
        who: enumOf(TARGET_WHO),
        pick: enumOf(TARGET_PICKS),
        count: { type: 'INTEGER' },
      },
      required: ['area', 'who', 'pick'],
    },
    effects: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { op: enumOf(PROGRAM_OPS), value: { type: 'INTEGER' }, tile: enumOf(TILE_KINDS) },
        required: ['op'],
      },
    },
    cooldown: { type: 'INTEGER' },
  },
  required: ['name', 'trigger', 'condition', 'target', 'effects', 'cooldown'],
};

const appearance = {
  type: 'OBJECT',
  properties: { color: str('#rrggbb'), accent: str('#rrggbb'), emblem: str('1〜2文字'), aura: enumOf(AURAS) },
  required: ['color', 'accent', 'emblem', 'aura'],
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
    abilities: { type: 'ARRAY', items: abilityProgram, description: '1〜3個' },
    appearance,
    visual_effect: visualEffect,
    description: str('単語の特徴を能力にどう込めたか。80文字以内'),
    promoted_effect: {
      type: 'OBJECT',
      properties: { effect_name: str(), description: str('40文字以内') },
      required: ['effect_name', 'description'],
    },
    logic_code: enumOf(LOGIC_CODES),
    deep_search_analysis: str('単語の特徴を能力にどう反映したか。60文字以内'),
  },
  required: [
    'word', 'effect_name', 'mechanics_type', 'ability_genre', 'visual_theme', 'range_geometry',
    'abilities', 'appearance', 'visual_effect', 'description', 'promoted_effect', 'logic_code', 'deep_search_analysis',
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
