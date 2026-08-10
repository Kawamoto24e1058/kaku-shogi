import type { Board, Piece, Player, GameLog, AbilityEvent, AbilitySpec, CustomAbility, Position, TileEffectType, TileState, ActivationType } from './types';
import { decrementCacheUses } from './aiGenerator';

export const BOARD_SIZE = 9;

export const BoardManager = {
  getPiece(board: Board, pos: Position): Piece | null {
    if (pos.x < 0 || pos.x >= 9 || pos.y < 0 || pos.y >= 9) return null;
    return board[pos.y][pos.x];
  },
  setPiece(board: Board, pos: Position, piece: Piece | null): void {
    if (pos.x >= 0 && pos.x < 9 && pos.y >= 0 && pos.y < 9) {
      board[pos.y][pos.x] = piece;
    }
  }
};

export function getBoardPiece(board: Board, pos: Position): Piece | null {
  return BoardManager.getPiece(board, pos);
}

export function setBoardPiece(board: Board, pos: Position, piece: Piece | null): void {
  BoardManager.setPiece(board, pos, piece);
}

// Helper to generate UUID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function getPieceLogicCode(piece: Piece): string {
  if (piece.isPromoted && piece.promoted_effect) {
    return piece.promoted_effect.logic_code || '';
  }
  
  const rootLogic = piece.logic_code || '';
  
  // If the unpromoted state has no ability, filter out active logic codes
  if (!hasNormalAbility(piece)) {
    const activeLogics = ['teleport_move', 'random_teleport', 'blast', 'kill_linear', 'self_destruct_trap', 'spawn_trap', 'recycle_dead', 'stun_mist', 'remote_snipe', 'swap_move', 'mimic', 'mind_control'];
    if (activeLogics.includes(rootLogic)) {
      return 'normal';
    }
  }
  
  // Prevent unpromoted pieces from inheriting duplicate promoted logic_code
  if (!piece.isPromoted && piece.promoted_effect?.logic_code) {
    if (rootLogic === piece.promoted_effect.logic_code) {
      return 'normal';
    }
  }
  return rootLogic;
}

export function getPieceAbilitySpec(piece: Piece): AbilitySpec | undefined {
  if (piece.isPromoted && piece.promoted_effect && piece.promoted_effect.ability_spec) {
    return piece.promoted_effect.ability_spec;
  }
  return piece.ability_spec;
}

export function getPieceActivationType(piece: Piece): ActivationType {
  const spec = getPieceAbilitySpec(piece);
  if (spec && spec.activation_type) return spec.activation_type;
  if (piece.custom_ability && piece.custom_ability.activation_type) return piece.custom_ability.activation_type;
  if (piece.activation_type) return piece.activation_type;

  const trigger = piece.trigger || spec?.activation_trigger || 'ON_MOVE';
  const desc = piece.description || '';
  const hasClickTarget = requiresTargeting(piece);

  if (trigger === 'ON_TAKEN' || trigger === 'ON_APPROACH' || trigger === 'ALWAYS' || trigger === 'ON_DEATH') {
    return 'PASSIVE';
  }

  if (hasClickTarget || desc.includes('任意') || desc.includes('発動する') || desc.includes('狙撃') || desc.includes('放つ') || desc.includes('選択')) {
    return 'ACTIVE';
  }

  return 'AUTO_TRIGGER';
}

/**
 * 能力スペック（AbilitySpec または CustomAbility）が、
 * ユーザーによる盤面ターゲット選択（CLICK_ZONE / マス指定）を必要とするかを判定する。
 */
export function requiresTargeting(ability: any): boolean {
  if (!ability) return false;

  // Piece または CustomAbility または AbilitySpec を吸収
  const spec = ability.ability_spec
    ? ability.ability_spec
    : (ability.custom_ability ? ability.custom_ability : ability);

  // 1. target_selection が明示的に定義されている場合
  if (spec?.target_selection === 'SELF') return false;
  if (spec?.target_selection === 'CLICK_ZONE') return true;

  // 2. target_mode の判定
  if (spec?.target_mode === 'SELF_CENTERED' || spec?.target_mode === 'ALL_ENEMIES' || spec?.target_mode === 'RANDOM') {
    return false;
  }
  if (spec?.target_mode === 'SINGLE_TARGET' || spec?.target_mode === 'LINE_SELECT' || spec?.target_mode === 'AREA_POINT' || spec?.target_mode === 'POINT_CENTERED') {
    return true;
  }

  // 3. actions / effect_type からの判定
  const actions: string[] = spec?.actions || (spec?.effect_type ? [spec.effect_type] : []);
  
  // 自分自身・自身周囲全体・ランダムなど、ターゲット指定不要なアクションパーツ
  const selfOnlyActions = [
    'GUARD_STANCE', 'OVERDRIVE_BOOST', 'MASS_TELEPORT', 'STEALTH_ON', 
    'SHIELD_GAIN', 'CLEAR_DEBUFF', 'LEAVE_TRAIL_FIRE', 'EVOLUTION', 
    'LUCKY_DODGE', 'RE_ACTION', 'BOOMERANG', 'TIME_REWIND'
  ];
  if (actions.length > 0 && actions.every(act => selfOnlyActions.includes(act))) {
    return false;
  }

  // 特定の指定相手/指定マスをターゲットとするアクションパーツ
  const targetRequiredActions = [
    'PENETRATE_STRIKE', 'SILENCE_SEAL', 'POS_SWAP_ENEMY', 'FORCE_CAPTURE', 
    'STUN_LOCK', 'VAULT_EXECUTE', 'MIND_CONTROL', 'TRANSFORM', 'PROBABILITY_STRIKE', 
    'CHAOS_GAMBLE', 'SWAP_POSITION', 'PULL_1', 'KNOCKBACK', 'KNOCKBACK_MAX',
    'WALL_CREATE', 'SPAWN_TOKEN', 'INVERT_DIR'
  ];
  if (actions.some(act => targetRequiredActions.includes(act))) {
    return true;
  }

  // 4. area_shape からの判定
  if (spec?.area_shape === 'POINT' && spec?.target_selection !== 'SELF') {
    return true;
  }

  return false;
}

export function createEmptyTileBoard(): (TileState | null)[][] {
  const tb: (TileState | null)[][] = [];
  for (let r = 0; r < 9; r++) {
    const row: (TileState | null)[] = [];
    for (let c = 0; c < 9; c++) {
      row.push(null);
    }
    tb.push(row);
  }
  return tb;
}

export function applyTileEffects(
  board: Board,
  tileBoard: (TileState | null)[][],
  activePlayer: Player,
  logs: Omit<GameLog, 'id' | 'timestamp'>[]
): { board: Board; tileBoard: (TileState | null)[][]; triggered: boolean } {
  let nextBoard = board.map(row => [...row]);
  let nextTileBoard = tileBoard.map(row => [...row]);
  let triggered = false;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const tile = nextTileBoard[r][c];
      if (!tile) continue;

      const p = getBoardPiece(nextBoard, { x: c, y: r });
      if (tile.effectType === 'FIRE_ZONE') {
        if (p && !p.isKing) {
          setBoardPiece(nextBoard, { x: c, y: r }, null);
          triggered = true;
          logs.push({
            player: activePlayer,
            message: `【炎上撃破】${p.word} (${getCellLabel(r, c)}) は燃えさかる炎上マスにより灰となって消滅しました！`,
            type: 'ability'
          });
        }
      } else if (tile.effectType === 'POISON_MUD') {
        if (p && p.owner !== tile.ownerPlayer) {
          setBoardPiece(nextBoard, { x: c, y: r }, { ...p, stunTurnsRemaining: 1 });
          triggered = true;
          logs.push({
            player: activePlayer,
            message: `【毒沼麻痺】${p.word} (${getCellLabel(r, c)}) は毒沼に足を取られ、1手番麻痺状態になりました！`,
            type: 'ability'
          });
        }
      } else if (tile.effectType === 'TIME_BOMB') {
        if (tile.duration <= 1) {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const tr = r + dr, tc = c + dc;
              if (isWithinBounds(tr, tc)) {
                const targetP = getBoardPiece(nextBoard, { x: tc, y: tr });
                if (targetP && !targetP.isKing) {
                  setBoardPiece(nextBoard, { x: tc, y: tr }, null);
                }
              }
            }
          }
          nextTileBoard[r][c] = null;
          triggered = true;
          logs.push({
            player: activePlayer,
            message: `【時限爆弾爆発】${getCellLabel(r, c)} の時限爆弾がカウントゼロを迎え、周囲一帯が大爆破しました！`,
            type: 'ability'
          });
          continue;
        }
      }

      tile.duration -= 1;
      if (tile.duration <= 0) {
        nextTileBoard[r][c] = null;
      }
    }
  }

  return { board: nextBoard, tileBoard: nextTileBoard, triggered };
}

export function getPieceDescription(piece: Piece): string {
  if (piece.isPromoted && piece.promoted_effect) {
    return piece.promoted_effect.description || '';
  }
  let desc = piece.description || '';
  const promoIndex1 = desc.indexOf('【覚醒');
  const promoIndex2 = desc.indexOf('【成');
  const indices = [promoIndex1, promoIndex2].filter(idx => idx !== -1);
  if (indices.length > 0) {
    const minIndex = Math.min(...indices);
    desc = desc.substring(0, minIndex).trim();
  }
  return desc;
}

export function hasNormalAbility(piece: {
  isKing?: boolean;
  isPawn?: boolean;
  isHisha?: boolean;
  isKaku?: boolean;
  effect_name?: string;
  description?: string;
}): boolean {
  if (piece.isKing || piece.isPawn || piece.isHisha || piece.isKaku) return false;
  
  const effectName = piece.effect_name || '';
  const desc = piece.description || '';
  
  // Only disable if name is explicitly indicating none/empty/unawakened
  if (effectName === 'なし' || effectName === '効果なし' || effectName === '未覚醒') {
    return false;
  }
  
  if (
    desc.includes('能力はありません') || 
    desc.includes('効果はありません') || 
    desc.includes('通常能力はありません') || 
    desc.includes('通常効果はありません') || 
    desc.includes('能力はない') || 
    desc.includes('効果はない') ||
    desc.includes('成る前は通常移動のみ') ||
    desc.includes('成る前は能力なし') ||
    desc.includes('通常能力：なし') ||
    desc.includes('通常効果：なし')
  ) {
    return false;
  }
  
  return true;
}

export function hasNormalAutomatedAbility(piece: Piece): boolean {
  if (!hasNormalAbility(piece)) return false;
  
  if (piece.ability_spec) return true;
  if (piece.spawn_piece_name && piece.spawn_piece_name.trim() !== '') return true;
  
  const logic = (piece.logic_code || '').toLowerCase();
  const standardLogics = [
    'normal', 'move_like_rook', 'move_like_bishop', 'move_like_lance', 
    'move_like_knight', 'leap_move', ''
  ];
  if (logic && !standardLogics.includes(logic)) return true;
  if (piece.trigger === 'ON_TAKEN' || piece.trigger === 'ON_APPROACH') return true;
  return false;
}

export function hasPromotedAutomatedAbility(piece: Piece): boolean {
  if (!piece.promoted_effect) return false;
  if (piece.promoted_effect.ability_spec) return true;
  if (piece.spawn_config?.spawn_piece_name) return true;
  
  const logic = (piece.promoted_effect.logic_code || '').toLowerCase();
  const standardLogics = [
    'normal', 'move_like_rook', 'move_like_bishop', 'move_like_lance', 
    'move_like_knight', 'leap_move', ''
  ];
  if (logic && !standardLogics.includes(logic)) return true;
  return false;
}

export function getPieceTrigger(piece: Piece): 'ALWAYS' | 'ON_MOVE' | 'TURN_START' | 'ON_TAKEN' | 'ON_APPROACH' | 'TURN_END' | 'ON_DEATH' | 'ON_PROMOTE' {
  if (piece.isPromoted && piece.promoted_effect && piece.promoted_effect.ability_spec) {
    return piece.promoted_effect.ability_spec.activation_trigger;
  }
  return piece.trigger || 'ALWAYS';
}

export function isTriggerMatching(piece: Piece, triggerType: 'ON_MOVE' | 'TURN_START' | 'ON_APPROACH' | 'ON_TAKEN' | 'TURN_END' | 'ON_DEATH' | 'ON_PROMOTE'): boolean {
  if (piece.isPromoted && piece.promoted_effect?.ability_spec) {
    const promoSpec = piece.promoted_effect.ability_spec;
    if (promoSpec.activation_trigger === triggerType || promoSpec.activation_trigger === 'ALWAYS' || (promoSpec.activation_trigger as string) === 'AUTO') {
      return true;
    }
    if (triggerType === 'ON_MOVE' && ((promoSpec.activation_trigger as string) === 'AFTER_MOVE' || promoSpec.activation_trigger === 'ON_MOVE')) {
      return true;
    }
  }
  if (piece.custom_ability && Array.isArray(piece.custom_ability.triggers)) {
    const trs = piece.custom_ability.triggers;
    if (trs.includes(triggerType) || trs.includes('ALWAYS') || trs.includes('AUTO')) return true;
    if (triggerType === 'ON_MOVE' && (trs.includes('AFTER_MOVE') || trs.includes('ON_MOVE'))) return true;
  }
  const trigger = getPieceTrigger(piece);
  if (trigger === triggerType || trigger === 'ALWAYS' || (trigger as string) === 'AUTO') {
    return true;
  }
  if (triggerType === 'ON_MOVE' && ((trigger as string) === 'AFTER_MOVE' || trigger === 'ON_MOVE')) {
    return true;
  }
  return true;
}

export function isStealthPiece(p: any): boolean {
  if (!p) return false;
  if (p.isStealth === false) return false;
  if (p.isStealth === true) return true;
  const logic = (p.logic_code || (p.promoted_effect?.logic_code) || '').toLowerCase();
  const desc = ((p.isPromoted && p.promoted_effect ? p.promoted_effect.description : p.description) || '').toLowerCase();
  const word = p.word || '';
  return p.mechanics_type === 'STEALTH_TRAP' || 
         logic.includes('stealth') || 
         logic === 'self_destruct_trap' ||
         logic === 'stealth_decoy' ||
         desc.includes('透明') || 
         desc.includes('ステルス') || 
         desc.includes('潜伏') || 
         desc.includes('隠密') ||
         desc.includes('裏向き') ||
         word.includes('透明') ||
         word.includes('ステルス') ||
         word.includes('潜伏') ||
         word.includes('隠密');
}

export function isCustomPiece(piece: Piece): boolean {
  const name = piece.word;
  return name !== '玉将' && name !== '歩兵' && name !== 'と金' && name !== '飛車' && name !== '竜王' && name !== '角' && name !== '竜馬';
}

export function isStraightLineDestruction(piece: Piece): boolean {
  const logic = getPieceLogicCode(piece).toLowerCase();
  const desc = getPieceDescription(piece).toLowerCase();
  const name = (piece.word || '').toLowerCase();
  const effect = (piece.isPromoted ? (piece.promoted_effect?.effect_name || piece.effect_name) : piece.effect_name || '').toLowerCase();
  return (
    logic === 'crush' ||
    logic === 'kill_adjacent_remote' ||
    logic === 'kill_linear' ||
    logic === 'remote_snipe' ||
    logic === 'sniper' ||
    logic === 'runaway_drive' ||
    logic === 'runaway_buffet' ||
    logic === 'linear_charge' ||
    logic === 'kill_front_enemy' ||
    desc.includes('スナイプ') ||
    desc.includes('狙撃') ||
    desc.includes('爆破') ||
    desc.includes('レーザー') ||
    desc.includes('ビーム') ||
    desc.includes('破壊') ||
    desc.includes('crush') ||
    desc.includes('貫通') ||
    name.includes('スナイプ') ||
    name.includes('狙撃') ||
    effect.includes('スナイプ') ||
    effect.includes('狙撃')
  );
}


export function mergeGrids(gridA: string, gridB: string): string {
  let result = '';
  for (let i = 0; i < 25; i++) {
    if (i === 12) {
      result += '2';
    } else if (gridA[i] === '1' || gridB[i] === '1') {
      result += '1';
    } else {
      result += '0';
    }
  }
  return result;
}

// Initialize board (9x9 grid)
export function initializeBoard(): Board {
  const board: Board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));

  // Place Sente (Player 1) King at (8, 4)
  setBoardPiece(board, { x: 4, y: 8 }, {
    id: generateId(),
    word: '玉将',
    effect_name: '王権 of 守護',
    mechanics_type: 'MOVEMENT_HACK',
    ability_genre: '通常・王',
    trigger: 'ALWAYS',
    cool_down_turns: 0,
    range_geometry: {
      normal_grid: '0000001110012100111000000',
      charging_grid: '0000000100012100010000000'
    },
    description: 'このゲーム of 王。捕獲されると敗北する。',
    spawn_piece_name: null,
    promoted_effect: {
      effect_name: '王権 of 守護',
      description: 'このゲーム of 王。捕獲されると敗北する。',
    },
    deep_search_analysis: '基本となる王駒。本質的な勝利条件を定義。',
    owner: 'sente',
    isKing: true,
    isPawn: false,
    originalPosition: [8, 4],
    coolDownTurnsRemaining: 0,
    isRevealed: true,
    isPromoted: false
  });

  // Place Gote (Player 2) King at (0, 4)
  setBoardPiece(board, { x: 4, y: 0 }, {
    id: generateId(),
    word: '玉将',
    effect_name: '王権 of 守護',
    mechanics_type: 'MOVEMENT_HACK',
    ability_genre: '通常・王',
    trigger: 'ALWAYS',
    cool_down_turns: 0,
    range_geometry: {
      normal_grid: '0000001110012100111000000',
      charging_grid: '0000000100012100010000000'
    },
    description: 'このゲーム of 王。捕獲されると敗北する。',
    spawn_piece_name: null,
    promoted_effect: {
      effect_name: '王権 of 守護',
      description: 'このゲーム of 王。捕獲されると敗北する。',
    },
    deep_search_analysis: '基本となる王駒。本質的な勝利条件を定義。',
    owner: 'gote',
    isKing: true,
    isPawn: false,
    originalPosition: [0, 4],
    coolDownTurnsRemaining: 0,
    isRevealed: true,
    isPromoted: false
  });

  // Place 9 Sente Pawns (歩) at row 6 (index 6, files 1-9)
  for (let x = 0; x < BOARD_SIZE; x++) {
    setBoardPiece(board, { x, y: 6 }, {
      id: generateId(),
      word: '歩兵',
      effect_name: '一歩の兵勢',
      mechanics_type: 'MOVEMENT_HACK',
      ability_genre: '通常・歩',
      trigger: 'ALWAYS',
      cool_down_turns: 0,
      range_geometry: {
        normal_grid: '0000000100002000000000000',
        charging_grid: '0000000100002000000000000',
        promoted_grid: '0000001110012100010000000'
      },
      description: '前方に1マス進むことができる基本の歩兵。',
      spawn_piece_name: null,
      promoted_effect: {
        effect_name: 'と金',
        description: '成ることで金将と同じ動き（前・斜め前・左右・後ろに1マス）ができる。',
      },
      deep_search_analysis: '基本となる歩兵。成ることで機動力が向上します。',
      owner: 'sente',
      isKing: false,
      isPawn: true,
      originalPosition: [6, x],
      coolDownTurnsRemaining: 0,
      isRevealed: true,
      isPromoted: false
    });
  }

  // Place 9 Gote Pawns (歩) at row 2 (index 2, files 1-9)
  for (let x = 0; x < BOARD_SIZE; x++) {
    setBoardPiece(board, { x, y: 2 }, {
      id: generateId(),
      word: '歩兵',
      effect_name: '一歩の兵勢',
      mechanics_type: 'MOVEMENT_HACK',
      ability_genre: '通常・歩',
      trigger: 'ALWAYS',
      cool_down_turns: 0,
      range_geometry: {
        normal_grid: '0000000100002000000000000',
        charging_grid: '0000000100002000000000000',
        promoted_grid: '0000001110012100010000000'
      },
      description: '前方に1マス進むことができる基本の歩兵。',
      spawn_piece_name: null,
      promoted_effect: {
        effect_name: 'と金',
        description: '成ることで金将と同じ動き（前・斜め前・左右・後ろに1マス）ができる。',
      },
      deep_search_analysis: '基本となる歩兵。成ることで機動力が向上します。',
      owner: 'gote',
      isKing: false,
      isPawn: true,
      originalPosition: [2, x],
      coolDownTurnsRemaining: 0,
      isRevealed: true,
      isPromoted: false
    });
  }

  // --- Place Sente Hisha (飛車) at Y=7, X=7 (2八) and Kaku (角) at Y=7, X=1 (8八) ---
  setBoardPiece(board, { x: 7, y: 7 }, {
    id: generateId(),
    word: '飛車',
    effect_name: '飛翔無限',
    mechanics_type: 'MOVEMENT_HACK',
    ability_genre: '通常・大駒',
    trigger: 'ALWAYS',
    cool_down_turns: 0,
    range_geometry: {
      normal_grid: '0010000100112110010000100',
      charging_grid: '0000000100012100010000000'
    },
    description: '縦横に遮るものがなければどこまでも進める強力な大駒。',
    spawn_piece_name: null,
    promoted_effect: {
      effect_name: '竜王',
      description: '成ることで飛車の動きに加えて斜め4方向に1マス進めるようになる。',
    },
    deep_search_analysis: '縦横無限スライドの大駒。',
    owner: 'sente',
    isKing: false,
    isPawn: false,
    isHisha: true,
    isKaku: false,
    originalPosition: [7, 7],
    coolDownTurnsRemaining: 0,
    isRevealed: true,
    isPromoted: false
  });

  setBoardPiece(board, { x: 1, y: 7 }, {
    id: generateId(),
    word: '角',
    effect_name: '角行無限',
    mechanics_type: 'MOVEMENT_HACK',
    ability_genre: '通常・大駒',
    trigger: 'ALWAYS',
    cool_down_turns: 0,
    range_geometry: {
      normal_grid: '1000101010002000101010001',
      charging_grid: '0000000100012100010000000'
    },
    description: '斜め4方向に遮るものがなければどこまでも進める強力な大駒。',
    spawn_piece_name: null,
    promoted_effect: {
      effect_name: '竜馬',
      description: '成ることで角の動きに加えて縦横4方向に1マス進めるようになる。',
    },
    deep_search_analysis: '斜め無限スライドの大駒。',
    owner: 'sente',
    isKing: false,
    isPawn: false,
    isHisha: false,
    isKaku: true,
    originalPosition: [7, 1],
    coolDownTurnsRemaining: 0,
    isRevealed: true,
    isPromoted: false
  });

  // --- Place Gote Hisha (飛車) at Y=1, X=1 (8二) and Kaku (角) at Y=1, X=7 (2二) ---
  setBoardPiece(board, { x: 1, y: 1 }, {
    id: generateId(),
    word: '飛車',
    effect_name: '飛翔無限',
    mechanics_type: 'MOVEMENT_HACK',
    ability_genre: '通常・大駒',
    trigger: 'ALWAYS',
    cool_down_turns: 0,
    range_geometry: {
      normal_grid: '0010000100112110010000100',
      charging_grid: '0000000100012100010000000'
    },
    description: '縦横に遮るものがなければどこまでも進める強力な大駒。',
    spawn_piece_name: null,
    promoted_effect: {
      effect_name: '竜王',
      description: '成ることで飛車の動きに加えて斜め4方向に1マス進めるようになる。',
    },
    deep_search_analysis: '縦横無限スライドの大駒。',
    owner: 'gote',
    isKing: false,
    isPawn: false,
    isHisha: true,
    isKaku: false,
    originalPosition: [1, 1],
    coolDownTurnsRemaining: 0,
    isRevealed: true,
    isPromoted: false
  });

  setBoardPiece(board, { x: 7, y: 1 }, {
    id: generateId(),
    word: '角',
    effect_name: '角行無限',
    mechanics_type: 'MOVEMENT_HACK',
    ability_genre: '通常・大駒',
    trigger: 'ALWAYS',
    cool_down_turns: 0,
    range_geometry: {
      normal_grid: '1000101010002000101010001',
      charging_grid: '0000000100012100010000000'
    },
    description: '斜め4方向に遮るものがなければどこまでも進める強力な大駒。',
    spawn_piece_name: null,
    promoted_effect: {
      effect_name: '竜馬',
      description: '成ることで角の動きに加えて縦横4方向に1マス進めるようになる。',
    },
    deep_search_analysis: '斜め無限スライドの大駒。',
    owner: 'gote',
    isKing: false,
    isPawn: false,
    isHisha: false,
    isKaku: true,
    originalPosition: [1, 7],
    coolDownTurnsRemaining: 0,
    isRevealed: true,
    isPromoted: false
  });

  return board;
}

// Convert coordinates to standard Shogi labels (e.g. (8, 4) -> "5九", (0, 0) -> "9一")
export function getCellLabel(y: number, x: number): string {
  const file = BOARD_SIZE - x; // Files 1-9 from right to left
  const rankKanji = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  return `${file}${rankKanji[y]}`;
}

export function isWithinBounds(y: number, x: number): boolean {
  return y >= 0 && y < BOARD_SIZE && x >= 0 && x < BOARD_SIZE;
}

export function degradeToNormalPawn(piece: Piece): Piece {
  piece.word = '封印歩兵';
  piece.effect_name = '封印された能力';
  piece.mechanics_type = 'MOVEMENT_HACK';
  piece.ability_genre = '通常・歩';
  piece.trigger = 'ALWAYS';
  piece.cool_down_turns = 0;
  piece.coolDownTurnsRemaining = 0;
  piece.is_once_per_game = false;
  piece.range_geometry = {
    normal_grid: '0000000100002000000000000',
    charging_grid: '0000000100002000000000000',
    promoted_grid: '0000001110012100010000000'
  };
  piece.description = '能力封印の呪いにより、すべての特殊能力を失い、前進1マスの歩兵に弱体化している。';
  piece.spawn_piece_name = null;
  piece.spawn_config = undefined;
  piece.promoted_effect = {
    effect_name: 'と金',
    description: '成ることで金将と同じ動きができる。'
  };
  piece.logic_code = undefined;
  piece.isPawn = true;
  piece.isKing = false;
  piece.isHisha = false;
  piece.isKaku = false;
  piece.isRevealed = true;
  piece.stunTurnsRemaining = undefined;
  piece.deathCountdown = undefined;
  return piece;
}

function applyInversionIfNecessary(moves: [number, number][], y: number, x: number, board: Board, piece: Piece): [number, number][] {
  if (!piece.isInverted) return moves;
  const invertedMoves: [number, number][] = [];
  for (const [ny, nx] of moves) {
    const dy = ny - y;
    const dx = nx - x;
    const ny_inv = y - dy;
    const nx_inv = x - dx;
    if (isWithinBounds(ny_inv, nx_inv)) {
      const target = getBoardPiece(board, { x: nx_inv, y: ny_inv });
      if (!target || target.owner !== piece.owner) {
        invertedMoves.push([ny_inv, nx_inv]);
      }
    }
  }
  return invertedMoves;
}

export function getValidMoves(y: number, x: number, board: Board): [number, number][] {
  const piece = getBoardPiece(board, { x, y });
  if (!piece) return [];

  if ((piece.stunTurnsRemaining && piece.stunTurnsRemaining > 0) || (piece.frozenDuration && piece.frozenDuration > 0) || piece.isFrozen) {
    return [];
  }

  // Silenced pieces can only move 1 step forward (pawn-like)
  if (piece.isSilenced) {
    const forward = piece.owner === 'sente' ? -1 : 1;
    const silY = y + forward;
    const silX = x;
    if (isWithinBounds(silY, silX) && !getBoardPiece(board, { x: silX, y: silY })) {
      return [[silY, silX]];
    }
    return [];
  }

  const validMoves: [number, number][] = [];

  // 1. クールダウン（充填中）の移動制限：前後左右の十字移動（charging_grid）にする
  if (piece.coolDownTurnsRemaining > 0) {
    const grid = piece.range_geometry?.charging_grid || '0000000100012100010000000';
    const isSente = piece.owner === 'sente';
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const idx = r * 5 + c;
        if (grid[idx] === '1') {
          const dy = isSente ? (r - 2) : (2 - r);
          const dx = isSente ? (c - 2) : (2 - c);
          const ny = y + dy;
          const nx = x + dx;
          if (isWithinBounds(ny, nx)) {
            const target = getBoardPiece(board, { x: nx, y: ny });
            if (!target || target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
          }
        }
      }
    }
    return applyInversionIfNecessary(validMoves, y, x, board, piece);
  }

  // 1.5 AIカスタム移動範囲 (custom_moves) の処理
  const customMoves = piece.custom_moves || piece.custom_ability?.custom_moves || (piece as any).ability?.custom_moves;
  if (customMoves && customMoves.length > 0) {
    const isSente = piece.owner === 'sente';
    // Sente's forward is -dy, Gote's forward is +dy
    // Sente's right is +dx, Gote's right is -dx
    for (const move of customMoves) {
      const realDy = isSente ? move.dy : -move.dy;
      const realDx = isSente ? move.dx : -move.dx;

      if (move.slide) {
        // Slide (slide: true)
        let ny = y + realDy;
        let nx = x + realDx;
        while (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!target) {
            validMoves.push([ny, nx]);
          } else {
            if (target.owner !== piece.owner) {
              validMoves.push([ny, nx]); // Capture opponent piece and stop
            }
            break; // Stop sliding on any piece
          }
          ny += realDy;
          nx += realDx;
        }
      } else if (move.jump) {
        // Jump (jump: true)
        const ny = y + realDy;
        const nx = x + realDx;
        if (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!target || target.owner !== piece.owner) {
            validMoves.push([ny, nx]);
          }
        }
      } else {
        // Normal Move (both false)
        const ny = y + realDy;
        const nx = x + realDx;
        if (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!target || target.owner !== piece.owner) {
            validMoves.push([ny, nx]);
          }
        }
      }
    }

    return applyInversionIfNecessary(validMoves, y, x, board, piece);
  }

  // 2. と金 (Promoted Pawn) 移動 (伝統的な歩兵の成駒)
  if (piece.isPawn && piece.isPromoted && piece.range_geometry.promoted_grid) {
    const isSente = piece.owner === 'sente';
    const dy = isSente ? -1 : 1;
    const directions = [
      [dy, -1], [dy, 0], [dy, 1], // front-left, front, front-right
      [0, -1],          [0, 1],   // left, right
      [-dy, 0]                    // back
    ];
    for (const [mdy, mdx] of directions) {
      const ny = y + mdy;
      const nx = x + mdx;
      if (isWithinBounds(ny, nx)) {
        const target = getBoardPiece(board, { x: nx, y: ny });
        if (!target || target.owner !== piece.owner) {
          validMoves.push([ny, nx]);
        }
      }
    }
  }
  // 3. 王将 / 玉将 移動 (8方向1マス)
  else if (piece.isKing) {
    const directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    for (const [dy, dx] of directions) {
      const ny = y + dy;
      const nx = x + dx;
      if (isWithinBounds(ny, nx)) {
        const target = getBoardPiece(board, { x: nx, y: ny });
        if (!target || target.owner !== piece.owner) {
          validMoves.push([ny, nx]);
        }
      }
    }
  }
  // 3.5. 飛車 移動 (縦横無限スライド & 竜王プロモーション)
  else if (piece.isHisha) {
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dy, dx] of directions) {
      let ny = y + dy;
      let nx = x + dx;
      while (isWithinBounds(ny, nx)) {
        const target = getBoardPiece(board, { x: nx, y: ny });
        if (!target) {
          validMoves.push([ny, nx]);
        } else {
          if (target.owner !== piece.owner) {
            validMoves.push([ny, nx]);
          }
          break; // Blocked by any piece
        }
        ny += dy;
        nx += dx;
      }
    }
    // 竜王 (Promoted) 斜め1マス
    if (piece.isPromoted) {
      const diagDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (const [dy, dx] of diagDirections) {
        const ny = y + dy;
        const nx = x + dx;
        if (isWithinBounds(ny, nx)) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!target || target.owner !== piece.owner) {
            validMoves.push([ny, nx]);
          }
        }
      }
    }
  }
  // 3.6. 角 移動 (斜め無限スライド & 竜馬プロモーション)
  else if (piece.isKaku) {
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dy, dx] of directions) {
      let ny = y + dy;
      let nx = x + dx;
      while (isWithinBounds(ny, nx)) {
        const target = getBoardPiece(board, { x: nx, y: ny });
        if (!target) {
          validMoves.push([ny, nx]);
        } else {
          if (target.owner !== piece.owner) {
            validMoves.push([ny, nx]);
          }
          break; // Blocked by any piece
        }
        ny += dy;
        nx += dx;
      }
    }
    // 竜馬 (Promoted) 縦横1マス
    if (piece.isPromoted) {
      const orthoDirections = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dy, dx] of orthoDirections) {
        const ny = y + dy;
        const nx = x + dx;
        if (isWithinBounds(ny, nx)) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!target || target.owner !== piece.owner) {
            validMoves.push([ny, nx]);
          }
        }
      }
    }
  }
  // 4. カスタム駒の移動 (スライド/ジャンプ または 5x5 normal_grid)
  else {
    const movementPattern = getPieceLogicCode(piece);
    let hasCustomMove = false;

    // Rook sliding moves (vertical/horizontal)
    if (movementPattern === 'move_like_rook' || movementPattern === 'rook') {
      hasCustomMove = true;
      const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dy, dx] of directions) {
        let ny = y + dy;
        let nx = x + dx;
        while (isWithinBounds(ny, nx)) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!target) {
            validMoves.push([ny, nx]);
          } else {
            if (target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
            break; // Blocked by any piece
          }
          ny += dy;
          nx += dx;
        }
      }
      // Promoted Rook (Dragon / 竜王) gets 1-step diagonal moves
      if (piece.isPromoted) {
        const diagDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (const [dy, dx] of diagDirections) {
          const ny = y + dy;
          const nx = x + dx;
          if (isWithinBounds(ny, nx)) {
            const target = getBoardPiece(board, { x: nx, y: ny });
            if (!target || target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
          }
        }
      }
    }
    // Bishop sliding moves (diagonals)
    else if (movementPattern === 'move_like_bishop' || movementPattern === 'bishop') {
      hasCustomMove = true;
      const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (const [dy, dx] of directions) {
        let ny = y + dy;
        let nx = x + dx;
        while (isWithinBounds(ny, nx)) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!target) {
            validMoves.push([ny, nx]);
          } else {
            if (target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
            break; // Blocked by any piece
          }
          ny += dy;
          nx += dx;
        }
      }
      // Promoted Bishop (Horse / 竜馬) gets 1-step orthogonal moves
      if (piece.isPromoted) {
        const orthoDirections = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dy, dx] of orthoDirections) {
          const ny = y + dy;
          const nx = x + dx;
          if (isWithinBounds(ny, nx)) {
            const target = getBoardPiece(board, { x: nx, y: ny });
            if (!target || target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
          }
        }
      }
    }
    // Lance sliding moves (forward only)
    else if (movementPattern === 'move_like_lance' || movementPattern === 'lance') {
      hasCustomMove = true;
      const isSente = piece.owner === 'sente';
      const dy = isSente ? -1 : 1;
      let ny = y + dy;
      while (isWithinBounds(ny, x)) {
        const target = getBoardPiece(board, { x, y: ny });
        if (!target) {
          validMoves.push([ny, x]);
        } else {
          if (target.owner !== piece.owner) {
            validMoves.push([ny, x]);
          }
          break; // Blocked
        }
        ny += dy;
      }
      // Promoted Lance gets 1-step adjacent moves in all 8 directions
      if (piece.isPromoted) {
        const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        for (const [mdy, mdx] of directions) {
          const ny = y + mdy;
          const nx = x + mdx;
          if (isWithinBounds(ny, nx)) {
            const target = getBoardPiece(board, { x: nx, y: ny });
            if (!target || target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
          }
        }
      }
    }
    // Knight jumping moves (L-shaped forward jump)
    else if (movementPattern === 'move_like_knight' || movementPattern === 'knight') {
      hasCustomMove = true;
      const isSente = piece.owner === 'sente';
      const dy = isSente ? -2 : 2;
      const targets = [[dy, -1], [dy, 1]];
      for (const [mdy, mdx] of targets) {
        const ny = y + mdy;
        const nx = x + mdx;
        if (isWithinBounds(ny, nx)) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!target || target.owner !== piece.owner) {
            validMoves.push([ny, nx]);
          }
        }
      }
      // Promoted Knight gets 1-step adjacent moves in all 8 directions
      if (piece.isPromoted) {
        const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        for (const [mdy, mdx] of directions) {
          const ny = y + mdy;
          const nx = x + mdx;
          if (isWithinBounds(ny, nx)) {
            const target = getBoardPiece(board, { x: nx, y: ny });
            if (!target || target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
          }
        }
      }
    }
    // Gold General (金将) moves (6 directions, 1 step)
    else if (movementPattern === 'move_like_gold' || movementPattern === 'gold') {
      hasCustomMove = true;
      const isSente = piece.owner === 'sente';
      const dy = isSente ? -1 : 1;
      const directions = [
        [dy, -1], [dy, 0], [dy, 1], // front-left, front, front-right
        [0, -1],          [0, 1],   // left, right
        [-dy, 0]                    // back
      ];
      for (const [mdy, mdx] of directions) {
        const ny = y + mdy;
        const nx = x + mdx;
        if (isWithinBounds(ny, nx)) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!target || target.owner !== piece.owner) {
            validMoves.push([ny, nx]);
          }
        }
      }
      // Promoted Gold gets 1-step adjacent moves in all 8 directions (King-like)
      if (piece.isPromoted) {
        const orthoDiag = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        for (const [mdy, mdx] of orthoDiag) {
          const ny = y + mdy;
          const nx = x + mdx;
          if (isWithinBounds(ny, nx)) {
            const target = getBoardPiece(board, { x: nx, y: ny });
            if (!target || target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
          }
        }
      }
    }
    // Queen (八方スライド / 8 directions slide, or 3-step limit)
    else if (movementPattern === 'move_like_queen' || movementPattern === 'queen' || movementPattern === 'queen_limit_3' || movementPattern === 'move_like_queen_limit_3') {
      hasCustomMove = true;
      const limit = (movementPattern.includes('limit_3')) ? 3 : 9;
      const directions = [
        [-1, 0], [1, 0], [0, -1], [0, 1], // ortho
        [-1, -1], [-1, 1], [1, -1], [1, 1] // diag
      ];
      for (const [dy, dx] of directions) {
        let ny = y + dy;
        let nx = x + dx;
        let stepCount = 0;
        while (isWithinBounds(ny, nx) && stepCount < limit) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!target) {
            validMoves.push([ny, nx]);
          } else {
            if (target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
            break; // Blocked
          }
          ny += dy;
          nx += dx;
          stepCount++;
        }
      }
    }
    // Teleport Move (手動ワープ - can move to any empty cell on the entire board)
    else if (movementPattern === 'move_like_teleport' || movementPattern === 'teleport_move') {
      hasCustomMove = true;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (getBoardPiece(board, { x: c, y: r }) === null) {
            validMoves.push([r, c]);
          }
        }
      }
    }
    // Cannon (砲撃移動 - slides orthogonally, captures by jumping over exactly 1 screen piece)
    else if (movementPattern === 'move_like_cannon' || movementPattern === 'cannon') {
      hasCustomMove = true;
      const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dy, dx] of directions) {
        let ny = y + dy;
        let nx = x + dx;
        let screenPiece = false;
        while (isWithinBounds(ny, nx)) {
          const target = getBoardPiece(board, { x: nx, y: ny });
          if (!screenPiece) {
            if (!target) {
              validMoves.push([ny, nx]); // Move to empty space before screen
            } else {
              screenPiece = true; // Found screen piece
            }
          } else {
            if (target) {
              if (target.owner !== piece.owner) {
                validMoves.push([ny, nx]); // Capture enemy after jumping screen
              }
              break; // Blocked after target capture
            }
          }
          ny += dy;
          nx += dx;
        }
      }
      // Promoted Cannon gets 1-step diagonal moves
      if (piece.isPromoted) {
        const diagDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (const [dy, dx] of diagDirections) {
          const ny = y + dy;
          const nx = x + dx;
          if (isWithinBounds(ny, nx)) {
            const target = getBoardPiece(board, { x: nx, y: ny });
            if (!target || target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
          }
        }
      }
    }

    // Fallback to 5x5 grid parser if it is not a classic sliding/jumping move
    if (!hasCustomMove && piece.range_geometry) {
      let grid = piece.isPromoted && piece.range_geometry.promoted_grid ? piece.range_geometry.promoted_grid : piece.range_geometry.normal_grid;
      if (piece.isPromoted && (!piece.range_geometry.promoted_grid || piece.range_geometry.promoted_grid === piece.range_geometry.normal_grid)) {
        grid = mergeGrids(piece.range_geometry.normal_grid, '0000001110012100111000000');
      }
      if (grid && grid.length === 25) {
        const isSente = piece.owner === 'sente';
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 5; c++) {
            const idx = r * 5 + c;
            if (grid[idx] === '1') {
              const dy = isSente ? (r - 2) : (2 - r);
              const dx = isSente ? (c - 2) : (2 - c);
              const ny = y + dy;
              const nx = x + dx;
              if (isWithinBounds(ny, nx)) {
                const target = getBoardPiece(board, { x: nx, y: ny });
                if (!target || target.owner !== piece.owner) {
                  validMoves.push([ny, nx]);
                }
              }
            }
          }
        }
      }
    }
  }

  // Deduplicate coordinates in validMoves
  const uniqueMoves: [number, number][] = [];
  const seen = new Set<string>();
  for (const m of validMoves) {
    const [ny, nx] = m;
    const key = `${ny},${nx}`;
    if (!seen.has(key)) {
      seen.add(key);
      const newM: any = [ny, nx];
      if ((m as any).moveType) {
        newM.moveType = (m as any).moveType;
      }
      uniqueMoves.push(newM);
    }
  }
  validMoves.length = 0;
  validMoves.push(...uniqueMoves);

  // 5. 算出後の移動力制限（周囲2マス以内に敵の表向きの RULE_BREAK がある場合）
  let isStunnedByField = false;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const ny = y + dy;
      const nx = x + dx;
      if (isWithinBounds(ny, nx)) {
        const p = getBoardPiece(board, { x: nx, y: ny });
        if (p && p.owner !== piece.owner && p.mechanics_type === 'RULE_BREAK' && p.isRevealed !== false) {
          isStunnedByField = true;
        }
      }
    }
  }

  const resultMoves = isStunnedByField
    ? validMoves.filter(([ny, nx]) => Math.abs(ny - y) <= 1 && Math.abs(nx - x) <= 1)
    : validMoves;

  const noObstacleMoves = resultMoves.filter(([ny, nx]) => {
    const target = getBoardPiece(board, { x: nx, y: ny });
    return target === null || target.isObstacle !== true;
  });

  return applyInversionIfNecessary(noObstacleMoves, y, x, board, piece);
}

export interface MoveResult {
  board: Board;
  capturedPiece: Piece | null;
  capturedPieces?: Piece[];
  destroyedPieces?: Piece[];
  logs: Omit<GameLog, 'id' | 'timestamp'>[];
  shieldTriggered: boolean;
  bombTriggered: boolean;
  gameOver: boolean;
  winner: Player | null;
  abilityEvents?: AbilityEvent[];
}

function pushPiece(
  board: Board,
  y: number,
  x: number,
  dy: number,
  dx: number,
  player: Player,
  logs: Omit<GameLog, 'id' | 'timestamp'>[],
  capturedPieces: Piece[]
): Board {
  const piece = getBoardPiece(board, { x, y });
  if (!piece) return board;

  const ny = y + dy;
  const nx = x + dx;

  let nextBoard = board.map(row => [...row]);
  setBoardPiece(nextBoard, { x, y }, null);

  if (!isWithinBounds(ny, nx)) {
    logs.push({
      player,
      message: `【盤外落】${piece.word} が盤外へ押し出され、撃破されました！`,
      type: 'capture',
    });
    const captured = {
      ...piece,
      owner: player,
      isPromoted: false,
      isRevealed: true,
      coolDownTurnsRemaining: 0
    };
    capturedPieces.push(captured);
  } else {
    const target = getBoardPiece(board, { x: nx, y: ny });
    if (target) {
      nextBoard = pushPiece(nextBoard, ny, nx, dy, dx, player, logs, capturedPieces);
    }
    setBoardPiece(nextBoard, { x: nx, y: ny }, piece);
    logs.push({
      player,
      message: `${piece.word} が ${getCellLabel(ny, nx)} へ押し出されました。`,
      type: 'move',
    });
  }
  return nextBoard;
}

export function executeMove(
  board: Board,
  from: [number, number],
  to: [number, number],
  player: Player,
  promote: boolean = false,
  playerNames?: { sente: string; gote: string },
  vsAiMode?: boolean,
  _isManual: boolean = false,
  _capturedPieces?: { sente: Piece[]; gote: Piece[] }
): MoveResult {
  const getPlayerName = (p: Player) => {
    if (playerNames) {
      return p === 'sente'
        ? (playerNames.sente || 'プレイヤー1')
        : (playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2'));
    }
    return p === 'sente' ? '先手' : '後手';
  };

  const [fy, fx] = from;
  const [ty, tx] = to;
  const piece = getBoardPiece(board, { x: fx, y: fy });

  if (!piece || piece.owner !== player) {
    throw new Error('Invalid move coordinates');
  }

  let nextBoard = board.map(row => [...row]);
  let capturedPiece: Piece | null = null;
  const destroyedPieces: Piece[] = [];
  const targetCellAtDest = getBoardPiece(board, { x: tx, y: ty });
  const isCapture = targetCellAtDest !== null;
  const nextRevealed = isCapture ? true : (piece.isRevealed !== undefined ? piece.isRevealed : true);
  const nextStealth = isCapture ? false : (piece.isStealth !== undefined ? piece.isStealth : false);

  let finalPiece = promote
    ? { 
        ...piece, 
        isPromoted: true, 
        isRevealed: nextRevealed,
        isStealth: nextStealth,
        previousPosition: { x: fx, y: fy }
      }
    : { 
        ...piece, 
        isRevealed: nextRevealed,
        isStealth: nextStealth,
        previousPosition: { x: fx, y: fy }
      };
  
  finalPiece.hasMovedManually = true;

  const logs: Omit<GameLog, 'id' | 'timestamp'>[] = [];
  const targetCell = getBoardPiece(board, { x: tx, y: ty });
  let shieldTriggered = false;
  let bombTriggered = false;
  let gameOver = false;
  let winner: Player | null = null;
  const abilityEvents: AbilityEvent[] = [];
  const dy = Math.sign(ty - fy);
  const dx = Math.sign(tx - fx);
  const isStraightLine = dy === 0 || dx === 0 || Math.abs(dy) === Math.abs(dx);
  
  const isLinearCharge = !piece.isKing && !piece.isPawn && isStraightLine && (
    piece.mechanics_type === 'MOVEMENT_HACK' && (
      piece.description.includes('突撃') ||
      piece.description.includes('貫通') ||
      piece.description.includes('一気貫通') ||
      piece.description.includes('押しつぶす') ||
      piece.word.includes('戦車') ||
      piece.word.includes('猪') ||
      piece.word.includes('新幹線')
    )
  );

  let capturedPiecesList: Piece[] = [];

  if (isLinearCharge) {
    let cy = fy + dy;
    let cx = fx + dx;
    
    logs.push({
      player,
      message: `【一気貫通】${piece.word} が直線上に突撃を開始！進路上の駒をなぎ倒します！`,
      type: 'ability'
    });

    while (isWithinBounds(cy, cx)) {
      const pathPiece = getBoardPiece(nextBoard, { x: cx, y: cy });
      if (pathPiece) {
        if (pathPiece.owner !== player) {
          // 敵の駒：一撃で破壊・捕獲
          const code = pathPiece.logic_code || '';
          const desc = pathPiece.description || '';
          const isCurseStun = code === 'curse_stun';
          const isCurseSilence = code === 'curse_silence';
          const isCurseDeath = code === 'curse_death';

          if (pathPiece.trigger === 'ON_TAKEN' && (isCurseStun || isCurseSilence || isCurseDeath)) {
            if (isCurseStun) {
              finalPiece.stunTurnsRemaining = 3;
              logs.push({
                player,
                message: `【呪縛発動】${pathPiece.word} を捕獲した呪いにより、${finalPiece.word} は3手番の間、行動封印（移動不可）になりました！`,
                type: 'ability'
              });
            } else if (isCurseSilence) {
              degradeToNormalPawn(finalPiece);
              logs.push({
                player,
                message: `【能力封印】${pathPiece.word} を捕獲した呪いにより、${finalPiece.word} はすべての特殊能力を奪われ、普通の歩兵に弱体化しました！`,
                type: 'ability'
              });
            } else if (isCurseDeath) {
              finalPiece.deathCountdown = 3;
              logs.push({
                player,
                message: `【死の宣告】${pathPiece.word} を捕獲した呪いにより、${finalPiece.word} に3手番の死の宣告（カウントダウン）が付与されました！`,
                type: 'ability'
              });
            }

            logs.push({
              player,
              message: `【突撃撃破】呪いの駒 ${pathPiece.word} (${getCellLabel(cy, cx)}) が突撃によりなぎ倒されました！`,
              type: 'capture'
            });

            const cap = {
              ...pathPiece,
              owner: player,
              isPromoted: false,
              isRevealed: true,
              coolDownTurnsRemaining: 0
            };
            capturedPiecesList.push(cap);
            setBoardPiece(nextBoard, { x: cx, y: cy }, null);
            if (pathPiece.isKing) {
              gameOver = true;
              winner = player;
            }
          } else {
            const isSelfDestruct = pathPiece.trigger === 'ON_TAKEN' && (
              isStealthPiece(pathPiece) ||
              pathPiece.logic_code === 'self_destruct_trap' ||
              pathPiece.logic_code === 'curse_retaliation' ||
              desc.includes('道連れ') ||
              desc.includes('自爆') ||
              desc.includes('爆発') ||
              desc.includes('爆破') ||
              desc.includes('爆砕') ||
              desc.includes('激突') ||
              pathPiece.ability_spec?.effect_type === 'DESTROY'
            );
            if (isSelfDestruct) {
              const logMsg = isStealthPiece(pathPiece)
                ? `【罠衝突】突撃中の ${piece.word} が罠「${pathPiece.effect_name}」に激突！両者爆破・消滅しました！`
                : `【呪詛衝突】突撃中の ${piece.word} が呪いの駒 ${pathPiece.word} に激突！呪い「${pathPiece.effect_name}」により、両者爆破・消滅しました！`;
              logs.push({
                player,
                message: logMsg,
                type: 'ability'
              });
              setBoardPiece(nextBoard, { x: cx, y: cy }, null);
              setBoardPiece(nextBoard, { x: fx, y: fy }, null);
              bombTriggered = true;
              // 突撃した本人が消滅したため、突撃処理を中断
              return {
                board: nextBoard,
                capturedPiece: null,
                capturedPieces: capturedPiecesList,
                logs,
                shieldTriggered,
                bombTriggered,
                gameOver: pathPiece.isKing, // 玉将ならゲーム終了
                winner: pathPiece.isKing ? player : null,
                abilityEvents
              };
            } else {
              logs.push({
                player,
                message: `【突撃撃破】${pathPiece.word} (${getCellLabel(cy, cx)}) が突撃によりなぎ倒されました！`,
                type: 'capture'
              });
              const cap = {
                ...pathPiece,
                owner: player,
                isPromoted: false,
                isRevealed: true,
                coolDownTurnsRemaining: 0
              };
              capturedPiecesList.push(cap);
              setBoardPiece(nextBoard, { x: cx, y: cy }, null);
              if (pathPiece.isKing) {
                gameOver = true;
                winner = player;
              }
              if (isTriggerMatching(pathPiece, 'ON_DEATH')) {
                abilityEvents.push({
                  id: generateId(),
                  priority: 1,
                  triggerType: 'ON_DEATH',
                  pieceId: pathPiece.id,
                  position: [cy, cx],
                  owner: pathPiece.owner,
                  attackerPieceId: piece.id,
                  attackerPiecePos: [cy, cx],
                  targetCellPiece: pathPiece
                });
              }
              if (pathPiece.trigger === 'ON_TAKEN') {
                abilityEvents.push({
                  id: generateId(),
                  priority: 1,
                  triggerType: 'ON_TAKEN',
                  pieceId: pathPiece.id,
                  position: [cy, cx],
                  owner: pathPiece.owner,
                  attackerPieceId: piece.id,
                  attackerPiecePos: [cy, cx],
                  targetCellPiece: pathPiece
                });
              }
              if (isTriggerMatching(pathPiece, 'ON_DEATH')) {
                abilityEvents.push({
                  id: generateId(),
                  priority: 1,
                  triggerType: 'ON_DEATH',
                  pieceId: pathPiece.id,
                  position: [cy, cx],
                  owner: pathPiece.owner,
                  attackerPieceId: piece.id,
                  attackerPiecePos: [cy, cx],
                  targetCellPiece: pathPiece
                });
              }
            }
          }
        } else {
          // 味方の駒：押し出し
          nextBoard = pushPiece(nextBoard, cy, cx, dy, dx, player, logs, capturedPiecesList);
        }
      }

      if (cy === ty && cx === tx) break;
      cy += dy;
      cx += dx;
    }

    setBoardPiece(nextBoard, { x: tx, y: ty }, finalPiece);
    setBoardPiece(nextBoard, { x: fx, y: fy }, null);

    if (capturedPiecesList.length > 0) {
      capturedPiece = capturedPiecesList[0];
    }
  } else {
    // 通常移動・捕獲
    if (targetCell) {
      // 歩兵による裏向き罠の偵察（デマイン）相打ち・相殺
      if (piece.isPawn && !piece.isPromoted && isStealthPiece(targetCell) && !targetCell.isRevealed) {
        logs.push({
          player,
          message: `【偵察相殺】歩兵 (${getCellLabel(fy, fx)}) が裏向きの罠「${targetCell.effect_name}」を踏み抜きました！罠が大爆破し、歩兵と罠の両者が消滅しました！`,
          type: 'ability'
        });
        setBoardPiece(nextBoard, { x: tx, y: ty }, null);
        setBoardPiece(nextBoard, { x: fx, y: fy }, null);
        triggerShareFate(nextBoard, piece, logs, destroyedPieces);
        triggerShareFate(nextBoard, targetCell, logs, destroyedPieces);
        destroyedPieces.push(
          { ...piece, owner: player },
          { ...targetCell, isRevealed: true }
        );
        return {
          board: nextBoard,
          capturedPiece: null,
          destroyedPieces,
          logs,
          shieldTriggered: false,
          bombTriggered: true,
          gameOver: targetCell.isKing || piece.isKing,
          winner: targetCell.isKing ? player : (piece.isKing ? (player === 'sente' ? 'gote' : 'sente') : null)
        };
      }

      if (targetCell.hasShield) {
        logs.push({
          player,
          message: `【聖盾発動】${targetCell.word} (${getCellLabel(ty, tx)}) の聖盾（バリア）が身代わりとなり、捕獲を防ぎました！`,
          type: 'ability'
        });
        setBoardPiece(nextBoard, { x: tx, y: ty }, { ...targetCell, hasShield: false });
        setBoardPiece(nextBoard, { x: fx, y: fy }, finalPiece);
        return {
          board: nextBoard,
          capturedPiece: null,
          logs,
          shieldTriggered: true,
          bombTriggered: false,
          gameOver: false,
          winner: null
        };
      }

      const code = targetCell.logic_code || '';
      const isCurseStun = code === 'curse_stun';
      const isCurseSilence = code === 'curse_silence';
      const isCurseDeath = code === 'curse_death';
      const isTrap = targetCell.trigger === 'ON_TAKEN';
      if (isTriggerMatching(targetCell, 'ON_DEATH')) {
        abilityEvents.push({
          id: generateId(),
          priority: 1,
          triggerType: 'ON_DEATH',
          pieceId: targetCell.id,
          position: [ty, tx],
          owner: targetCell.owner,
          attackerPieceId: piece.id,
          attackerPiecePos: [ty, tx],
          targetCellPiece: targetCell
        });
      }

      if (isTrap) {
        // Queue ON_TAKEN ability event
        abilityEvents.push({
          id: generateId(),
          priority: 1,
          triggerType: 'ON_TAKEN',
          pieceId: targetCell.id,
          position: [ty, tx],
          owner: targetCell.owner,
          attackerPieceId: piece.id,
          attackerPiecePos: [ty, tx],
          targetCellPiece: targetCell
        });

        if (isCurseStun || isCurseSilence || isCurseDeath) {
          if (isCurseStun) {
            finalPiece.stunTurnsRemaining = 3;
            logs.push({
              player,
              message: `【呪縛発動】${targetCell.word} を捕獲した呪いにより、${finalPiece.word} は3手番の間、行動封印（移動不可）になりました！`,
              type: 'ability'
            });
          } else if (isCurseSilence) {
            degradeToNormalPawn(finalPiece);
            logs.push({
              player,
              message: `【能力封印】${targetCell.word} を捕獲した呪いにより、${finalPiece.word} はすべての特殊能力を奪われ、普通の歩兵に弱体化しました！`,
              type: 'ability'
            });
          } else if (isCurseDeath) {
            finalPiece.deathCountdown = 3;
            logs.push({
              player,
              message: `【死の宣告】${targetCell.word} を捕獲した呪いにより、${finalPiece.word} に3手番の死の宣告（カウントダウン）が付与されました！`,
              type: 'ability'
            });
          }
        }
      }

      logs.push({
        player,
        message: `【捕獲】${piece.word} が ${targetCell.word} (${getCellLabel(ty, tx)}) を捕獲しました。`,
        type: 'capture'
      });

      if (targetCell.type !== 'wall' && targetCell.type !== 'hazard') {
        capturedPiece = {
          ...targetCell,
          owner: player,
          isPromoted: false,
          isRevealed: true,
          coolDownTurnsRemaining: 0
        };
      }

      setBoardPiece(nextBoard, { x: tx, y: ty }, finalPiece);
      setBoardPiece(nextBoard, { x: fx, y: fy }, null);

      triggerShareFate(nextBoard, targetCell, logs, destroyedPieces);

      if (targetCell.isKing) {
        gameOver = true;
        winner = player;
        logs.push({
          player,
          message: `敵の玉将が討ち取られました！${getPlayerName(player)}の勝利！`,
          type: 'system',
        });
      }
    } else {
      // 空きマスへの移動
      setBoardPiece(nextBoard, { x: tx, y: ty }, finalPiece);
      setBoardPiece(nextBoard, { x: fx, y: fy }, null);
    }
  }

  // 接近警報 (ON_APPROACH 罠の判定)
  // 移動が完了し、自駒が盤面 (ty, tx) に存在する場合のみ実行
  const checkFinalPiece = getBoardPiece(nextBoard, { x: tx, y: ty });
  if (checkFinalPiece && checkFinalPiece === finalPiece) {
    const adjacent = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    for (const [ady, adx] of adjacent) {
      const ny = ty + ady;
      const nx = tx + adx;
      if (isWithinBounds(ny, nx)) {
        const adjacentPiece = getBoardPiece(nextBoard, { x: nx, y: ny });
        if (
          adjacentPiece &&
          adjacentPiece.owner !== undefined &&
          (adjacentPiece.owner === 'sente' || adjacentPiece.owner === 'gote') &&
          adjacentPiece.owner !== player &&
          adjacentPiece.trigger === 'ON_APPROACH' &&
          !adjacentPiece.isRevealed
        ) {
          // Queue ON_APPROACH ability event
          abilityEvents.push({
            id: generateId(),
            priority: 1,
            triggerType: 'ON_APPROACH',
            pieceId: adjacentPiece.id,
            position: [ny, nx],
            owner: adjacentPiece.owner,
            attackerPieceId: piece.id,
            attackerPiecePos: [ty, tx]
          });
        }
      }
    }
  }

  // Check victory conditions (ensure King remains)
  const senteKing = nextBoard.some(row => row.some(p => p?.isKing && p.owner === 'sente'));
  const goteKing = nextBoard.some(row => row.some(p => p?.isKing && p.owner === 'gote'));

  if (!senteKing && !goteKing) {
    gameOver = true;
    winner = player === 'sente' ? 'gote' : 'sente';
    logs.push({
      player: 'sente',
      message: `両陣営の王が消滅。手番側の敗北です。`,
      type: 'system',
    });
  } else if (!senteKing) {
    gameOver = true;
    winner = 'gote';
  } else if (!goteKing) {
    gameOver = true;
    winner = 'sente';
  }

  if (promote && getBoardPiece(nextBoard, { x: tx, y: ty }) === finalPiece) {
    const promotedName = piece.isHisha ? '竜王' : (piece.isKaku ? '竜馬' : (piece.isPawn ? 'と金' : piece.promoted_effect?.effect_name || '覚醒駒'));
    logs.push({
      player,
      message: `【覚醒】${piece.word} が「${promotedName}」へ覚醒（成）しました！`,
      type: 'system',
    });
  }

  return {
    board: nextBoard,
    capturedPiece,
    capturedPieces: capturedPiecesList,
    destroyedPieces,
    logs,
    shieldTriggered,
    bombTriggered,
    gameOver,
    winner,
    abilityEvents
  };
}



// Drop piece from hand (9x9)
export function executeDrop(
  board: Board,
  piece: Piece,
  to: [number, number],
  player: Player
): Board {
  const [ty, tx] = to;

  if (getBoardPiece(board, { x: tx, y: ty }) !== null) {
    throw new Error('Occupied square');
  }

  const nextBoard = board.map(row => [...row]);
  
  const placedPiece = { ...piece };
  placedPiece.owner = player;
  placedPiece.originalPosition = [ty, tx];
  placedPiece.isPromoted = false;
  placedPiece.coolDownTurnsRemaining = 0;
  placedPiece.hasMovedManually = false;

  // 罠駒の場合は裏向きで配置
  const isStealth = isStealthPiece(placedPiece);
  placedPiece.isRevealed = isStealth ? false : true;
  placedPiece.isStealth = isStealth ? true : false;

  setBoardPiece(nextBoard, { x: tx, y: ty }, placedPiece);
  return nextBoard;
}

// Get valid drop positions for a captured piece from hand (9x9)
export function getValidDropCells(board: Board, piece: Piece, player: Player): [number, number][] {
  const validCells: [number, number][] = [];
  const isSente = player === 'sente';

  // 1. Identify piece types
  const isPawn = piece.isPawn && !piece.isPromoted;
  const logicCode = getPieceLogicCode(piece);
  const isLance = logicCode === 'move_like_lance' || logicCode === 'lance';
  const isKnight = logicCode === 'move_like_knight' || logicCode === 'knight';

  // Find King positions on the board to validate sniper drops
  let senteKingPos: [number, number] | null = null;
  let goteKingPos: [number, number] | null = null;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = getBoardPiece(board, { x: c, y: r });
      if (p?.isKing) {
        if (p.owner === 'sente') senteKingPos = [r, c];
        else goteKingPos = [r, c];
      }
    }
  }

  // 2. Identify columns that already contain an unpromoted Pawn of this player (for Nifu rule)
  const pawnColumns = new Set<number>();
  if (isPawn) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      for (let y = 0; y < BOARD_SIZE; y++) {
        const p = getBoardPiece(board, { x, y });
        if (p && p.owner === player && p.isPawn && !p.isPromoted) {
          pawnColumns.add(x);
          break;
        }
      }
    }
  }

  // 3. Scan empty cells
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (getBoardPiece(board, { x, y }) !== null) continue;

      // Rule checks:
      // A. Nifu (二歩)
      if (isPawn && pawnColumns.has(x)) {
        continue;
      }

      // B. 行き所のない駒 (No-move Drop)
      // Pawns and Lances cannot be dropped on rank 1 (row 0 for Sente, row 8 for Gote)
      if ((isPawn || isLance) && (isSente ? y === 0 : y === 8)) {
        continue;
      }
      // Knights cannot be dropped on ranks 1 or 2 (rows 0, 1 for Sente, rows 7, 8 for Gote)
      if (isKnight && (isSente ? (y === 0 || y === 1) : (y === 7 || y === 8))) {
        continue;
      }

      // C. 自陣制限 (Own Territory Limit) for custom pieces
      if (isCustomPiece(piece)) {
        const isValidRow = isSente ? y >= 6 : y <= 2;
        if (!isValidRow) {
          continue;
        }
      }

      // D. 王将射線へのスナイプ配置禁止 (Sniper Drop Constraint)
      if (isStraightLineDestruction(piece)) {
        if (senteKingPos && (y === senteKingPos[0] || x === senteKingPos[1] || Math.abs(y - senteKingPos[0]) === Math.abs(x - senteKingPos[1]))) {
          continue;
        }
        if (goteKingPos && (y === goteKingPos[0] || x === goteKingPos[1] || Math.abs(y - goteKingPos[0]) === Math.abs(x - goteKingPos[1]))) {
          continue;
        }
      }

      validCells.push([y, x]);
    }
  }

  return validCells;
}

export function checkAndApplyNullification(
  board: Board,
  _attackerPosition: [number, number],
  attackerPiece: Piece,
  effectName: string,
  affectedPositions: [number, number][],
  attackerPlayer: Player,
  logs: Omit<GameLog, 'id' | 'timestamp'>[]
): { board: Board; nullified: boolean } {
  const defender = attackerPlayer === 'sente' ? 'gote' : 'sente';
  // Find all active nullifiers on the board
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = getBoardPiece(board, { x: c, y: r });
      if (
        p &&
        p.owner === defender &&
        p.coolDownTurnsRemaining === 0 &&
        (p.logic_code === 'nullify' || p.description.includes('無効化') || p.description.includes('結界') || p.description.includes('NULLIFY'))
      ) {
        // Check if any of the affected positions are within 2 cells of this nullifier (Chebyshev distance <= 2)
        const isTargetInRange = affectedPositions.some(([ty, tx]) => {
          return Math.max(Math.abs(ty - r), Math.abs(tx - c)) <= 2;
        });
        
        if (isTargetInRange) {
          // Nullify triggered!
          const nextBoard = board.map(row => [...row]);
          const updatedNullifier = { ...p };
          updatedNullifier.coolDownTurnsRemaining = p.cool_down_turns > 0 ? p.cool_down_turns : 99;
          setBoardPiece(nextBoard, { x: c, y: r }, updatedNullifier);
          
          logs.push({
            player: defender,
            message: `【能力無効化】${getCellLabel(r, c)} にある ${p.word} の結界効果により、${attackerPiece.word} の能力「${effectName}」は無効化されました！`,
            type: 'ability'
          });
          
          return { board: nextBoard, nullified: true };
        }
      }
    }
  }
  return { board, nullified: false };
}

export function getSelectableRangeCells(
  cy: number,
  cx: number,
  range: number,
  affects_who: string,
  board: Board,
  player: Player
): [number, number][] {
  const results: [number, number][] = [];
  const BOARD_SIZE = 9;
  const maxDist = range > 0 ? range : 2;
  
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (y === cy && x === cx) continue;
      const dist = Math.max(Math.abs(y - cy), Math.abs(x - cx));
      if (dist > maxDist) continue;
      
      const cell = getBoardPiece(board, { x, y });
      if (affects_who === 'ENEMY_ONLY') {
        if (cell && cell.owner !== player && !cell.isKing) results.push([y, x]);
      } else if (affects_who === 'ALLY_ONLY') {
        if (cell && cell.owner === player) results.push([y, x]);
      } else if (affects_who === 'EMPTY_ONLY') {
        if (!cell) results.push([y, x]);
      } else if (affects_who === 'ALL_PIECES') {
        if (cell && !cell.isKing) results.push([y, x]);
      } else {
        // Default target selection: Enemy pieces only
        if (cell && cell.owner !== player && !cell.isKing) results.push([y, x]);
      }
    }
  }
  return results;
}

export function getEffectCells(
  cy: number,
  cx: number,
  shape: string,
  _sy?: number,
  _sx?: number,
  player?: Player,
  board?: Board,
  offsets?: { dx: number; dy: number }[]
): [number, number][] {
  const cells: [number, number][] = [[cy, cx]];
  const BOARD_SIZE = 9;

  if (shape === 'POINT') {
    return cells;
  }
  if (shape === 'SQUARE_3X3') {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dy === 0 && dx === 0) continue;
        const ny = cy + dy;
        const nx = cx + dx;
        if (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
          cells.push([ny, nx]);
        }
      }
    }
    return cells;
  }
  if (shape === 'SQUARE_5X5') {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dy === 0 && dx === 0) continue;
        const ny = cy + dy;
        const nx = cx + dx;
        if (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
          cells.push([ny, nx]);
        }
      }
    }
    return cells;
  }
  if (shape === 'CROSS') {
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dy, dx] of dirs) {
      let ny = cy + dy;
      let nx = cx + dx;
      while (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
        cells.push([ny, nx]);
        if (board) {
          const p = board[ny][nx];
          if (p && p.isObstacle) {
            break;
          }
        }
        ny += dy;
        nx += dx;
      }
    }
    return cells;
  }
  if (shape === 'LINE_STRAIGHT') {
    const lineCells: [number, number][] = [];
    const sy = _sy !== undefined ? _sy : cy;
    const sx = _sx !== undefined ? _sx : cx;
    
    const dy = Math.sign(cy - sy);
    const dx = Math.sign(cx - sx);
    
    if (dy !== 0 || dx !== 0) {
      let ny = sy + dy;
      let nx = sx + dx;
      while (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
        lineCells.push([ny, nx]);
        if (board) {
          const p = board[ny][nx];
          if (p && p.isObstacle) {
            break;
          }
        }
        ny += dy;
        nx += dx;
      }
    } else {
      // Fallback vertical laser column
      for (let ny = 0; ny < BOARD_SIZE; ny++) {
        lineCells.push([ny, cx]);
      }
    }
    return lineCells;
  }
  if (shape === 'RANGE_2') {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const ny = cy + dy;
        const nx = cx + dx;
        if (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
          cells.push([ny, nx]);
        }
      }
    }
    return cells;
  }
  if (shape === 'RANGE_3') {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const ny = cy + dy;
        const nx = cx + dx;
        if (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
          cells.push([ny, nx]);
        }
      }
    }
    return cells;
  }
  if (shape === 'LINE_DIAGONAL') {
    const diagonalCells: [number, number][] = [[cy, cx]];
    const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dy, dx] of dirs) {
      let ny = cy + dy;
      let nx = cx + dx;
      while (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
        diagonalCells.push([ny, nx]);
        if (board) {
          const p = board[ny][nx];
          if (p && p.isObstacle) {
            break;
          }
        }
        ny += dy;
        nx += dx;
      }
    }
    return diagonalCells;
  }
  if (shape === 'KNIGHT_JUMP_ALL') {
    const knightCells: [number, number][] = [];
    const offsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dy, dx] of offsets) {
      const ny = cy + dy;
      const nx = cx + dx;
      if (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
        knightCells.push([ny, nx]);
      }
    }
    return knightCells;
  }
  if (shape === 'FRONT_3_LINE') {
    const frontCells: [number, number][] = [];
    const isSente = player ? player === 'sente' : (_sy !== undefined ? _sy >= 4 : true);
    const dy = isSente ? -1 : 1;
    for (let i = 1; i <= 3; i++) {
      const ny = cy + dy * i;
      const nx = cx;
      if (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
        frontCells.push([ny, nx]);
      }
    }
    return frontCells;
  }
  if (shape === 'ALL_ENEMY_PIECES') {
    const enemyCells: [number, number][] = [];
    const myOwner = player || (board && _sy !== undefined && _sx !== undefined && getBoardPiece(board, { x: _sx, y: _sy })?.owner) || 'sente';
    if (board) {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const cell = board[r][c];
          if (cell && cell.owner !== myOwner) {
            enemyCells.push([r, c]);
          }
        }
      }
    }
    return enemyCells;
  }
  if (shape === 'LEADER_SURROUND') {
    const surroundCells: [number, number][] = [];
    const myOwner = player || (board && _sy !== undefined && _sx !== undefined && getBoardPiece(board, { x: _sx, y: _sy })?.owner) || 'sente';
    let enemyKingPos: [number, number] | null = null;
    if (board) {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const cell = board[r][c];
          if (cell && cell.isKing && cell.owner !== myOwner) {
            enemyKingPos = [r, c];
            break;
          }
        }
        if (enemyKingPos) break;
      }
    }
    if (enemyKingPos) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue;
          const ny = enemyKingPos[0] + dy;
          const nx = enemyKingPos[1] + dx;
          if (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
            surroundCells.push([ny, nx]);
          }
        }
      }
    }
    return surroundCells;
  }
  if (shape === 'DYNAMIC_OFFSETS') {
    const dynamicCells: [number, number][] = [];
    if (offsets && offsets.length > 0) {
      const isSente = player ? player === 'sente' : (_sy !== undefined ? _sy >= 4 : true);
      for (const offset of offsets) {
        const realDy = isSente ? offset.dy : -offset.dy;
        const realDx = isSente ? offset.dx : -offset.dx;
        const ny = cy + realDy;
        const nx = cx + realDx;
        if (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
          dynamicCells.push([ny, nx]);
        }
      }
    }
    return dynamicCells;
  }
  return cells;
}

export function interpretAbilitySpec(
  board: Board,
  position: [number, number],
  spec: AbilitySpec,
  player: Player,
  capturedPieces: Piece[],
  graveyard: Piece[],
  targetPosition?: [number, number],
  selectedGraveyardPiece?: Piece,
  deadPiece?: Piece,
  opponentCapturedPieces?: Piece[],
  tileBoard?: (TileState | null)[][]
): {
  board: Board;
  capturedPieces: Piece[];
  opponentCapturedPieces?: Piece[];
  graveyard: Piece[];
  logs: Omit<GameLog, 'id' | 'timestamp'>[];
  triggered: boolean;
} {
  const [y, x] = position;
  const piece = deadPiece || getBoardPiece(board, { x, y });
  if (!piece) return { board, capturedPieces, graveyard, logs: [], triggered: false };

  let nextBoard = board.map(row => [...row]);
  let nextCaptured = [...capturedPieces];
  let nextGraveyard = [...graveyard];
  const logs: Omit<GameLog, 'id' | 'timestamp'>[] = [];
  let triggered = false;

  const effectName = piece.isPromoted
    ? (piece.promoted_effect?.effect_name || piece.effect_name)
    : piece.effect_name;

  let effectCenterCells: [number, number][] = [];

  if (spec.effect_type === 'RESURRECT') {
    const candidates = nextGraveyard.filter(p => p && !p.isKing);
    let reviveTarget: Piece | null = null;
    let reviveIdx = -1;

    if (selectedGraveyardPiece) {
      reviveTarget = selectedGraveyardPiece;
      reviveIdx = nextGraveyard.findIndex(p => p.id === selectedGraveyardPiece.id);
    } else if (candidates.length > 0) {
      reviveTarget = candidates[Math.floor(Math.random() * candidates.length)];
      reviveIdx = nextGraveyard.findIndex(p => p.id === reviveTarget!.id);
    }

    let spawnCell: [number, number] | null = null;
    if (targetPosition && isWithinBounds(targetPosition[0], targetPosition[1]) && getBoardPiece(nextBoard, { x: targetPosition[1], y: targetPosition[0] }) === null) {
      spawnCell = targetPosition;
    } else {
      const adjacent: [number, number][] = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
      for (const [dy, dx] of adjacent) {
        const ny = y + dy, nx = x + dx;
        if (isWithinBounds(ny, nx) && getBoardPiece(nextBoard, { x: nx, y: ny }) === null) { spawnCell = [ny, nx]; break; }
      }
    }

    if (reviveTarget && reviveIdx !== -1 && spawnCell) {
      const [sy, sx] = spawnCell;
      const isStealth = isStealthPiece(reviveTarget);
      const revived: Piece = {
        ...reviveTarget,
        id: generateId(),
        owner: player,
        isPromoted: reviveTarget.isPromoted,
        coolDownTurnsRemaining: 0,
        originalPosition: [sy, sx],
        stunTurnsRemaining: 0,
        deathCountdown: 0,
        isRevealed: isStealth ? false : true,
        isStealth: isStealth ? true : false,
      };
      setBoardPiece(nextBoard, { x: sx, y: sy }, revived);
      nextGraveyard.splice(reviveIdx, 1);
      triggered = true;
      logs.push({ player, message: `【死者蘇生・動的発動】${piece.word} の蘇生術が発動！墓地から「${reviveTarget.word}」を ${getCellLabel(sy, sx)} に召喚しました！`, type: 'ability' });
    } else if (!reviveTarget) {
      triggered = true;
      logs.push({ player, message: `【自動発動制限】墓地に召喚可能な対象駒がないため、蘇生できませんでした。`, type: 'system' });
    } else {
      triggered = true;
      logs.push({ player, message: `【自動発動制限】${piece.word} の周囲に空きマスがないため、召喚に失敗しました。`, type: 'system' });
    }
    return { board: nextBoard, capturedPieces: nextCaptured, graveyard: nextGraveyard, logs, triggered };
  }

  if (targetPosition && spec.target_selection === 'CLICK_ZONE') {
    effectCenterCells = [targetPosition];
  } else if (spec.target_selection === 'SELF') {
    effectCenterCells = [[y, x]];
  } else {
    effectCenterCells = getSelectableRangeCells(y, x, spec.range, spec.affects_who, nextBoard, player);
    if (effectCenterCells.length > 0) {
      effectCenterCells = [effectCenterCells[0]];
    }
  }

  if (effectCenterCells.length === 0) {
    logs.push({ player, message: `【自動発動制限】${piece.word} の効果「${effectName}」の対象が見つかりませんでした。`, type: 'system' });
    return { board: nextBoard, capturedPieces: nextCaptured, graveyard: nextGraveyard, logs, triggered: false };
  }

  const allEffectCells: [number, number][] = [];
  const seen = new Set<string>();
  for (const [cy, cx] of effectCenterCells) {
    for (const cell of getEffectCells(cy, cx, spec.area_shape, y, x, player, nextBoard, spec.effect_offsets)) {
      const key = `${cell[0]},${cell[1]}`;
      if (!seen.has(key)) { seen.add(key); allEffectCells.push(cell); }
    }
  }

  for (const [ey, ex] of allEffectCells) {
    if (!isWithinBounds(ey, ex)) continue;
    const victim = getBoardPiece(nextBoard, { x: ex, y: ey });
    const isAlly = victim && victim.owner === player;
    const isEnemy = victim && victim.owner !== player;

    // LINE_STRAIGHT (縦1列) の破壊・効果は味方や玉将を巻き込まないようにする
    if (spec.area_shape === 'LINE_STRAIGHT') {
      if (victim && (victim.owner === player || victim.isKing)) continue;
    }

    if (spec.affects_who === 'ENEMY_ONLY' && (!victim || !isEnemy || victim.isKing)) continue;
    if (spec.affects_who === 'ALLY_ONLY' && (!victim || !isAlly)) continue;
    if (spec.affects_who === 'EMPTY_ONLY' && victim) continue;
    if (spec.affects_who === 'ALL_PIECES' && (!victim || victim.isKing)) continue;

    const actionKeyMap: Record<string, string> = {
      'DESTROY': 'DESTROY',
      'CAPTURE': 'CAPTURE',
      'IMMOBILIZE': 'FREEZE',
      'STEALTH': 'STEALTH_ON',
      'SWAP': 'SWAP_POSITION',
      'PULL': 'PULL_1',
      'PUSH': 'KNOCKBACK',
      'SPAWN': 'SPAWN_TOKEN',
      'FORCE_CAPTURE': 'FORCE_CAPTURE',
      'TRANSFORM_PAWN': 'TRANSFORM_PAWN',
      'STEAL_HAND': 'STEAL_HAND',
      'TIME_REWIND': 'TIME_REWIND',
      'BOOMERANG': 'BOOMERANG',
      'GRAVITY_PULL': 'GRAVITY_PULL',
      'SHARE_FATE': 'SHARE_FATE',
      'WALL_CREATE': 'WALL_CREATE',
      'LEAVE_TRAIL_FIRE': 'LEAVE_TRAIL_FIRE',
      // Group 4–5 actions (直接マッピング)
      'EVOLUTION': 'EVOLUTION',
      'MIND_CONTROL': 'MIND_CONTROL',
      'CLEAR_DEBUFF': 'CLEAR_DEBUFF',
      'MAGNET_PULL': 'MAGNET_PULL',
      'KNOCKBACK_BUMP': 'KNOCKBACK_BUMP',
      'POS_SWAP_ENEMY': 'POS_SWAP_ENEMY',
      'STUN_LOCK': 'STUN_LOCK',
      'PENETRATE_STRIKE': 'PENETRATE_STRIKE',
      'VAULT_EXECUTE': 'VAULT_EXECUTE',
      'CLEAVE_LINE': 'CLEAVE_LINE',
      'GUARD_STANCE': 'GUARD_STANCE',
      'SILENCE_SEAL': 'SILENCE_SEAL',
      'OVERDRIVE_BOOST': 'OVERDRIVE_BOOST',
      'PROBABILITY_STRIKE': 'PROBABILITY_STRIKE',
      'CHAOS_GAMBLE': 'CHAOS_GAMBLE',
      'LUCKY_DODGE': 'LUCKY_DODGE',
      'SET_TILE_FIRE': 'SET_TILE_FIRE',
      'SET_TILE_POISON': 'SET_TILE_POISON',
      'SET_TILE_ICE': 'SET_TILE_ICE',
      'SET_TILE_BOMB': 'SET_TILE_BOMB',
      'SET_TILE_TRAP': 'SET_TILE_TRAP',
      'DELAYED_BURST': 'DELAYED_BURST',
      'CHARGE_TURN': 'CHARGE_TURN',
      'SACRIFICE_COST': 'SACRIFICE_COST',
      'SELF_STUN': 'SELF_STUN',
      'EVOLUTION_CHECK': 'EVOLUTION_CHECK'
    };

    // spec.actions（複合）があれば順番に実行、なければ effect_type 単体にフォールバック
    const effectTypes: string[] = (spec.actions && spec.actions.length > 0)
      ? spec.actions
      : [spec.effect_type];

    // 最初のターゲット駒IDを記憶（Re-eval 用）
    const firstVictimId = victim ? victim.id : null;

    for (let stepIdx = 0; stepIdx < effectTypes.length; stepIdx++) {
      const effType = effectTypes[stepIdx];
      const actionKey = actionKeyMap[effType];

      // Re-evaluation: 2ステップ目以降はターゲット駒の最新座標を再検索
      let resolvedEy = ey;
      let resolvedEx = ex;
      if (stepIdx > 0 && firstVictimId) {
        const reEval = getPieceById(nextBoard, firstVictimId);
        if (reEval) {
          resolvedEy = reEval.pos.y;
          resolvedEx = reEval.pos.x;
        } else if (isTargetRequiredAction(effType)) {
          // Exist Guard: 消滅済みターゲット → スキップ
          console.log(`[interpretAbilitySpec Exist Guard] Target (id=${firstVictimId}) gone. Skipping: ${effType}`);
          continue;
        }
      }

      if (actionKey) {
        const triggeredRef: { value: boolean } = { value: triggered };
        const context = {
          piece,
          player,
          from: { x: position[1], y: position[0] },
          to: { x: position[1], y: position[0] },
          graveyard: nextGraveyard,
          capturedPieces: nextCaptured,
          opponentCapturedPieces,
          logs,
          triggeredRef,
          reActionRef: { value: false },
          effectName,
          currentActingPos: { x: position[1], y: position[0] },
          successRate: spec.success_rate,
          tileBoard,
          ability: {
            targets: [spec.area_shape],
            constraints: spec.affects_who === 'ALL_PIECES' ? ['MUTUAL_DAMAGE'] : []
          }
        };

        applyCoreActionEffect(actionKey, { x: resolvedEx, y: resolvedEy }, nextBoard, { x: position[1], y: position[0] }, context);

        triggered = triggeredRef.value;
        nextGraveyard = context.graveyard;
        nextCaptured = context.capturedPieces;
        if (context.opponentCapturedPieces) {
          opponentCapturedPieces = context.opponentCapturedPieces;
        }
      } else if (effType === 'TRANSFORM') {
        // TRANSFORM は特殊処理（actionKeyMap 非対応）— break して外側の else if に委ねる
        break;
      }
    }
    // TRANSFORM の特殊処理（既存コード）は actions が ['TRANSFORM'] のみの場合のみ到達
    // TRANSFORM 特殊処理: spec.effect_type が TRANSFORM（かつ actions 未使用）のときのみ適用
    if (effectTypes.length === 1 && effectTypes[0] === 'TRANSFORM') {
      if (victim && victim.owner !== player && !victim.isKing) {
        const currentSelf = getBoardPiece(nextBoard, { x, y });
        if (currentSelf) {
          setBoardPiece(nextBoard, { x, y }, {
            ...currentSelf,
            word: victim.word,
            effect_name: victim.effect_name,
            mechanics_type: victim.mechanics_type,
            ability_genre: victim.ability_genre,
            trigger: victim.trigger,
            cool_down_turns: victim.cool_down_turns,
            range_geometry: { ...victim.range_geometry },
            description: victim.description,
            spawn_piece_name: victim.spawn_piece_name,
            spawn_config: victim.spawn_config ? { ...victim.spawn_config } : undefined,
            promoted_effect: { ...victim.promoted_effect },
            logic_code: victim.logic_code,
            ability_spec: victim.ability_spec ? { ...victim.ability_spec } : undefined,
            custom_ability: victim.custom_ability ? { ...victim.custom_ability } : undefined,
            isStealth: victim.isStealth
          });
          triggered = true;
          logs.push({ player, message: `【${effectName}】${piece.word} が ${victim.word} の姿と能力に変化しました！`, type: 'ability' });
        }
      }
    }
  }

  if (triggered) {
    const currentPiece = getBoardPiece(nextBoard, { x, y });
    if (currentPiece) {
      const currentUses = currentPiece.remaining_uses !== undefined ? currentPiece.remaining_uses : 3;
      const nextUses = currentUses - 1;

      decrementCacheUses(currentPiece.word).catch((e: any) => console.warn(e));

      let finalPieceState: Piece = { ...currentPiece };

      if (nextUses <= 0) {
        finalPieceState = degradeToNormalPawn(finalPieceState);
        finalPieceState.remaining_uses = 0;
        logs.push({
          player: currentPiece.owner,
          message: `【能力消滅】${currentPiece.word} の能力は3回発動したため消滅し、普通の歩兵になりました。`,
          type: 'system'
        });
      } else {
        finalPieceState.remaining_uses = nextUses;
        if (finalPieceState.custom_ability) {
          finalPieceState.custom_ability = {
            ...finalPieceState.custom_ability,
            remaining_uses: nextUses
          };
        }
        logs.push({
          player: currentPiece.owner,
          message: `【耐久度】${currentPiece.word} の能力残り使用回数: ${nextUses}回`,
          type: 'system'
        });
      }

      setBoardPiece(nextBoard, { x, y }, finalPieceState);
    }
  }

  return { board: nextBoard, capturedPieces: nextCaptured, opponentCapturedPieces, graveyard: nextGraveyard, logs, triggered };
}

function isAutonomousPiece(p: Piece | null): boolean {
  if (!p) return false;
  if (p.isAutonomous === true || p.custom_ability?.isAutonomous === true) return true;
  const logic = getPieceLogicCode(p);
  const desc = getPieceDescription(p);
  return p.trigger === 'ALWAYS' || 
         p.custom_ability?.trigger_override === 'ON_TURN_END' ||
         logic.includes('runaway') || 
         logic === 'random_teleport' || 
         desc.includes('操作不能') || 
         desc.includes('猪突猛進') || 
         desc.includes('暴走') ||
         desc.includes('勝手に動く') ||
         desc.includes('暴れ馬') ||
         desc.includes('指示を聞かない') ||
         desc.includes('気まぐれ');
}

export function applyAutomatedEffect(
  board: Board,
  position: [number, number],
  triggerType: 'ON_MOVE' | 'TURN_START' | 'ON_APPROACH' | 'ON_TAKEN' | 'TURN_END' | 'ON_DEATH' | 'ON_PROMOTE',
  player: Player,
  capturedPieces: Piece[],
  fromPosition?: [number, number],
  targetPosition?: [number, number],
  _graveyardCandidates?: Piece[],
  graveyard?: Piece[],
  selectedGraveyardPiece?: Piece,
  deadPiece?: Piece,
  opponentCapturedPieces?: Piece[]
): {
  board: Board;
  capturedPieces: Piece[];
  opponentCapturedPieces?: Piece[];
  graveyard?: Piece[];
  logs: Omit<GameLog, 'id' | 'timestamp'>[];
  triggered: boolean;
  reAction?: boolean;
} {
  const [y, x] = position;
  const piece = deadPiece || getBoardPiece(board, { x, y });
  if (!piece || piece.owner !== player || !isTriggerMatching(piece, triggerType)) {
    return { board, capturedPieces, graveyard, logs: [], triggered: false, reAction: false };
  }
  const currentCd = piece.coolDownTurnsRemaining ?? piece.cooldownTurnsRemaining ?? 0;
  if (!isAutonomousPiece(piece) && currentCd > 0) {
    return { board, capturedPieces, graveyard, logs: [], triggered: false, reAction: false };
  }
  if (piece.isSilenced) {
    return { board, capturedPieces, graveyard, logs: [], triggered: false, reAction: false };
  }

  let nextBoard = board.map(row => [...row]);
  let nextCaptured = [...capturedPieces];
  let nextGraveyard = graveyard ? [...graveyard] : [];
  const logs: Omit<GameLog, 'id' | 'timestamp'>[] = [];
  let triggered = false;
  const logic = getPieceLogicCode(piece);
  const desc = getPieceDescription(piece);
  const effectName = piece.isPromoted ? (piece.promoted_effect?.effect_name || piece.effect_name) : piece.effect_name;

  // ── 汎用カスタム能力実行エンジン優先 ──
  if (piece.custom_ability && isTriggerMatching(piece, triggerType)) {
    const customRes = executeCustomAbility(
      board, position, piece.custom_ability, player, fromPosition, targetPosition, opponentCapturedPieces
    );
    return {
      board: customRes.board,
      capturedPieces: [...capturedPieces, ...customRes.capturedPieces],
      opponentCapturedPieces: customRes.opponentCapturedPieces,
      graveyard: graveyard ? [...graveyard, ...customRes.graveyard] : customRes.graveyard,
      logs: customRes.logs,
      triggered: customRes.triggered,
      reAction: customRes.reAction
    };
  }

  // ── 動的インタープリター優先ルート ──
  const spec = getPieceAbilitySpec(piece);
  if (spec) {
    if (isTriggerMatching(piece, triggerType)) {
      const specResult = interpretAbilitySpec(
        nextBoard, position, spec, player,
        nextCaptured, nextGraveyard,
        targetPosition, selectedGraveyardPiece,
        undefined,
        opponentCapturedPieces
      );
      if (specResult.triggered) {
        const isOnce = piece.is_once_per_game || piece.cool_down_turns === 99;
        const targetCd = isOnce ? 99 : (spec.cooldown_turns > 0 ? spec.cooldown_turns : 0);
        if (targetCd > 0) {
          for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
              const p = getBoardPiece(specResult.board, { x: c, y: r });
              if (p && p.id === piece.id) {
                setBoardPiece(specResult.board, { x: c, y: r }, {
                  ...p,
                  coolDownTurnsRemaining: targetCd,
                  cooldownTurnsRemaining: targetCd
                });
                break;
              }
            }
          }
        }
      }
      return {
        board: specResult.board,
        capturedPieces: specResult.capturedPieces,
        opponentCapturedPieces: specResult.opponentCapturedPieces,
        graveyard: specResult.graveyard,
        logs: specResult.logs,
        triggered: specResult.triggered
      };
    }
  }

  // 1. Replication/Clone (spawn_piece_name is present)
  if (piece.spawn_piece_name && piece.spawn_piece_name.trim() !== '') {
    const spawnPieceName = piece.spawn_config?.spawn_piece_name || piece.spawn_piece_name;
    const maxLimit = piece.spawn_config?.max_limit ?? 2;

    // Count existing minions on the board owned by this player
    let minionCount = 0;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const p = getBoardPiece(board, { x: c, y: r });
        if (p && p.owner === player && p.word === spawnPieceName) {
          minionCount++;
        }
      }
    }

    if (minionCount >= maxLimit) {
      logs.push({
        player,
        message: `【自動発動制限】盤面に存在する ${spawnPieceName} が上限(${maxLimit}体)に達しているため、新規召喚をスキップしました。`,
        type: 'ability'
      });
      return { board, capturedPieces, logs, triggered: false };
    }

    const isSente = player === 'sente';
    let spawnOffsets: [number, number][] = [];
    const geom = piece.spawn_config?.spawn_range_geometry;
    if (geom && geom.length === 25) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const idx = r * 5 + c;
          if (geom[idx] === '1') {
            const dy = isSente ? (r - 2) : (2 - r);
            const dx = isSente ? (c - 2) : (2 - c);
            spawnOffsets.push([dy, dx]);
          }
        }
      }
    } else {
      spawnOffsets = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
    }

    let spawned = false;
    for (const [dy, dx] of spawnOffsets) {
      const ny = y + dy;
      const nx = x + dx;
      if (isWithinBounds(ny, nx) && nextBoard[ny][nx] === null) {
        const clonePiece: Piece = {
          id: generateId(),
          word: spawnPieceName,
          effect_name: piece.effect_name,
          mechanics_type: piece.mechanics_type,
          ability_genre: piece.ability_genre || '武力・突撃',
          trigger: 'ALWAYS',
          cool_down_turns: 0,
          range_geometry: {
            normal_grid: '0000000100012100010000000',
            charging_grid: '0000000100012100010000000',
            promoted_grid: '0000001110012100111000000'
          },
          description: `生み出された${spawnPieceName}。`,
          spawn_piece_name: null,
          spawn_config: {
            spawn_piece_name: null,
            max_limit: 0,
            spawn_range_geometry: null
          },
          promoted_effect: {
            effect_name: `${spawnPieceName}・醒`,
            description: `覚醒した${spawnPieceName}。移動範囲が8方向に拡大しました！`
          },
          deep_search_analysis: '',
          owner: player,
          isKing: false,
          isPawn: false,
          originalPosition: [ny, nx],
          coolDownTurnsRemaining: 0,
          isRevealed: true,
          isPromoted: false
        };
        nextBoard[ny][nx] = clonePiece;
        spawned = true;
        logs.push({
          player,
          message: `【自動発動】${piece.word} の効果「${effectName}」により、${getCellLabel(ny, nx)} に「${spawnPieceName}」が生成されました！`,
          type: 'ability'
        });
        break;
      }
    }
    if (spawned) {
      triggered = true;
    }
  }

  // 2. Explosion / Blast (checks logic_code or description)
  else if (
    desc.includes('爆破') || 
    desc.includes('爆発') || 
    desc.includes('自爆') || 
    desc.includes('爆砕') || 
    desc.includes('捕獲') || 
    desc.includes('吸収') || 
    desc.includes('一掃') || 
    desc.includes('巻き込む') || 
    desc.includes('消滅') || 
    desc.includes('消し去る') || 
    desc.includes('消し飛ば') || 
    desc.includes('レーザー') || 
    desc.includes('ビーム') || 
    desc.includes('狙撃') || 
    desc.includes('スナイプ') || 
    desc.includes('貫通') || 
    desc.includes('破壊') || 
    logic === 'kill_adjacent_remote' || 
    logic === 'kill_front_enemy' || 
    logic === 'kill_linear' ||
    logic === 'remote_snipe' ||
    logic === 'sniper' ||
    logic === 'linear_charge' ||
    logic.includes('kill_adjacent') ||
    logic.includes('capture_adjacent') ||
    logic.includes('blast') ||
    logic.includes('explode') ||
    logic.includes('laser') ||
    logic.includes('beam')
  ) {
    let targetOffsets = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];

    const isFrontRow = logic === 'kill_front_enemy' || 
                       desc.includes('前一列') || desc.includes('前方一列') || desc.includes('前１列') || desc.includes('前1列') || desc.includes('前方1列') || desc.includes('前方１列') ||
                       desc.includes('正面一列') || desc.includes('正面1列') || desc.includes('正面１列');
                       
    const isLinear = logic === 'kill_linear' || logic === 'linear_charge' || logic === 'remote_snipe' || logic === 'sniper' || logic.includes('laser') || logic.includes('beam') ||
                     desc.includes('直線上') || desc.includes('直線範囲') || desc.includes('直線方向') || desc.includes('一直線') || desc.includes('直線状') || desc.includes('前方直線') ||
                     desc.includes('縦横一直線') || desc.includes('縦横直線') || desc.includes('縦横の直線') ||
                     desc.includes('レーザー') || desc.includes('ビーム') || desc.includes('貫通') || desc.includes('狙撃') || desc.includes('スナイプ');

    const isVerticalLinear = desc.includes('縦直線') || desc.includes('縦の直線') || desc.includes('縦１列') || desc.includes('縦1列') || desc.includes('縦一列') || 
                             desc.includes('レーザー') || desc.includes('ビーム') ||
                             logic === 'kill_linear' || logic.includes('laser') || logic.includes('beam') ||
                             piece.word.includes('レーザー') || piece.word.includes('ビーム') ||
                             effectName.includes('レーザー') || effectName.includes('ビーム') ||
                             (!desc.includes('横') && !desc.includes('斜め') && !desc.includes('全方向') && !desc.includes('周囲'));

    if (isFrontRow) {
      const dy = player === 'sente' ? -1 : 1;
      targetOffsets = [
        [dy, -1], [dy, 0], [dy, 1]
      ];
    } else if (isLinear) {
      targetOffsets = [];
      const directions = isVerticalLinear 
        ? [[-1, 0], [1, 0]] 
        : [
            [-1, 0], [1, 0], [0, -1], [0, 1],
            [-1, -1], [-1, 1], [1, -1], [1, 1]
          ];
      for (const [dy, dx] of directions) {
        let ny = y + dy;
        let nx = x + dx;
        while (isWithinBounds(ny, nx)) {
          const pathPiece = getBoardPiece(nextBoard, { x: nx, y: ny });
          targetOffsets.push([ny - y, nx - x]);
          if (pathPiece && pathPiece.isObstacle) {
            break;
          }
          ny += dy;
          nx += dx;
        }
      }
    }

    const targets: [number, number][] = [];
    for (const [dy, dx] of targetOffsets) {
      const ny = y + dy;
      const nx = x + dx;
      if (isWithinBounds(ny, nx)) {
        const victim = nextBoard[ny][nx];
        if (victim && victim.owner !== player && !victim.isKing) {
          targets.push([ny, nx]);
        }
      }
    }
    if (targets.length > 0) {
      const nullifyRes = checkAndApplyNullification(nextBoard, position, piece, effectName, targets, player, logs);
      if (nullifyRes.nullified) {
        return { board: nullifyRes.board, capturedPieces: nextCaptured, graveyard: nextGraveyard, logs, triggered: true };
      }

      const isAnnihilation = desc.includes('消滅') || desc.includes('消し飛ば') || desc.includes('レーザー') || desc.includes('ビーム') || desc.includes('爆破') || desc.includes('爆発') || desc.includes('自爆') || desc.includes('爆砕') || logic.includes('blast') || logic.includes('explode') || logic === 'kill_front_enemy' || logic === 'kill_adjacent_remote' || logic === 'kill_linear';

      for (const [ny, nx] of targets) {
        const victim = nextBoard[ny][nx];
        if (victim) {
          if (isAnnihilation) {
            logs.push({
              player,
              message: `【自動発動】${piece.word} の効果「${effectName}」が命中！ ${victim.word} (${getCellLabel(ny, nx)}) を消滅（墓地送り）させました！`,
              type: 'system'
            });
            nextGraveyard.push({
              ...victim,
              owner: victim.owner,
              isPromoted: false,
              coolDownTurnsRemaining: 0,
              isRevealed: true
            });
          } else {
            logs.push({
              player,
              message: `【自動発動】${piece.word} の効果「${effectName}」が命中！ ${victim.word} (${getCellLabel(ny, nx)}) を爆破捕獲しました！`,
              type: 'capture'
            });
            nextCaptured.push({
              ...victim,
              owner: player,
              isPromoted: false,
              coolDownTurnsRemaining: 0,
              isRevealed: true
            });
          }
          nextBoard[ny][nx] = null;
        }
      }
      triggered = true;
    }
  }

  // 3. Pull / Attract (checks logic_code or description)
  else if (desc.includes('引き寄せ') || desc.includes('重力') || desc.includes('磁力') || logic === 'slowdown_aura' || logic === 'earthquake_stun') {
    const directions = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];
    const targets: [number, number][] = [];
    for (const [dy, dx] of directions) {
      const targetY = y + dy * 2;
      const targetX = x + dx * 2;
      const intermediateY = y + dy;
      const intermediateX = x + dx;
      if (isWithinBounds(targetY, targetX) && isWithinBounds(intermediateY, intermediateX)) {
        const victim = nextBoard[targetY][targetX];
        const pathEmpty = nextBoard[intermediateY][intermediateX] === null;
        if (victim && victim.owner !== player && pathEmpty) {
          targets.push([targetY, targetX]);
        }
      }
    }
    if (targets.length > 0) {
      const nullifyRes = checkAndApplyNullification(nextBoard, position, piece, effectName, targets, player, logs);
      if (nullifyRes.nullified) {
        return { board: nullifyRes.board, capturedPieces: nextCaptured, logs, triggered: true };
      }

      for (const [dy, dx] of directions) {
        const targetY = y + dy * 2;
        const targetX = x + dx * 2;
        const intermediateY = y + dy;
        const intermediateX = x + dx;
        if (isWithinBounds(targetY, targetX) && isWithinBounds(intermediateY, intermediateX)) {
          const victim = nextBoard[targetY][targetX];
          const pathEmpty = nextBoard[intermediateY][intermediateX] === null;
          if (victim && victim.owner !== player && pathEmpty) {
            nextBoard[intermediateY][intermediateX] = {
              ...victim,
              originalPosition: [intermediateY, intermediateX]
            };
            nextBoard[targetY][targetX] = null;
            logs.push({
              player,
              message: `【自動発動】${piece.word} の効果「${effectName}」により、${victim.word} (${getCellLabel(targetY, targetX)}) が ${getCellLabel(intermediateY, intermediateX)} に引き寄せられました！`,
              type: 'ability'
            });
          }
        }
      }
      triggered = true;
    }
  }

  // 4. Teleport (checks logic_code or description)
  else if (desc.includes('瞬間移動') || desc.includes('ワープ') || logic === 'random_move' || logic === 'teleport_anywhere' || logic === 'random_teleport') {
    const emptyCells: [number, number][] = [];
    const isSente = piece.owner === 'sente';
    let grid = piece.isPromoted && piece.range_geometry?.promoted_grid 
      ? piece.range_geometry.promoted_grid 
      : piece.range_geometry?.normal_grid;

    if (piece.isPromoted && (!piece.range_geometry?.promoted_grid || piece.range_geometry.promoted_grid === piece.range_geometry.normal_grid)) {
      grid = mergeGrids(piece.range_geometry?.normal_grid || '0000001110012100111000000', '0000001110012100111000000');
    }

    if (grid && grid.length === 25) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const idx = r * 5 + c;
          if (grid[idx] === '1') {
            const dy = isSente ? (r - 2) : (2 - r);
            const dx = isSente ? (c - 2) : (2 - c);
            const ny = y + dy;
            const nx = x + dx;
            if (isWithinBounds(ny, nx) && nextBoard[ny][nx] === null) {
              emptyCells.push([ny, nx]);
            }
          }
        }
      }
    }

    if (emptyCells.length > 0) {
      const [ny, nx] = emptyCells[Math.floor(Math.random() * emptyCells.length)];
      const updatedPiece = {
        ...piece,
        cool_down_turns: 0,
        coolDownTurnsRemaining: 0
      };
      nextBoard[ny][nx] = updatedPiece;
      nextBoard[y][x] = null;
      triggered = true;
      logs.push({
        player,
        message: `【自動発動】${piece.word} の効果「${effectName}」により、${getCellLabel(ny, nx)} へ瞬間移動しました！`,
        type: 'ability'
      });
    } else {
      triggered = true; // Still flag as triggered so the system knows the effect processed
      logs.push({
        player,
        message: `【自動発動制限】${piece.word} の移動範囲内に空きマスがないため、瞬間移動できませんでした。`,
        type: 'system'
      });
    }
  }
  // 4.5. Runaway Drive (ON_MOVE / 自律暴走)
  else if (logic === 'runaway_drive' || logic === 'runaway_buffet' || desc.includes('猪突猛進') || desc.includes('暴走列車')) {
    const stepY = player === 'sente' ? -1 : 1;
    let currentY = y;
    const currentX = x;
    let stopY = y;
    let hitEnemy = false;
    let hitEnemyPiece: Piece | null = null;

    while (true) {
      const ny = currentY + stepY;
      if (!isWithinBounds(ny, currentX)) {
        break; // Out of bounds, stop at currentY
      }
      const obs = nextBoard[ny][currentX];
      if (obs) {
        if (obs.owner === player) {
          // Friendly piece. Stop adjacent (i.e. at currentY).
          break;
        } else {
          // Enemy piece. Capture it and stop at ny.
          hitEnemy = true;
          hitEnemyPiece = obs;
          stopY = ny;
          break;
        }
      }
      currentY = ny;
      stopY = ny;
    }

    if (stopY !== y) {
      triggered = true;
      const finalPieceAtStop = { ...piece };
      
      logs.push({
        player,
        message: `【自律暴走】${piece.word} が猪突猛進！ ${getCellLabel(y, x)} から ${getCellLabel(stopY, currentX)} へ突進しました！`,
        type: 'ability'
      });

      if (hitEnemy && hitEnemyPiece) {
        const victim = hitEnemyPiece;
        const code = victim.logic_code || '';
        const vdesc = victim.description || '';
        const isCurseStun = code === 'curse_stun';
        const isCurseSilence = code === 'curse_silence';
        const isCurseDeath = code === 'curse_death';

        if (victim.trigger === 'ON_TAKEN' && (isCurseStun || isCurseSilence || isCurseDeath)) {
          logs.push({
            player,
            message: `【突撃撃破】${piece.word} が呪いの駒 ${victim.word} (${getCellLabel(stopY, currentX)}) を捕獲しました。`,
            type: 'capture'
          });
          nextCaptured.push({
            ...victim,
            owner: player,
            isPromoted: false,
            isRevealed: true,
            coolDownTurnsRemaining: 0
          });

          if (isCurseStun) {
            finalPieceAtStop.stunTurnsRemaining = 3;
            logs.push({
              player,
              message: `【呪縛発動】${victim.word} を捕獲した呪いにより、${piece.word} は3手番の間、行動封印（移動不可）になりました！`,
              type: 'ability'
            });
          } else if (isCurseSilence) {
            degradeToNormalPawn(finalPieceAtStop);
            logs.push({
              player,
              message: `【能力封印】${victim.word} を捕獲した呪いにより、${piece.word} はすべての特殊能力を奪われ、普通の歩兵に弱体化しました！`,
              type: 'ability'
            });
          } else if (isCurseDeath) {
            finalPieceAtStop.deathCountdown = 3;
            logs.push({
              player,
              message: `【死の宣告】${victim.word} を捕獲した呪いにより、${piece.word} に3手番の死の宣告（カウントダウン）が付与されました！`,
              type: 'ability'
            });
          }

          nextBoard[stopY][currentX] = finalPieceAtStop;
          nextBoard[y][x] = null;
        } else {
          // Legacy trap or regular piece
          const isSelfDestruct = victim.trigger === 'ON_TAKEN' && (
            isStealthPiece(victim) ||
            getPieceLogicCode(victim) === 'self_destruct_trap' ||
            getPieceLogicCode(victim) === 'curse_retaliation' ||
            vdesc.includes('道連れ') ||
            vdesc.includes('自爆') ||
            vdesc.includes('爆発') ||
            vdesc.includes('爆破') ||
            vdesc.includes('爆砕') ||
            vdesc.includes('激突') ||
            victim.ability_spec?.effect_type === 'DESTROY'
          );

          if (isSelfDestruct) {
            const logMsg = isStealthPiece(victim)
              ? `【罠衝突】突進中の ${piece.word} が罠「${victim.effect_name}」に激突！両者爆破・消滅しました！`
              : `【呪詛衝突】突進中の ${piece.word} が呪いの駒 ${victim.word} に激突！呪い「${victim.effect_name}」により、両者爆破・消滅しました！`;
            logs.push({
              player,
              message: logMsg,
              type: 'ability'
            });
            nextBoard[stopY][currentX] = null;
            nextBoard[y][x] = null;
          } else {
            logs.push({
              player,
              message: `【突撃撃破】${piece.word} が ${victim.word} (${getCellLabel(stopY, currentX)}) をなぎ倒し、捕獲しました！`,
              type: 'capture'
            });
            nextCaptured.push({
              ...victim,
              owner: player,
              isPromoted: false,
              isRevealed: true,
              coolDownTurnsRemaining: 0
            });
            nextBoard[stopY][currentX] = finalPieceAtStop;
            nextBoard[y][x] = null;
          }
        }
      } else {
        nextBoard[stopY][currentX] = finalPieceAtStop;
        nextBoard[y][x] = null;
      }
    }
  }
  // 5. Pierce / Crush (ON_MOVE trigger)
  else if (triggerType === 'ON_MOVE' && fromPosition && (
    desc.includes('貫通') ||
    desc.includes('突撃') ||
    desc.includes('直線') ||
    desc.includes('爆走') ||
    piece.word.includes('呂布') ||
    (piece.effect_name && piece.effect_name.includes('貫通'))
  ) && !desc.includes('レーザー') && !desc.includes('ビーム') && !desc.includes('縦直線') && !desc.includes('縦の直線')) {
    const [fy, fx] = fromPosition;
    const deltaY = y - fy;
    const deltaX = x - fx;
    
    // Check if straight line move
    if (deltaY === 0 || deltaX === 0 || Math.abs(deltaY) === Math.abs(deltaX)) {
      const stepY = deltaY === 0 ? 0 : deltaY / Math.abs(deltaY);
      const stepX = deltaX === 0 ? 0 : deltaX / Math.abs(deltaX);

      // Gather potential victims first
      const targets: [number, number][] = [];
      let cy1 = fy + stepY;
      let cx1 = fx + stepX;
      while (cy1 !== y || cx1 !== x) {
        if (isWithinBounds(cy1, cx1)) {
          const victim = nextBoard[cy1][cx1];
          if (victim && victim.owner !== player) {
            targets.push([cy1, cx1]);
          }
        }
        cy1 += stepY;
        cx1 += stepX;
      }

      let cy2 = y + stepY;
      let cx2 = x + stepX;
      while (isWithinBounds(cy2, cx2)) {
        const victim = nextBoard[cy2][cx2];
        if (victim && victim.owner !== player) {
          targets.push([cy2, cx2]);
        }
        cy2 += stepY;
        cx2 += stepX;
      }

      if (targets.length > 0) {
        const nullifyRes = checkAndApplyNullification(nextBoard, position, piece, effectName, targets, player, logs);
        if (nullifyRes.nullified) {
          return { board: nullifyRes.board, capturedPieces: nextCaptured, logs, triggered: true };
        }

        // Apply effect
        let cy1_act = fy + stepY;
        let cx1_act = fx + stepX;
        while (cy1_act !== y || cx1_act !== x) {
          if (isWithinBounds(cy1_act, cx1_act)) {
            const victim = nextBoard[cy1_act][cx1_act];
            if (victim && victim.owner !== player) {
              logs.push({
                player,
                message: `【一気貫通】${piece.word} の突撃進路上にいた敵の ${victim.word} (${getCellLabel(cy1_act, cx1_act)}) を一撃で捕獲しました！`,
                type: 'capture'
              });
              nextCaptured.push({
                ...victim,
                owner: player,
                isPromoted: false,
                coolDownTurnsRemaining: 0,
                isRevealed: true
              });
              nextBoard[cy1_act][cx1_act] = null;
            }
          }
          cy1_act += stepY;
          cx1_act += stepX;
        }

        let cy2_act = y + stepY;
        let cx2_act = x + stepX;
        while (isWithinBounds(cy2_act, cx2_act)) {
          const victim = nextBoard[cy2_act][cx2_act];
          if (victim && victim.owner !== player) {
            logs.push({
              player,
              message: `【一気貫通】${piece.word} の一気貫通の衝撃！ 直線上の敵 ${victim.word} (${getCellLabel(cy2_act, cx2_act)}) を捕獲しました！`,
              type: 'capture'
            });
            nextCaptured.push({
              ...victim,
              owner: player,
              isPromoted: false,
              coolDownTurnsRemaining: 0,
              isRevealed: true
            });
            nextBoard[cy2_act][cx2_act] = null;
          }
          cy2_act += stepY;
          cy2_act += stepX;
        }
      }
      triggered = true;
    }
  }
  // 6. Mimic / Copy (ON_MOVE or TURN_START trigger)
  else if (logic === 'mimic' || logic === 'ability_theft' || logic === 'transform' || desc.includes('擬態') || desc.includes('コピー') || desc.includes('変身')) {
    let target: Piece | null = null;
    let ty = -1, tx = -1;

    if (targetPosition) {
      [ty, tx] = targetPosition;
      target = nextBoard[ty][tx];
    } else {
      // Fallback / AI automated selection
      const adjacent = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      let found = false;
      for (const [dy, dx] of adjacent) {
        const ny = y + dy;
        const nx = x + dx;
        if (isWithinBounds(ny, nx)) {
          const p = nextBoard[ny][nx];
          if (p && p.owner !== player && !p.isKing) {
            target = p;
            ty = ny;
            tx = nx;
            found = true;
            break;
          }
        }
      }
      if (!found && (logic === 'transform' || desc.includes('変身') || desc.includes('コピー'))) {
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            const p = nextBoard[r][c];
            if (p && (r !== y || c !== x) && !p.isKing) {
              target = p;
              ty = r;
              tx = c;
              found = true;
              break;
            }
          }
        }
      }
    }

    if (target && !target.isKing) {
      const nullifyRes = checkAndApplyNullification(nextBoard, position, piece, effectName, [[ty, tx]], player, logs);
      if (nullifyRes.nullified) {
        return { board: nullifyRes.board, capturedPieces: nextCaptured, logs, triggered: true };
      }

      nextBoard[y][x] = {
        ...piece,
        word: `擬態・${target.word}`,
        effect_name: target.effect_name,
        description: `【擬態化中】${target.word} の能力をコピーしています。${target.description}`,
        range_geometry: { ...target.range_geometry },
        logic_code: target.logic_code,
        mechanics_type: target.mechanics_type,
        trigger: target.trigger,
        cool_down_turns: target.cool_down_turns,
        spawn_piece_name: target.spawn_piece_name,
        spawn_config: target.spawn_config ? { ...target.spawn_config } : undefined,
        promoted_effect: { ...target.promoted_effect },
        ability_spec: target.ability_spec ? { ...target.ability_spec } : undefined,
        custom_ability: target.custom_ability ? { ...target.custom_ability } : undefined,
        isStealth: target.isStealth
      };
      triggered = true;
      logs.push({
        player,
        message: `【擬態発動】${piece.word} が ${target.word} (${getCellLabel(ty, tx)}) の能力を完全にコピーしました！`,
        type: 'ability'
      });
    }
  }
  // 7. Puppet / Mind Control (ON_MOVE or TURN_START trigger)
  else if (logic === 'mind_control' || logic === 'puppet' || logic === 'parasite' || desc.includes('洗脳') || desc.includes('寄生') || desc.includes('支配')) {
    let targetsToControl: [number, number][] = [];
    if (targetPosition) {
      targetsToControl.push(targetPosition);
    } else {
      const adjacent = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      for (const [dy, dx] of adjacent) {
        const ny = y + dy;
        const nx = x + dx;
        if (isWithinBounds(ny, nx)) {
          const p = nextBoard[ny][nx];
          if (p && p.owner !== player && !p.isKing) {
            targetsToControl.push([ny, nx]);
          }
        }
      }
    }

    if (targetsToControl.length > 0) {
      const nullifyRes = checkAndApplyNullification(nextBoard, position, piece, effectName, targetsToControl, player, logs);
      if (nullifyRes.nullified) {
        return { board: nullifyRes.board, capturedPieces: nextCaptured, logs, triggered: true };
      }

      let controlledCount = 0;
      for (const [ty, tx] of targetsToControl) {
        const target = nextBoard[ty][tx];
        if (target && target.owner !== player && !target.isKing) {
          nextBoard[ty][tx] = {
            ...target,
            owner: player,
            isRevealed: true
          };
          controlledCount++;
          logs.push({
            player,
            message: `【洗脳支配】${piece.word} の精神干渉により、${target.word} (${getCellLabel(ty, tx)}) を支配し味方にしました！`,
            type: 'ability'
          });
        }
      }
      if (controlledCount > 0) {
        triggered = true;
      }
    }
  }
  // 7.5. Swap (ON_MOVE or TURN_START trigger)
  else if (logic === 'swap' || logic === 'swap_pawn' || desc.includes('スワップ') || desc.includes('入れ替え')) {
    let ty = -1, tx = -1;
    if (targetPosition) {
      [ty, tx] = targetPosition;
    } else {
      // Fallback: first friendly normal pawn
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = nextBoard[r][c];
          if (p && p.owner === player && p.isPawn && !p.isPromoted) {
            ty = r;
            tx = c;
            break;
          }
        }
        if (ty !== -1) break;
      }
    }

    if (ty !== -1 && tx !== -1) {
      const target = nextBoard[ty][tx];
      if (target) {
        nextBoard[ty][tx] = {
          ...piece,
          originalPosition: [ty, tx]
        };
        nextBoard[y][x] = {
          ...target,
          originalPosition: [y, x]
        };
        triggered = true;
        logs.push({
          player,
          message: `【位置入替】${piece.word} が ${target.word} (${getCellLabel(ty, tx)}) と位置を入れ替えました！`,
          type: 'ability'
        });
      }
    }
  }
  // 8. Timer / Egg / Hatch (TURN_START trigger)
  else if (logic === 'time_bomb' || logic === 'timer' || logic === 'egg' || logic === 'hatch' || desc.includes('孵化') || desc.includes('羽化') || desc.includes('進化')) {
    nextBoard[y][x] = {
      ...piece,
      word: '邪竜・ファヴニール',
      effect_name: '天地焦熱波',
      description: '【自動発動】移動完了時に周囲1マスをすべて焼き払う（爆破捕獲）。',
      mechanics_type: 'MOVEMENT_HACK',
      trigger: 'ON_MOVE',
      cool_down_turns: 1,
      range_geometry: {
        normal_grid: '1111111111112111111111111',
        charging_grid: '0000000100012100010000000'
      },
      logic_code: 'kill_adjacent_remote',
      spawn_piece_name: null,
      promoted_effect: {
        effect_name: '極・天地焦熱波',
        description: '成ることで、周囲2マスの敵をすべて即時破壊する。'
      },
      coolDownTurnsRemaining: 0,
      isRevealed: true
    };
    triggered = true;
    logs.push({
      player,
      message: `【孵化覚醒】${piece.word} が孵化を完了し、「邪竜・ファヴニール」へと超進化した！`,
      type: 'ability'
    });
  }
  // 9. Remote Snipe (ON_MOVE trigger)
  else if (triggerType === 'ON_MOVE' && (logic === 'remote_snipe' || logic === 'sniper' || desc.includes('狙撃') || desc.includes('スナイパー'))) {
    const directions = [
      [-3, 0], [3, 0], [0, -3], [0, 3],
      [-3, -3], [-3, 3], [3, -3], [3, 3]
    ];
    let targetCell: [number, number] | null = null;
    for (const [dy, dx] of directions) {
      const ny = y + dy;
      const nx = x + dx;
      if (isWithinBounds(ny, nx)) {
        const p = nextBoard[ny][nx];
        if (p && p.owner !== player && !p.isKing) {
          targetCell = [ny, nx];
          break; // Snipes the first target found
        }
      }
    }
    if (targetCell) {
      const [ty, tx] = targetCell;
      const victim = nextBoard[ty][tx];
      if (victim) {
        const nullifyRes = checkAndApplyNullification(nextBoard, position, piece, effectName, [[ty, tx]], player, logs);
        if (nullifyRes.nullified) {
          return { board: nullifyRes.board, capturedPieces: nextCaptured, logs, triggered: true };
        }
        nextCaptured.push({
          ...victim,
          owner: player,
          isPromoted: false,
          isRevealed: true,
          coolDownTurnsRemaining: 0
        });
        nextBoard[ty][tx] = null;
        triggered = true;
        logs.push({
          player,
          message: `【狙撃発動】${piece.word} の効果「${effectName}」により遠隔から狙撃！ ${getCellLabel(ty, tx)} にいた敵の ${victim.word} を捕獲しました！`,
          type: 'capture'
        });
      }
    }
  }
  // 10. Stun Mist (ON_MOVE trigger)
  else if (triggerType === 'ON_MOVE' && (logic === 'stun_mist' || logic === 'poison_mist' || desc.includes('毒霧') || desc.includes('スタン霧') || desc.includes('眠り粉'))) {
    const adjacent = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    let stunnedAny = false;
    const affectedPositions: [number, number][] = [];
    for (const [dy, dx] of adjacent) {
      const ny = y + dy;
      const nx = x + dx;
      if (isWithinBounds(ny, nx)) {
        const p = nextBoard[ny][nx];
        if (p && p.owner !== player && !p.isKing) {
          affectedPositions.push([ny, nx]);
        }
      }
    }

    if (affectedPositions.length > 0) {
      const nullifyRes = checkAndApplyNullification(nextBoard, position, piece, effectName, affectedPositions, player, logs);
      if (nullifyRes.nullified) {
        return { board: nullifyRes.board, capturedPieces: nextCaptured, logs, triggered: true };
      }
      for (const [ny, nx] of affectedPositions) {
        const p = nextBoard[ny][nx];
        if (p) {
          nextBoard[ny][nx] = {
            ...p,
            stunTurnsRemaining: 2
          };
          stunnedAny = true;
          logs.push({
            player,
            message: `【毒霧発動】${piece.word} が毒霧を放出！ ${p.word} (${getCellLabel(ny, nx)}) を2手番の間、行動封印（スタン）にしました！`,
            type: 'ability'
          });
        }
      }
      if (stunnedAny) {
        triggered = true;
      }
    }
  }
  // 10.5. Trap Placement / Spawn Trap (ON_MOVE trigger)
  else if (
    triggerType === 'ON_MOVE' &&
    (logic === 'spawn_trap' ||
     logic === 'place_trap' ||
     desc.includes('罠設置') ||
     desc.includes('地雷設置') ||
     desc.includes('罠を設置') ||
     desc.includes('地雷を設置') ||
     desc.includes('トラップ設置'))
  ) {
    const adjacent = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    const emptySpawnCells: [number, number][] = [];
    for (const [dy, dx] of adjacent) {
      const ny = y + dy;
      const nx = x + dx;
      if (isWithinBounds(ny, nx) && nextBoard[ny][nx] === null) {
        emptySpawnCells.push([ny, nx]);
      }
    }

    if (emptySpawnCells.length > 0) {
      const [sy, sx] = emptySpawnCells[Math.floor(Math.random() * emptySpawnCells.length)];
      
      const isMine = desc.includes('地雷');
      const trapWord = isMine ? '地雷' : '罠';
      const trapPiece: Piece = {
        id: generateId(),
        word: trapWord,
        effect_name: isMine ? '道連れ地雷' : '仕掛け罠',
        mechanics_type: 'STEALTH_TRAP',
        ability_genre: '因果・罠',
        trigger: 'ON_TAKEN',
        cool_down_turns: 0,
        range_geometry: {
          normal_grid: '0000000100012100010000000',
          charging_grid: '0000000100012100010000000',
          promoted_grid: '0000001110012100111000000'
        },
        description: `【発動条件】敵駒に重なって捕獲された瞬間（自動発動）。\n【効果内容】敵の駒を道連れにして消滅させる。\n【制限・代償】使い捨て。`,
        spawn_piece_name: null,
        spawn_config: {
          spawn_piece_name: null,
          max_limit: 0,
          spawn_range_geometry: null
        },
        promoted_effect: {
          effect_name: isMine ? '極・道連れ地雷' : '極・仕掛け罠',
          description: '成ることで能力が再活性化する。'
        },
        deep_search_analysis: '',
        owner: player,
        isKing: false,
        isPawn: false,
        originalPosition: [sy, sx],
        coolDownTurnsRemaining: 0,
        isRevealed: false,
        isPromoted: false
      };

      nextBoard[sy][sx] = trapPiece;
      triggered = true;
      logs.push({
        player,
        message: `【罠設置】${piece.word} が移動先の隣接マス ${getCellLabel(sy, sx)} に裏向きの${trapWord}を設置しました！`,
        type: 'ability'
      });
    } else {
      logs.push({
        player,
        message: `【自動発動制限】${piece.word} の移動先の周囲に空きマスがないため、罠を設置できませんでした。`,
        type: 'system'
      });
    }
  }
  // 11. Resurrection Recycler / Zombie (ON_MOVE trigger)
  else if (triggerType === 'ON_MOVE' && (logic === 'recycle_dead' || logic === 'recycle' || desc.includes('死者蘇生') || desc.includes('蘇生') || desc.includes('ゾンビ'))) {
    // Limit to max 2 active zombies on the board owned by this player
    let zombieCount = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = nextBoard[r][c];
        if (p && p.owner === player && p.word.startsWith('ゾンビ・')) {
          zombieCount++;
        }
      }
    }

    if (zombieCount >= 2) {
      logs.push({
        player,
        message: `【自動発動制限】盤面に存在するゾンビ兵が上限(2体)に達しているため、新規召喚をスキップしました。`,
        type: 'ability'
      });
      return { board: nextBoard, capturedPieces: nextCaptured, graveyard: nextGraveyard, logs, triggered: true };
    }

    let target: Piece | null = null;
    let targetIdx = -1;

    if (selectedGraveyardPiece) {
      target = selectedGraveyardPiece;
      targetIdx = nextGraveyard.findIndex(p => p.id === selectedGraveyardPiece.id);
    } else {
      const candidates = nextGraveyard.filter(p => p && !p.isKing && (isCustomPiece(p) || p.isHisha || p.isKaku));
      if (candidates.length > 0) {
        target = candidates[Math.floor(Math.random() * candidates.length)];
        targetIdx = nextGraveyard.findIndex(p => p.id === target!.id);
      }
    }

    if (target && targetIdx !== -1) {
      const adjacent = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      
      let spawnCell: [number, number] | null = null;

      if (targetPosition) {
        const [ty, tx] = targetPosition;
        if (isWithinBounds(ty, tx) && nextBoard[ty][tx] === null) {
          spawnCell = targetPosition;
        }
      } else {
        const emptySpawnCells: [number, number][] = [];
        for (const [dy, dx] of adjacent) {
          const ny = y + dy;
          const nx = x + dx;
          if (isWithinBounds(ny, nx) && nextBoard[ny][nx] === null) {
            emptySpawnCells.push([ny, nx]);
          }
        }
        if (emptySpawnCells.length > 0) {
          spawnCell = emptySpawnCells[Math.floor(Math.random() * emptySpawnCells.length)];
        }
      }

      if (spawnCell) {
        const [sy, sx] = spawnCell;
        const nullifyRes = checkAndApplyNullification(nextBoard, position, piece, effectName, [[sy, sx]], player, logs);
        if (nullifyRes.nullified) {
          return { board: nullifyRes.board, capturedPieces: nextCaptured, graveyard: nextGraveyard, logs, triggered: true };
        }

        const isZombie = target.owner !== player;
        const isStealth = isStealthPiece(target);
        const zombiePiece: Piece = {
          ...target,
          id: generateId(),
          word: isZombie ? `ゾンビ・${target.word}` : target.word,
          owner: player,
          isPromoted: false,
          coolDownTurnsRemaining: 0,
          originalPosition: [sy, sx],
          isRevealed: isStealth ? false : true,
          isStealth: isStealth ? true : false,
        };
        nextBoard[sy][sx] = zombiePiece;
        nextGraveyard.splice(targetIdx, 1);
        triggered = true;

        logs.push({
          player,
          message: isZombie 
            ? `【死者蘇生】${piece.word} が闇の魔術を発動！墓地から敵の『${target.word}』をゾンビ兵「${zombiePiece.word}」として ${getCellLabel(sy, sx)} に寝返り召喚しました！`
            : `【死者蘇生】${piece.word} が闇の魔術を発動！墓地から自軍の『${target.word}』を ${getCellLabel(sy, sx)} に蘇生召喚しました！`,
          type: 'ability'
        });
      } else {
        triggered = true;
        logs.push({
          player,
          message: `【自動発動制限】${piece.word} の周囲に召喚可能な空きマスがないため、召喚に失敗しました。`,
          type: 'system'
        });
      }
    } else {
      triggered = true;
      logs.push({
        player,
        message: `【自動発動制限】墓地に召喚可能な対象駒（カスタム駒または飛車・角）がないため、死者蘇生できませんでした。`,
        type: 'system'
      });
    }
  }

  if (triggered) {
    let foundPiece: Piece | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = nextBoard[r][c];
        if (p && p.id === piece.id) {
          foundPiece = p;
          break;
        }
      }
      if (foundPiece) break;
    }
    if (foundPiece) {
      const isOnce = foundPiece.is_once_per_game || foundPiece.cool_down_turns === 99;
      if (isOnce) {
        foundPiece.coolDownTurnsRemaining = 99;
      } else if (isAutonomousPiece(foundPiece)) {
        foundPiece.cool_down_turns = 0;
        foundPiece.coolDownTurnsRemaining = 0;
      } else if (foundPiece.cool_down_turns > 0) {
        foundPiece.coolDownTurnsRemaining = foundPiece.cool_down_turns;
      }
    }
  }

  // Set once per game cooldown if evaluated on move
  const isPieceOnce = piece.is_once_per_game || piece.cool_down_turns === 99;
  if (isPieceOnce && triggerType === 'ON_MOVE') {
    let foundPiece: Piece | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = nextBoard[r][c];
        if (p && p.id === piece.id) {
          foundPiece = p;
          break;
        }
      }
      if (foundPiece) break;
    }
    if (foundPiece) {
      foundPiece.coolDownTurnsRemaining = 99;
    }
  }

  if (triggered) {
    const currentPiece = getBoardPiece(nextBoard, { x, y });
    if (currentPiece) {
      const currentUses = currentPiece.remaining_uses !== undefined ? currentPiece.remaining_uses : 3;
      const nextUses = currentUses - 1;

      decrementCacheUses(currentPiece.word).catch((e: any) => console.warn(e));

      let finalPieceState: Piece = { ...currentPiece };

      if (nextUses <= 0) {
        finalPieceState = degradeToNormalPawn(finalPieceState);
        finalPieceState.remaining_uses = 0;
        logs.push({
          player: currentPiece.owner,
          message: `【能力消滅】${currentPiece.word} の能力は3回発動したため消滅し、普通の歩兵になりました。`,
          type: 'system'
        });
      } else {
        finalPieceState.remaining_uses = nextUses;
        if (finalPieceState.custom_ability) {
          finalPieceState.custom_ability = {
            ...finalPieceState.custom_ability,
            remaining_uses: nextUses
          };
        }
        logs.push({
          player: currentPiece.owner,
          message: `【耐久度】${currentPiece.word} の能力残り使用回数: ${nextUses}回`,
          type: 'system'
        });
      }

      setBoardPiece(nextBoard, { x, y }, finalPieceState);
    }
  }

  return { board: nextBoard, capturedPieces: nextCaptured, graveyard: nextGraveyard, logs, triggered };
}

export function isKingInCheck(board: Board, player: Player): boolean {
  let kingY = -1;
  let kingX = -1;
  
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const piece = getBoardPiece(board, { x, y });
      if (piece && piece.isKing && piece.owner === player) {
        kingY = y;
        kingX = x;
        break;
      }
    }
    if (kingY !== -1) break;
  }
  
  if (kingY === -1) return false;
  
  const opponent = player === 'sente' ? 'gote' : 'sente';
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const piece = getBoardPiece(board, { x, y });
      if (piece && piece.owner === opponent) {
        const moves = getValidMoves(y, x, board);
        if (moves.some(([my, mx]) => my === kingY && mx === kingX)) {
          return true;
        }
      }
    }
  }
  
  return false;
}

export function getAbilityTargets(
  board: Board,
  position: [number, number],
  player: Player,
  graveyard?: Piece[]
): { targets: [number, number][]; type: 'transform' | 'mind_control' | 'swap' | 'resurrect' } | null {
  const [y, x] = position;
  const piece = getBoardPiece(board, { x, y });

  if (!piece) return null;

  // ── 新プラグイン型・遠隔選択ターゲット（RANGE_2 / RANGE_3 + POINT） ──
  if (piece.custom_ability) {
    const targets = piece.custom_ability.targets || [];
    const hasRange2 = targets.includes('RANGE_2');
    const hasRange3 = targets.includes('RANGE_3');
    const hasPoint = targets.includes('POINT');

    if ((hasRange2 || hasRange3) && hasPoint) {
      if (piece.coolDownTurnsRemaining && piece.coolDownTurnsRemaining > 0) {
        return null;
      }
      const rangeDist = hasRange3 ? 3 : 2;
      const actions = piece.custom_ability.actions || [];
      const isSpawnOrTile = actions.some((a: string) => a.startsWith('SET_TILE_') || a === 'SPAWN_TOKEN' || a === 'WALL_CREATE');
      const selectables: [number, number][] = [];
      for (let dy = -rangeDist; dy <= rangeDist; dy++) {
        for (let dx = -rangeDist; dx <= rangeDist; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny === y && nx === x) continue; // Skip acting piece itself
          if (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
            const targetCell = getBoardPiece(board, { x: nx, y: ny });
            if (isSpawnOrTile) {
              if (!targetCell) selectables.push([ny, nx]);
            } else {
              if (targetCell && targetCell.owner !== player && !targetCell.isKing) {
                selectables.push([ny, nx]);
              }
            }
          }
        }
      }
      return selectables.length > 0 ? { targets: selectables, type: 'mind_control' } : null;
    }
  }

  // ── 動的インタープリター優先ルート ──
  const spec = getPieceAbilitySpec(piece);
  if (spec) {
    if (spec.target_selection === 'CLICK_ZONE') {
      const typeMap: Record<string, 'transform' | 'mind_control' | 'swap' | 'resurrect'> = {
        'TRANSFORM': 'transform',
        'SWAP': 'swap',
        'RESURRECT': 'resurrect',
        'CAPTURE': 'mind_control'
      };
      const abilityType = typeMap[spec.effect_type] || 'mind_control';
      
      if (spec.effect_type === 'RESURRECT') {
        const candidates = (graveyard || []).filter(p => p && !p.isKing);
        if (candidates.length === 0) return null;
        const targets: [number, number][] = [];
        const adjacent = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        for (const [dy, dx] of adjacent) {
          const ny = y + dy, nx = x + dx;
          if (isWithinBounds(ny, nx) && getBoardPiece(board, { x: nx, y: ny }) === null) targets.push([ny, nx]);
        }
        return targets.length > 0 ? { targets, type: 'resurrect' } : null;
      }

      const targets = getSelectableRangeCells(y, x, spec.range, spec.affects_who, board, player);
      return targets.length > 0 ? { targets, type: abilityType } : null;
    }
    return null;
  }

  if (!piece || piece.coolDownTurnsRemaining > 0) return null;

  const desc = getPieceDescription(piece);
  const logic = getPieceLogicCode(piece);

  const isTransform = logic === 'transform' || logic === 'mimic' || logic === 'ability_theft' || desc.includes('擬態') || desc.includes('コピー') || desc.includes('変身');
  const isMindControl = logic === 'mind_control' || logic === 'puppet' || logic === 'parasite' || desc.includes('洗脳') || desc.includes('寄生') || desc.includes('支配');
  const isSwap = logic === 'swap' || logic === 'swap_pawn' || desc.includes('スワップ') || desc.includes('入れ替え');
  const isResurrect = logic === 'recycle_dead' || logic === 'recycle' || desc.includes('死者蘇生') || desc.includes('蘇生') || desc.includes('ゾンビ');

  if (isResurrect) {
    const candidates = (graveyard || []).filter(p => p && !p.isKing && (isCustomPiece(p) || p.isHisha || p.isKaku));
    if (candidates.length === 0) return null;

    const targets: [number, number][] = [];
    const adjacent = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    for (const [dy, dx] of adjacent) {
      const ny = y + dy;
      const nx = x + dx;
      if (isWithinBounds(ny, nx) && getBoardPiece(board, { x: nx, y: ny }) === null) {
        targets.push([ny, nx]);
      }
    }
    return targets.length > 0 ? { targets, type: 'resurrect' } : null;
  }

  if (isTransform) {
    const targets: [number, number][] = [];
    const isAdjacentOnly = desc.includes('周囲') || desc.includes('隣接') || logic === 'mimic';
    if (isAdjacentOnly) {
      const adjacent = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      for (const [dy, dx] of adjacent) {
        const ny = y + dy;
        const nx = x + dx;
        if (isWithinBounds(ny, nx)) {
          const p = getBoardPiece(board, { x: nx, y: ny });
          if (p && p.owner !== player && !p.isKing) {
            targets.push([ny, nx]);
          }
        }
      }
    } else {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = getBoardPiece(board, { x: c, y: r });
          if (p && (r !== y || c !== x) && !p.isKing) {
            targets.push([r, c]);
          }
        }
      }
    }
    return targets.length > 0 ? { targets, type: 'transform' } : null;
  }

  if (isMindControl) {
    const targets: [number, number][] = [];
    const adjacent = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    for (const [dy, dx] of adjacent) {
      const ny = y + dy;
      const nx = x + dx;
      if (isWithinBounds(ny, nx)) {
        const p = getBoardPiece(board, { x: nx, y: ny });
        if (p && p.owner !== player && !p.isKing) {
          targets.push([ny, nx]);
        }
      }
    }
    return targets.length > 0 ? { targets, type: 'mind_control' } : null;
  }

  if (isSwap) {
    const targets: [number, number][] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = getBoardPiece(board, { x: c, y: r });
        if (p && p.owner === player && p.isPawn && !p.isPromoted) {
          targets.push([r, c]);
        }
      }
    }
    return targets.length > 0 ? { targets, type: 'swap' } : null;
  }

  return null;
}

export function placeCustomPiecesRandomly(board: Board, sentePieces: Piece[], gotePieces: Piece[]): Board {
  const nextBoard = board.map(row => [...row]);

  // Find Gote King position (should be at (0, 4))
  let goteKingPos: [number, number] = [0, 4];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = getBoardPiece(board, { x: c, y: r });
      if (p?.isKing && p?.owner === 'gote') {
        goteKingPos = [r, c];
      }
    }
  }

  // Find Sente King position (should be at (8, 4))
  let senteKingPos: [number, number] = [8, 4];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = getBoardPiece(board, { x: c, y: r });
      if (p?.isKing && p?.owner === 'sente') {
        senteKingPos = [r, c];
      }
    }
  }

  // Helper to check if a piece at a position can attack the enemy King
  const canAttackTarget = (piece: Piece, py: number, px: number, ty: number, tx: number): boolean => {
    // 1. Column safety: do not place on the same column as the target King (x === 4)
    if (px === tx) return true;

    // 2. Check if the target is within the piece's normal movement geometry
    const grid = piece.range_geometry.normal_grid;
    const dy = ty - py;
    const dx = tx - px;
    
    // Relative coordinates in the 5x5 grid (centered at [2, 2])
    const isSente = piece.owner === 'sente';
    const relY = 2 + (isSente ? dy : -dy);
    const relX = 2 + (isSente ? dx : -dx);

    if (relY >= 0 && relY < 5 && relX >= 0 && relX < 5) {
      const idx = relY * 5 + relX;
      const char = grid[idx];
      if (char === '1' || char === '2') {
        return true;
      }
    }

    // 3. For sliding pieces, check long range
    const logic = getPieceLogicCode(piece).toLowerCase();
    const desc = getPieceDescription(piece);
    const isStraightLineDestruction = desc.includes('狙撃') || desc.includes('貫通') || desc.includes('直線上') || logic === 'linear_charge' || logic === 'remote_snipe';
    
    if (isStraightLineDestruction) {
      if (py === ty || px === tx || Math.abs(py - ty) === Math.abs(px - tx)) {
        return true;
      }
    }

    return false;
  };

  // Helper to place pieces for one player
  const placeForPlayer = (pieces: Piece[], rows: number[], opponentKingPos: [number, number]) => {
    // Gather all empty positions in rows
    let emptyCells: [number, number][] = [];
    for (const r of rows) {
      for (let c = 0; c < 9; c++) {
        if (getBoardPiece(nextBoard, { x: c, y: r }) === null) {
          emptyCells.push([r, c]);
        }
      }
    }

    // Shuffle emptyCells
    for (let i = emptyCells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [emptyCells[i], emptyCells[j]] = [emptyCells[j], emptyCells[i]];
    }

    // Place each piece
    for (const piece of pieces) {
      let placed = false;
      for (let idx = 0; idx < emptyCells.length; idx++) {
        const [py, px] = emptyCells[idx];
        if (!canAttackTarget(piece, py, px, opponentKingPos[0], opponentKingPos[1])) {
          setBoardPiece(nextBoard, { x: px, y: py }, {
            ...piece,
            originalPosition: [py, px],
            coolDownTurnsRemaining: 0,
            hasMovedManually: true, // starts on board, so active from start
            isRevealed: isStealthPiece(piece) ? false : true
          });
          emptyCells.splice(idx, 1);
          placed = true;
          break;
        }
      }

      // Fallback
      if (!placed && emptyCells.length > 0) {
        const [py, px] = emptyCells[0];
        setBoardPiece(nextBoard, { x: px, y: py }, {
          ...piece,
          originalPosition: [py, px],
          coolDownTurnsRemaining: 0,
          hasMovedManually: true,
          isRevealed: isStealthPiece(piece) ? false : true
        });
        emptyCells.shift();
      }
    }
  };

  // Place Sente custom pieces (rows 7, 8) avoiding Gote King
  placeForPlayer(sentePieces, [7, 8], goteKingPos);

  // Place Gote custom pieces (rows 0, 1) avoiding Sente King
  placeForPlayer(gotePieces, [0, 1], senteKingPos);

  return nextBoard;
}

export function ensurePosition(pos: Position | [number, number] | undefined): Position {
  if (!pos) return { x: 0, y: 0 };
  if (Array.isArray(pos)) {
    return { x: pos[1], y: pos[0] };
  }
  return pos;
}

export type TargetFunction = (to: Position, board: Board, from: Position) => Position[];

export const TargetRegistry: Record<string, TargetFunction> = {
  POINT: (to) => [to],
  SQUARE_3X3: (to) => {
    const cells: Position[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ny = to.y + dy;
        const nx = to.x + dx;
        if (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
          cells.push({ x: nx, y: ny });
        }
      }
    }
    return cells;
  },
  SQUARE_5X5: (to) => {
    const cells: Position[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const ny = to.y + dy;
        const nx = to.x + dx;
        if (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
          cells.push({ x: nx, y: ny });
        }
      }
    }
    return cells;
  },
  CROSS: (to) => {
    const cells: Position[] = [];
    cells.push({ x: to.x, y: to.y });
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dy, dx] of dirs) {
      let ny = to.y + dy;
      let nx = to.x + dx;
      while (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
        cells.push({ x: nx, y: ny });
        ny += dy;
        nx += dx;
      }
    }
    return cells;
  },
  LINE_STRAIGHT: (to, board, _from) => {
    const cells: Position[] = [];
    // Find the piece on the board that has custom_ability
    let sy = -1, sx = -1;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (p && (p.custom_ability || (p as any).ability) && p.coolDownTurnsRemaining === 0) {
          sy = r;
          sx = c;
          break;
        }
      }
      if (sy !== -1) break;
    }
    
    if (sy !== -1) {
      const dy = Math.sign(to.y - sy);
      const dx = Math.sign(to.x - sx);
      if (dy !== 0 || dx !== 0) {
        let ny = sy + dy;
        let nx = sx + dx;
        while (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
          cells.push({ x: nx, y: ny });
          const p = board[ny][nx];
          if (p && p.isObstacle) {
            break;
          }
          ny += dy;
          nx += dx;
        }
        return cells;
      }
    }
    
    // Fallback vertical laser column
    for (let y = 0; y < 9; y++) {
      cells.push({ x: to.x, y });
    }
    return cells;
  },
  RANGE_2: (to) => {
    const cells: Position[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const ny = to.y + dy;
        const nx = to.x + dx;
        if (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
          cells.push({ x: nx, y: ny });
        }
      }
    }
    return cells;
  },
  RANGE_3: (to) => {
    const cells: Position[] = [];
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const ny = to.y + dy;
        const nx = to.x + dx;
        if (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
          cells.push({ x: nx, y: ny });
        }
      }
    }
    return cells;
  },
  LINE_DIAGONAL: (to) => {
    const cells: Position[] = [{ x: to.x, y: to.y }];
    const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dy, dx] of dirs) {
      let ny = to.y + dy;
      let nx = to.x + dx;
      while (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
        cells.push({ x: nx, y: ny });
        ny += dy;
        nx += dx;
      }
    }
    return cells;
  },
  KNIGHT_JUMP_ALL: (to) => {
    const cells: Position[] = [];
    const offsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dy, dx] of offsets) {
      const ny = to.y + dy;
      const nx = to.x + dx;
      if (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
        cells.push({ x: nx, y: ny });
      }
    }
    return cells;
  },
  FRONT_3_LINE: (to, board, from) => {
    const cells: Position[] = [];
    const p = BoardManager.getPiece(board, to) || BoardManager.getPiece(board, from);
    const isSente = p ? p.owner === 'sente' : true;
    const dy = isSente ? -1 : 1;
    for (let i = 1; i <= 3; i++) {
      const ny = to.y + dy * i;
      const nx = to.x;
      if (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
        cells.push({ x: nx, y: ny });
      }
    }
    return cells;
  },
  ALL_ENEMY_PIECES: (to, board, from) => {
    const cells: Position[] = [];
    const p = BoardManager.getPiece(board, to) || BoardManager.getPiece(board, from);
    const myOwner = p ? p.owner : 'sente';
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = board[r][c];
        if (cell && cell.owner !== myOwner) {
          cells.push({ x: c, y: r });
        }
      }
    }
    return cells;
  },
  LEADER_SURROUND: (to, board, from) => {
    const cells: Position[] = [];
    const p = BoardManager.getPiece(board, to) || BoardManager.getPiece(board, from);
    const myOwner = p ? p.owner : 'sente';
    let enemyKingPos: Position | null = null;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = board[r][c];
        if (cell && cell.isKing && cell.owner !== myOwner) {
          enemyKingPos = { x: c, y: r };
          break;
        }
      }
      if (enemyKingPos) break;
    }
    if (enemyKingPos) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue;
          const ny = enemyKingPos.y + dy;
          const nx = enemyKingPos.x + dx;
          if (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
            cells.push({ x: nx, y: ny });
          }
        }
      }
    }
    return cells;
  }
};

export interface ActionContext {
  piece: Piece;
  player: Player;
  from: Position;
  to: Position;
  graveyard: Piece[];
  capturedPieces: Piece[];
  opponentCapturedPieces?: Piece[];
  logs: Omit<GameLog, 'id' | 'timestamp'>[];
  triggeredRef: { value: boolean };
  reActionRef: { value: boolean };
  effectName: string;
  currentActingPos: Position;
  ability: CustomAbility;
}

export type ActionFunction = (
  targetPos: Position,
  board: Board,
  to: Position,
  context: ActionContext
) => void;

export function triggerOnDeathEffect(
  victim: Piece,
  targetPos: Position,
  board: Board,
  context: {
    piece: Piece;
    player: Player;
    from: Position;
    to: Position;
    graveyard: Piece[];
    capturedPieces: Piece[];
    logs: Omit<GameLog, 'id' | 'timestamp'>[];
    triggeredRef: { value: boolean };
    reActionRef: { value: boolean };
    effectName: string;
    currentActingPos: Position;
    ability?: any;
    constraints?: string[];
  }
): void {
  if (isTriggerMatching(victim, 'ON_DEATH')) {
    const effectRes = applyAutomatedEffect(
      board,
      [targetPos.y, targetPos.x],
      'ON_DEATH',
      victim.owner,
      context.capturedPieces,
      undefined,
      undefined,
      context.graveyard,
      context.graveyard
    );
if (effectRes.triggered) {
      if (effectRes.capturedPieces && effectRes.capturedPieces.length > 0) {
        context.capturedPieces.push(...effectRes.capturedPieces);
      }
      if (effectRes.graveyard) {
        context.graveyard.length = 0;
        context.graveyard.push(...effectRes.graveyard);
      }
      context.logs.push(...effectRes.logs);
    }
  }
}

export function triggerShareFate(
  board: Board,
  piece: Piece,
  logs: Omit<GameLog, 'id' | 'timestamp'>[],
  graveyard: Piece[]
): void {
  if (piece.linkedPieceId) {
    const linkId = piece.linkedPieceId;
    piece.linkedPieceId = undefined;
    
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (p && p.id === linkId) {
          board[r][c] = null;
          graveyard.push({
            ...p,
            isPromoted: false,
            coolDownTurnsRemaining: 0,
            isRevealed: true
          });
          logs.push({
            player: p.owner,
            message: `【因果応報】連動消滅！${piece.word} が失われたことにより、運命を共有していた ${p.word} (${getCellLabel(r, c)}) も連動して消滅しました！`,
            type: 'system'
          });
          triggerShareFate(board, p, logs, graveyard);
          return;
        }
      }
    }
  }
}

export function applyCoreActionEffect(
  actionKey: string,
  targetPos: Position,
  board: Board,
  to: Position,
  context: {
    piece: Piece;
    player: Player;
    from: Position;
    to: Position;
    graveyard: Piece[];
    capturedPieces: Piece[];
    opponentCapturedPieces?: Piece[];
    logs: Omit<GameLog, 'id' | 'timestamp'>[];
    triggeredRef: { value: boolean };
    reActionRef: { value: boolean };
    effectName: string;
    currentActingPos: Position;
    ability?: any;
    constraints?: string[];
  }
): void {
  const isSelfExecutionAction = ['RE_ACTION', 'STEAL_HAND', 'AUTO_FOLLOW_UP', 'BOOMERANG', 'GRAVITY_PULL', 'WALL_CREATE', 'LEAVE_TRAIL_FIRE', 'EVOLUTION', 'EVOLUTION_CHECK', 'CLEAR_DEBUFF', 'CLEAVE_LINE', 'OVERDRIVE_BOOST', 'CHARGE_TURN', 'SACRIFICE_COST', 'SELF_STUN', 'DELAYED_BURST'].includes(actionKey);
  if (!isSelfExecutionAction && actionKey !== 'STEALTH_ON' && targetPos.x === context.to.x && targetPos.y === context.to.y) {
    if (context.ability?.targets?.includes('SELF') || context.ability?.target_selection === 'SELF') {
      // Allow self
    } else {
      return;
    }
  }

  if (actionKey === 'RE_ACTION') {
    if (context.triggeredRef.value) return;
    context.reActionRef.value = true;
    context.triggeredRef.value = true;
    context.logs.push({
      player: context.player,
      message: `【${context.effectName}】覚醒の力が発動！同じ手番でもう一度行動できます！`,
      type: 'ability'
    });
    return;
  }

  const victim = BoardManager.getPiece(board, targetPos);

  if (actionKey === 'SPAWN_TOKEN') {
    if (victim !== null) return;
    const spawnPieceName = context.piece.spawn_config?.spawn_piece_name || context.piece.spawn_piece_name || 'トークン';
    const maxLimit = context.piece.spawn_config?.max_limit ?? 2;

    let minionCount = 0;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const p = getBoardPiece(board, { x: c, y: r });
        if (p && p.owner === context.player && p.word === spawnPieceName) {
          minionCount++;
        }
      }
    }

    if (minionCount < maxLimit) {
      const clonePiece: Piece = {
        id: generateId(),
        word: spawnPieceName,
        effect_name: context.piece.effect_name,
        mechanics_type: context.piece.mechanics_type,
        ability_genre: context.piece.ability_genre || '武力・突撃',
        trigger: 'ALWAYS',
        cool_down_turns: 0,
        range_geometry: {
          normal_grid: '0000000100012100010000000',
          charging_grid: '0000000100012100010000000',
          promoted_grid: '0000001110012100111000000'
        },
        description: `生み出された${spawnPieceName}。`,
        spawn_piece_name: null,
        spawn_config: {
          spawn_piece_name: null,
          max_limit: 0,
          spawn_range_geometry: null
        },
        promoted_effect: {
          effect_name: `${spawnPieceName}・醒`,
          description: `覚醒した${spawnPieceName}。移動範囲が8方向に拡大しました！`
        },
        deep_search_analysis: '',
        owner: context.player,
        isKing: false,
        isPawn: false,
        originalPosition: [targetPos.y, targetPos.x],
        coolDownTurnsRemaining: 0,
        isRevealed: true,
        isPromoted: false
      };
      BoardManager.setPiece(board, targetPos, clonePiece);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】${getCellLabel(targetPos.y, targetPos.x)} に「${spawnPieceName}」が生成されました！`,
        type: 'ability'
      });
    } else {
      context.logs.push({
        player: context.player,
        message: `【自動発動制限】盤面に存在する ${spawnPieceName} が上限(${maxLimit}体)に達しているため、新規召喚をスキップしました。`,
        type: 'system'
      });
    }
    return;
  }

  if (actionKey === 'WALL_CREATE') {
    if (victim !== null) return;
    const wallPiece: Piece = {
      id: generateId(),
      word: '結界',
      effect_name: '防壁',
      mechanics_type: 'RULE_BREAK',
      ability_genre: '能力無効化・結界',
      trigger: 'ALWAYS',
      cool_down_turns: 0,
      range_geometry: {
        normal_grid: '0000000000002000000000000',
        charging_grid: '0000000000002000000000000',
        promoted_grid: '0000000000002000000000000'
      },
      description: '進入不可能の防壁。3ターン経過で自動消滅する。',
      spawn_piece_name: null,
      promoted_effect: {
        effect_name: '結界・醒',
        description: '覚醒した結界。'
      },
      deep_search_analysis: '',
      owner: context.player,
      isKing: false,
      isPawn: false,
      originalPosition: [targetPos.y, targetPos.x],
      coolDownTurnsRemaining: 0,
      isRevealed: true,
      isPromoted: false,
      type: 'wall',
      duration: 3,
      isObstacle: true
    };
    BoardManager.setPiece(board, targetPos, wallPiece);
    context.triggeredRef.value = true;
    context.logs.push({
      player: context.player,
      message: `【${context.effectName}】結界展開！${getCellLabel(targetPos.y, targetPos.x)} に進入不可の防壁（結界）を生成しました！`,
      type: 'ability'
    });
    return;
  }

  if (actionKey === 'LEAVE_TRAIL_FIRE') {
    if (context.triggeredRef.value) return;
    const pathCells: Position[] = [];
    const fy = context.from.y;
    const fx = context.from.x;
    const ty = context.to.y;
    const tx = context.to.x;

    const dy = Math.sign(ty - fy);
    const dx = Math.sign(tx - fx);

    if ((dy !== 0 || dx !== 0) && (dy === 0 || dx === 0 || Math.abs(dy) === Math.abs(dx))) {
      let cy = fy;
      let cx = fx;
      while (cy !== ty || cx !== tx) {
        pathCells.push({ x: cx, y: cy });
        cy += dy;
        cx += dx;
      }
      pathCells.push({ x: tx, y: ty });
    } else {
      pathCells.push({ x: fx, y: fy });
    }

    let placedCount = 0;
    for (const pos of pathCells) {
      if (pos.x >= 0 && pos.x < 9 && pos.y >= 0 && pos.y < 9) {
        const existing = BoardManager.getPiece(board, pos);
        if (existing === null) {
          const hazardPiece: Piece = {
            id: generateId(),
            word: '炎上',
            effect_name: '残り火',
            mechanics_type: 'STEALTH_TRAP',
            ability_genre: '支援・強化',
            trigger: 'ON_APPROACH',
            cool_down_turns: 0,
            range_geometry: {
              normal_grid: '0000000000002000000000000',
              charging_grid: '0000000000002000000000000',
              promoted_grid: '0000000000002000000000000'
            },
            description: '侵入した敵駒を爆破消滅させる炎上トラップ。2ターン経過で自然消滅する。',
            spawn_piece_name: null,
            promoted_effect: {
              effect_name: '炎上・醒',
              description: '燃え盛る炎上。'
            },
            deep_search_analysis: '',
            owner: context.player,
            isKing: false,
            isPawn: false,
            originalPosition: [pos.y, pos.x],
            coolDownTurnsRemaining: 0,
            isRevealed: true,
            isPromoted: false,
            type: 'hazard',
            duration: 2,
            isHazard: true,
            custom_ability: {
              ability_name: '残り火',
              flavor_text: '進入した敵を燃やし尽くす。',
              triggers: ['ON_TAKEN', 'ON_APPROACH'],
              targets: ['POINT'],
              actions: ['DESTROY'],
              constraints: [],
              remaining_uses: 1
            }
          };
          BoardManager.setPiece(board, pos, hazardPiece);
          placedCount++;
        }
      }
    }

    if (placedCount > 0) {
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】炎の足跡！移動経路の空きマス ${placedCount} 箇所に炎上トラップを設置しました！`,
        type: 'ability'
      });
    }
    return;
  }

  const isTilePlacementAction = ['SET_TILE_FIRE', 'SET_TILE_POISON', 'SET_TILE_ICE', 'SET_TILE_BOMB', 'SET_TILE_TRAP'].includes(actionKey);
  const isSelfMechanicAction = ['EVOLUTION_CHECK', 'CHARGE_TURN', 'SACRIFICE_COST', 'SELF_STUN', 'DELAYED_BURST'].includes(actionKey);
  if (!isTilePlacementAction && !isSelfMechanicAction && !victim) return;

  const isMutualDamage = context.ability?.constraints?.includes('MUTUAL_DAMAGE') || context.constraints?.includes('MUTUAL_DAMAGE');
  const isBuffAction = actionKey === 'SHIELD_GAIN' || actionKey === 'STEALTH_ON' || actionKey === 'CLEAR_DEBUFF' || actionKey === 'GUARD_STANCE' || actionKey === 'OVERDRIVE_BOOST';

  const isSystemAction = ['RE_ACTION', 'STEAL_HAND', 'AUTO_FOLLOW_UP', 'TIME_REWIND', 'BOOMERANG', 'GRAVITY_PULL', 'EVOLUTION', 'EVOLUTION_CHECK', 'MIND_CONTROL', 'POS_SWAP_ENEMY', 'GUARD_STANCE', 'CLEAVE_LINE', 'VAULT_EXECUTE', 'OVERDRIVE_BOOST', 'CHARGE_TURN', 'SACRIFICE_COST', 'SELF_STUN', 'DELAYED_BURST', 'SET_TILE_FIRE', 'SET_TILE_POISON', 'SET_TILE_ICE', 'SET_TILE_BOMB', 'SET_TILE_TRAP'].includes(actionKey);
  if (!isBuffAction && !isSystemAction) {
    if (victim && !isMutualDamage && victim.owner === context.player) {
      return;
    }
    if (context.ability?.targets?.includes('LINE_STRAIGHT') || context.ability?.area_shape === 'LINE_STRAIGHT') {
      if (victim && !isMutualDamage && (victim.owner === context.player || victim.isKing)) {
        return;
      }
    }
  } else if (isBuffAction) {
    if (victim && victim.owner !== context.player) {
      return;
    }
  }

  const isOffensive = ['DESTROY', 'CAPTURE', 'FREEZE', 'KNOCKBACK', 'KNOCKBACK_MAX', 'PULL_1'].includes(actionKey);
  if (isOffensive && victim && victim.hasShield) {
    BoardManager.setPiece(board, targetPos, { ...victim, hasShield: false });
    context.triggeredRef.value = true;
    context.logs.push({
      player: context.player,
      message: `【聖盾発動】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) の聖盾（バリア）が効果を防ぎました！`,
      type: 'ability'
    });
    return;
  }

  if (['SET_TILE_FIRE', 'SET_TILE_POISON', 'SET_TILE_ICE', 'SET_TILE_BOMB', 'SET_TILE_TRAP'].includes(actionKey)) {
    const tileType = actionKey.replace('SET_TILE_', '') as TileEffectType;
    let tileBoard = (context as any).tileBoard;
    if (!tileBoard) {
      tileBoard = createEmptyTileBoard();
      (context as any).tileBoard = tileBoard;
    }
    tileBoard[targetPos.y][targetPos.x] = {
      effectType: tileType,
      duration: 3,
      ownerPlayer: context.player,
      isStealth: tileType === 'STEALTH_TRAP'
    };
    context.triggeredRef.value = true;
    context.logs.push({
      player: context.player,
      message: `【${context.effectName}】マス目設置！${getCellLabel(targetPos.y, targetPos.x)} に地形効果 [${tileType}] を付与しました！`,
      type: 'ability'
    });
    return;
  }

  if (actionKey === 'DELAYED_BURST') {
    const actingP = BoardManager.getPiece(board, context.currentActingPos);
    if (actingP) {
      BoardManager.setPiece(board, context.currentActingPos, { ...actingP, coolDownTurnsRemaining: 2 });
    }
    context.triggeredRef.value = true;
    context.logs.push({
      player: context.player,
      message: `【${context.effectName}】遅延発動チャージ！1ターン後に大爆発が起動します！`,
      type: 'ability'
    });
    return;
  }

  if (actionKey === 'CHARGE_TURN') {
    const actingP = BoardManager.getPiece(board, context.currentActingPos);
    if (actingP) {
      BoardManager.setPiece(board, context.currentActingPos, { ...actingP, coolDownTurnsRemaining: 1 });
    }
    context.triggeredRef.value = true;
    context.logs.push({
      player: context.player,
      message: `【${context.effectName}】溜め動作完了！強力能力の準備を整えました！`,
      type: 'ability'
    });
    return;
  }

  if (actionKey === 'SACRIFICE_COST') {
    const hands = context.capturedPieces;
    if (hands && hands.length > 0) {
      const sacrificed = hands.pop();
      if (context.graveyard && sacrificed) context.graveyard.push(sacrificed);
      context.logs.push({
        player: context.player,
        message: `【代償支払い】生贄として持ち駒 ${sacrificed?.word || '駒'} を1体消費しました。`,
        type: 'ability'
      });
    } else {
      const actingP = BoardManager.getPiece(board, context.currentActingPos);
      if (actingP) {
        BoardManager.setPiece(board, context.currentActingPos, { ...actingP, stunTurnsRemaining: 1 });
      }
      context.logs.push({
        player: context.player,
        message: `【代償反動】持ち駒が不足しているため、代償として自身が1手番麻痺しました！`,
        type: 'ability'
      });
    }
    context.triggeredRef.value = true;
    return;
  }

  if (actionKey === 'SELF_STUN') {
    const actingP = BoardManager.getPiece(board, context.currentActingPos);
    if (actingP) {
      BoardManager.setPiece(board, context.currentActingPos, { ...actingP, stunTurnsRemaining: 1 });
    }
    context.triggeredRef.value = true;
    context.logs.push({
      player: context.player,
      message: `【諸刃の反動】強力能力の反動で自身が1手番麻痺しました！`,
      type: 'ability'
    });
    return;
  }

  if (actionKey === 'EVOLUTION_CHECK') {
    if (context.triggeredRef) context.triggeredRef.value = true;
    if (context.piece) context.piece.isPromoted = true;
    const targetCoord = context.currentActingPos || targetPos;
    const actingP = BoardManager.getPiece(board, targetCoord) || BoardManager.getPiece(board, targetPos) || context.piece;
    if (actingP) {
      actingP.isPromoted = true;
      const promotedP = { ...actingP, isPromoted: true };
      if (targetCoord) BoardManager.setPiece(board, targetCoord, promotedP);
      if (targetPos) BoardManager.setPiece(board, targetPos, promotedP);
    }
    context.logs.push({
      player: context.player,
      message: `【条件達成・覚醒昇格】${actingP?.word || '駒'} が条件を満たし、覚醒姿へ進化を遂げました！`,
      type: 'ability'
    });
    return;
  }

  if (!victim) return;

  switch (actionKey) {
    case 'DESTROY': {
      if (victim.isKing) return;
      context.graveyard.push({
        ...victim,
        owner: victim.owner,
        isPromoted: false,
        isRevealed: true,
        isStealth: false,
        coolDownTurnsRemaining: 0,
        stunTurnsRemaining: 0,
        deathCountdown: 0
      });
      BoardManager.setPiece(board, targetPos, null);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】${context.piece.word} の効果により ${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) が消滅（墓地送り）しました！`,
        type: 'system'
      });
      triggerShareFate(board, victim, context.logs, context.graveyard);
      triggerOnDeathEffect(victim, targetPos, board, context);
      break;
    }

    case 'CAPTURE': {
      if (victim.isKing) return;
      if (victim.type !== 'wall' && victim.type !== 'hazard') {
        context.capturedPieces.push({
          ...victim,
          owner: context.player,
          isPromoted: false,
          isRevealed: true,
          isStealth: false,
          coolDownTurnsRemaining: 0
        });
      }
      BoardManager.setPiece(board, targetPos, null);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】${context.piece.word} の効果により ${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を捕獲しました！`,
        type: 'capture'
      });
      triggerShareFate(board, victim, context.logs, context.graveyard);
      triggerOnDeathEffect(victim, targetPos, board, context);
      break;
    }

    case 'FORCE_CAPTURE': {
      if (victim.isKing) return;
      if (victim.type !== 'wall' && victim.type !== 'hazard') {
        context.capturedPieces.push({
          ...victim,
          owner: context.player,
          isPromoted: false,
          isRevealed: true,
          isStealth: false,
          coolDownTurnsRemaining: 0
        });
      }
      BoardManager.setPiece(board, targetPos, null);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】強制捕獲！${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を奪い、持ち駒に加えました！`,
        type: 'capture'
      });
      triggerShareFate(board, victim, context.logs, context.graveyard);
      triggerOnDeathEffect(victim, targetPos, board, context);
      break;
    }

    case 'TRANSFORM_PAWN': {
      if (victim.isKing) return;
      const degraded = degradeToNormalPawn(victim);
      BoardManager.setPiece(board, targetPos, degraded);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】歩兵化！${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) をただの歩兵に弱体化させました！`,
        type: 'ability'
      });
      break;
    }

    case 'STEAL_HAND': {
      if (context.triggeredRef.value) return;
      const opponentCaptured = context.opponentCapturedPieces;
      if (opponentCaptured && opponentCaptured.length > 0) {
        const idx = Math.floor(Math.random() * opponentCaptured.length);
        const [stolenPiece] = opponentCaptured.splice(idx, 1);
        stolenPiece.owner = context.player;
        stolenPiece.isPromoted = false;
        stolenPiece.coolDownTurnsRemaining = 0;
        stolenPiece.isStealth = false;
        context.capturedPieces.push(stolenPiece);
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】手駒強奪！敵の持ち駒から「${stolenPiece.word}」をランダムに強奪し、自軍の持ち駒に加えました！`,
          type: 'capture'
        });
      }
      break;
    }

    case 'SHARE_FATE': {
      if (context.triggeredRef.value) return;
      context.piece.linkedPieceId = victim.id;
      victim.linkedPieceId = context.piece.id;
      
      BoardManager.setPiece(board, context.to, context.piece);
      BoardManager.setPiece(board, targetPos, victim);
      
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】因果応報！${context.piece.word} と ${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) の運命が共有されました！`,
        type: 'ability'
      });
      break;
    }

    case 'FREEZE': {
      BoardManager.setPiece(board, targetPos, {
        ...victim,
        isFrozen: true,
        frozenDuration: 1,
        stunTurnsRemaining: 2
      });
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を凍結（行動封印）しました！`,
        type: 'ability'
      });
      break;
    }

    case 'KNOCKBACK': {
      let kdy = 0, kdx = 0;
      if (context.from) {
        kdy = Math.sign(to.y - context.from.y);
        kdx = Math.sign(to.x - context.from.x);
      }
      if (kdy === 0 && kdx === 0) {
        kdy = Math.sign(targetPos.y - to.y);
        kdx = Math.sign(targetPos.x - to.x);
      }
      if (kdy === 0 && kdx === 0) kdy = context.player === 'sente' ? -1 : 1;

      const ny = targetPos.y + kdy;
      const nx = targetPos.x + kdx;
      const pushPos = { x: nx, y: ny };

      if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) {
        context.graveyard.push({
          ...victim,
          owner: victim.owner,
          isPromoted: false,
          isRevealed: true,
          isStealth: false,
          coolDownTurnsRemaining: 0,
          stunTurnsRemaining: 0,
          deathCountdown: 0
        });
        BoardManager.setPiece(board, targetPos, null);
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) はノックバックにより盤外へ押し出され、消滅しました！`,
          type: 'capture'
        });
        triggerOnDeathEffect(victim, targetPos, board, context);
      } else {
        const currentPieceAtDest = BoardManager.getPiece(board, pushPos);
        const isDestinationSelf = (nx === context.currentActingPos.x && ny === context.currentActingPos.y);
        if (currentPieceAtDest === null && !isDestinationSelf) {
          BoardManager.setPiece(board, pushPos, {
            ...victim,
            originalPosition: [ny, nx]
          });
          BoardManager.setPiece(board, targetPos, null);
          context.triggeredRef.value = true;
          context.logs.push({
            player: context.player,
            message: `【${context.effectName}】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) をノックバックで ${getCellLabel(ny, nx)} に押し戻しました！`,
            type: 'ability'
          });
        } else {
          context.logs.push({
            player: context.player,
            message: `【${context.effectName}】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) は障害物があるためノックバックできませんでした。`,
            type: 'system'
          });
        }
      }
      break;
    }

    case 'KNOCKBACK_MAX': {
      let kdy = Math.sign(targetPos.y - context.currentActingPos.y);
      let kdx = Math.sign(targetPos.x - context.currentActingPos.x);
      if (kdy === 0 && kdx === 0 && context.from) {
        kdy = Math.sign(to.y - context.from.y);
        kdx = Math.sign(to.x - context.from.x);
      }
      if (kdy === 0 && kdx === 0) kdy = context.player === 'sente' ? -1 : 1;

      let ny = targetPos.y + kdy;
      let nx = targetPos.x + kdx;
      let lastValidY = targetPos.y;
      let lastValidX = targetPos.x;
      let ejected = false;

      while (ny >= 0 && ny < 9 && nx >= 0 && nx < 9) {
        const cell = BoardManager.getPiece(board, { x: nx, y: ny });
        if (cell !== null) break;
        lastValidY = ny;
        lastValidX = nx;
        ny += kdy;
        nx += kdx;
      }

      if (lastValidY === targetPos.y && lastValidX === targetPos.x) {
        const firstY = targetPos.y + kdy;
        const firstX = targetPos.x + kdx;
        if (firstX < 0 || firstX >= 9 || firstY < 0 || firstY >= 9) {
          ejected = true;
        } else {
          return;
        }
      }

      if (ejected) {
        context.graveyard.push({
          ...victim,
          isPromoted: false,
          isRevealed: true,
          isStealth: false,
          coolDownTurnsRemaining: 0,
          stunTurnsRemaining: 0,
          deathCountdown: 0
        });
        BoardManager.setPiece(board, targetPos, null);
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) は極大吹き飛ばしにより盤外へ消滅しました！`,
          type: 'capture'
        });
        triggerOnDeathEffect(victim, targetPos, board, context);
      } else {
        BoardManager.setPiece(board, { x: lastValidX, y: lastValidY }, { ...victim, originalPosition: [lastValidY, lastValidX] });
        BoardManager.setPiece(board, targetPos, null);
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を ${getCellLabel(lastValidY, lastValidX)} まで極大吹き飛ばししました！`,
          type: 'ability'
        });
      }
      break;
    }

    case 'SWAP_POSITION': {
      if (context.triggeredRef.value) return;
      if (victim.isKing) return;
      const actingPiece = BoardManager.getPiece(board, context.currentActingPos);
      if (!actingPiece) return;

      BoardManager.setPiece(board, targetPos, { ...actingPiece, originalPosition: [targetPos.y, targetPos.x] });
      BoardManager.setPiece(board, context.currentActingPos, { ...victim, originalPosition: [context.currentActingPos.y, context.currentActingPos.x] });
      context.currentActingPos = targetPos;
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】${actingPiece.word} と ${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) が位置を交換しました！`,
        type: 'ability'
      });
      break;
    }

    case 'PULL_1': {
      const dy = Math.sign(context.currentActingPos.y - targetPos.y);
      const dx = Math.sign(context.currentActingPos.x - targetPos.x);
      if (dy === 0 && dx === 0) return;

      const ny = targetPos.y + dy;
      const nx = targetPos.x + dx;
      if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) return;

      const destPos = { x: nx, y: ny };
      const destPiece = BoardManager.getPiece(board, destPos);
      const isActingSquare = (nx === context.currentActingPos.x && ny === context.currentActingPos.y);
      if (destPiece !== null || isActingSquare) return;

      BoardManager.setPiece(board, destPos, { ...victim, originalPosition: [ny, nx] });
      BoardManager.setPiece(board, targetPos, null);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】引き寄せにより ${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を ${getCellLabel(ny, nx)} へ引き寄せました！`,
        type: 'ability'
      });
      break;
    }

    case 'AUTO_FOLLOW_UP': {
      if (context.triggeredRef.value) return;
      const currentActingPos = context.currentActingPos;
      const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];

      for (const d of dirs) {
        const scanPos = { x: currentActingPos.x + d.dx, y: currentActingPos.y + d.dy };
        const neighbor = BoardManager.getPiece(board, scanPos);
        if (neighbor && neighbor.owner !== context.player) {
          const cap = {
            ...neighbor,
            owner: context.player,
            isPromoted: false,
            isRevealed: true,
            isStealth: false,
            coolDownTurnsRemaining: 0
          };
          context.capturedPieces.push(cap);

          const actingPiece = BoardManager.getPiece(board, currentActingPos);
          if (actingPiece) {
            BoardManager.setPiece(board, scanPos, actingPiece);
            BoardManager.setPiece(board, currentActingPos, null);
            context.logs.push({
              player: context.player,
              message: `【自動追撃】${actingPiece.word} は ${getCellLabel(scanPos.y, scanPos.x)} にいる敵の ${neighbor.word} を感知し、突進して捕獲しました！`,
              type: 'ability'
            });
            context.triggeredRef.value = true;
            context.currentActingPos = scanPos;
          }
          triggerOnDeathEffect(neighbor, scanPos, board, context);
          break;
        }
      }
      break;
    }

    case 'STEALTH_ON': {
      BoardManager.setPiece(board, targetPos, {
        ...victim,
        isStealth: true,
        isRevealed: false
      });
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) が潜伏（ステルス）状態に入りました！`,
        type: 'ability'
      });
      break;
    }

    case 'SHIELD_GAIN': {
      BoardManager.setPiece(board, targetPos, {
        ...victim,
        hasShield: true
      });
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) に聖盾（バリア）が付与されました！`,
        type: 'ability'
      });
      break;
    }

    case 'INVERT_DIR': {
      BoardManager.setPiece(board, targetPos, {
        ...victim,
        isInverted: true
      });
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) の移動方向が反転されました！`,
        type: 'ability'
      });
      break;
    }

    case 'TIME_REWIND': {
      if (victim.isKing) return;
      if (victim.previousPosition && typeof victim.previousPosition.x === 'number' && typeof victim.previousPosition.y === 'number') {
        const prevPos = victim.previousPosition;
        const pieceAtPrev = BoardManager.getPiece(board, prevPos);
        if (pieceAtPrev === null) {
          BoardManager.setPiece(board, prevPos, {
            ...victim,
            previousPosition: undefined
          });
          BoardManager.setPiece(board, targetPos, null);
          context.triggeredRef.value = true;
          context.logs.push({
            player: context.player,
            message: `【${context.effectName}】時間逆行！${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を前ターンの位置 ${getCellLabel(prevPos.y, prevPos.x)} へ巻き戻しました！`,
            type: 'ability'
          });
        } else {
          context.logs.push({
            player: context.player,
            message: `【${context.effectName}】${victim.word} の時間逆行に失敗：巻き戻し先の位置 ${getCellLabel(prevPos.y, prevPos.x)} に他の駒が存在します。`,
            type: 'system'
          });
        }
      } else {
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】${victim.word} の時間逆行に失敗：前ターンの位置情報が存在しません。`,
          type: 'system'
        });
      }
      break;
    }

    case 'BOOMERANG': {
      if (context.triggeredRef.value) return;
      const fromPos = context.from;
      const currentPos = context.currentActingPos;
      if (fromPos.x === currentPos.x && fromPos.y === currentPos.y) {
        return;
      }
      const pieceAtFrom = BoardManager.getPiece(board, fromPos);
      if (pieceAtFrom === null) {
        const actingPiece = BoardManager.getPiece(board, currentPos);
        if (actingPiece) {
          BoardManager.setPiece(board, fromPos, {
            ...actingPiece,
            originalPosition: [fromPos.y, fromPos.x]
          });
          BoardManager.setPiece(board, currentPos, null);
          context.currentActingPos = fromPos;
          context.triggeredRef.value = true;
          context.logs.push({
            player: context.player,
            message: `【${context.effectName}】帰還（ブーメラン）！${actingPiece.word} が移動前の位置 ${getCellLabel(fromPos.y, fromPos.x)} へ引き戻されました！`,
            type: 'ability'
          });
        }
      } else {
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】帰還（ブーメラン）失敗：元の位置に他の駒が存在します。`,
          type: 'system'
        });
      }
      break;
    }

    case 'GRAVITY_PULL': {
      if (context.triggeredRef.value) return;
      const center = context.to;
      let pulledCount = 0;

      interface EnemyPullInfo {
        piece: Piece;
        pos: Position;
        dist: number;
        dx: number;
        dy: number;
      }
      const enemies: EnemyPullInfo[] = [];
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const p = board[r][c];
          if (p && p.owner !== context.player && !p.isKing) {
            const dy = Math.sign(center.y - r);
            const dx = Math.sign(center.x - c);
            if (dy !== 0 || dx !== 0) {
              const dist = Math.abs(center.y - r) + Math.abs(center.x - c);
              enemies.push({ piece: p, pos: { x: c, y: r }, dist, dx, dy });
            }
          }
        }
      }

      enemies.sort((a, b) => a.dist - b.dist);

      for (const enemy of enemies) {
        const ny = enemy.pos.y + enemy.dy;
        const nx = enemy.pos.x + enemy.dx;
        const destPos = { x: nx, y: ny };
        if (nx >= 0 && nx < 9 && ny >= 0 && ny < 9) {
          const destPiece = BoardManager.getPiece(board, destPos);
          const isActingSquare = (nx === context.to.x && ny === context.to.y);
          if (destPiece === null && !isActingSquare) {
            BoardManager.setPiece(board, destPos, {
              ...enemy.piece,
              originalPosition: [ny, nx]
            });
            BoardManager.setPiece(board, enemy.pos, null);
            pulledCount++;
          }
        }
      }

      if (pulledCount > 0) {
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】重力吸引！盤上の敵駒 ${pulledCount} 体を引き寄せました！`,
          type: 'ability'
        });
      }
      break;
    }

    case 'EVOLUTION': {
      const actingPiece = BoardManager.getPiece(board, context.currentActingPos);
      if (actingPiece) {
        const currentLevel = actingPiece.level !== undefined ? actingPiece.level : 1;
        const nextLevel = currentLevel + 1;
        const updatedPiece = {
          ...actingPiece,
          level: nextLevel
        };
        if (nextLevel === 2) {
          updatedPiece.word = actingPiece.word + '★';
          updatedPiece.range_geometry = {
            ...actingPiece.range_geometry,
            normal_grid: '0000001110002000101000000'
          };
          if (updatedPiece.promoted_effect) {
            updatedPiece.promoted_effect = {
              ...updatedPiece.promoted_effect,
              ability_spec: updatedPiece.promoted_effect.ability_spec ? {
                ...updatedPiece.promoted_effect.ability_spec,
                range: updatedPiece.promoted_effect.ability_spec.range + 1
              } : undefined
            } as any;
          }
        } else if (nextLevel === 3) {
          updatedPiece.word = actingPiece.word.replace('★', '') + '★★';
          updatedPiece.logic_code = 'move_like_rook';
          updatedPiece.range_geometry = {
            ...actingPiece.range_geometry,
            normal_grid: '0010000100112110010000100'
          };
        }
        BoardManager.setPiece(board, context.currentActingPos, updatedPiece);
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】大器晩成！${actingPiece.word} が Level ${nextLevel} (${nextLevel === 2 ? '銀将相当' : '飛車相当の全方向滑空'}) に進化しました！`,
          type: 'ability'
        });
      }
      break;
    }

    case 'MIND_CONTROL': {
      if (context.triggeredRef.value) return;
      if (victim.isKing) return;
      
      victim.isMindControlled = true;
      victim.originalPlayer = victim.owner;
      victim.owner = context.player;
      victim.isStealth = false;
      
      BoardManager.setPiece(board, targetPos, victim);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】精神支配！敵の ${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を洗脳し、一時的に支配下に置きました！`,
        type: 'ability'
      });
      break;
    }

    case 'CLEAR_DEBUFF': {
      victim.isFrozen = false;
      victim.frozenDuration = 0;
      victim.stunTurnsRemaining = 0;
      victim.isInverted = false;
      victim.deathCountdown = 0;
      victim.isRevealed = true;
      
      if (victim.isMindControlled && victim.originalPlayer) {
        victim.owner = victim.originalPlayer;
        victim.isMindControlled = false;
        victim.originalPlayer = undefined;
      }
      
      BoardManager.setPiece(board, targetPos, victim);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】浄化！${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) のすべての弱体化・状態異常が解除されました！`,
        type: 'ability'
      });
      break;
    }

    case 'MAGNET_PULL': {
      if (victim.isKing) return;
      const dy = Math.sign(context.to.y - targetPos.y);
      const dx = Math.sign(context.to.x - targetPos.x);
      const pullToY = targetPos.y + dy;
      const pullToX = targetPos.x + dx;
      if (isWithinBounds(pullToY, pullToX)) {
        const occupant = BoardManager.getPiece(board, { x: pullToX, y: pullToY });
        if (occupant === null) {
          BoardManager.setPiece(board, { x: pullToX, y: pullToY }, victim);
          BoardManager.setPiece(board, targetPos, null);
          context.triggeredRef.value = true;
          context.logs.push({
            player: context.player,
            message: `【${context.effectName}】引力！${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を手前へ1マス引き寄せました！`,
            type: 'ability'
          });
        }
      }
      break;
    }

    case 'KNOCKBACK_BUMP': {
      if (victim.isKing) return;
      const dy = Math.sign(targetPos.y - context.to.y);
      const dx = Math.sign(targetPos.x - context.to.x);
      const pushToY = targetPos.y + dy;
      const pushToX = targetPos.x + dx;
      if (isWithinBounds(pushToY, pushToX)) {
        const occupant = BoardManager.getPiece(board, { x: pushToX, y: pushToY });
        if (occupant === null) {
          BoardManager.setPiece(board, { x: pushToX, y: pushToY }, victim);
          BoardManager.setPiece(board, targetPos, null);
          context.triggeredRef.value = true;
          context.logs.push({
            player: context.player,
            message: `【${context.effectName}】体当たり！${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を1マス弾き飛ばしました！`,
            type: 'ability'
          });
        } else {
          BoardManager.setPiece(board, targetPos, null);
          context.graveyard.push({
            ...victim,
            isPromoted: false,
            coolDownTurnsRemaining: 0,
            isRevealed: true
          });
          triggerShareFate(board, victim, context.logs, context.graveyard);
          context.triggeredRef.value = true;
          context.logs.push({
            player: context.player,
            message: `【激突消滅】体当たり！${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) は押し出された先の駒と激突し、粉砕・消滅しました！`,
            type: 'ability'
          });
        }
      } else {
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【体当たり】${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) は盤外に吹き飛ばされそうになりましたが、壁に防がれました。`,
          type: 'ability'
        });
      }
      break;
    }

    case 'POS_SWAP_ENEMY': {
      if (context.triggeredRef.value) return;
      if (victim.isKing) return;
      
      const actingPiece = BoardManager.getPiece(board, context.currentActingPos);
      if (actingPiece) {
        if (actingPiece.isKing) return;
        BoardManager.setPiece(board, targetPos, actingPiece);
        BoardManager.setPiece(board, context.currentActingPos, victim);
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】位置交換！${actingPiece.word} (${getCellLabel(context.currentActingPos.y, context.currentActingPos.x)}) と敵の ${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) の座標を入れ替えました！`,
          type: 'ability'
        });
      }
      break;
    }

    case 'STUN_LOCK': {
      if (victim.isKing) return;
      victim.isFrozen = true;
      victim.frozenDuration = 1;
      BoardManager.setPiece(board, targetPos, victim);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】麻痺！${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を1手番の間、行動封印（スタン）しました！`,
        type: 'ability'
      });
      break;
    }

    case 'PENETRATE_STRIKE': {
      if (victim.isKing) return;
      // Destroy target directly, ignoring any pieces in between
      context.graveyard.push({
        ...victim,
        isPromoted: false,
        coolDownTurnsRemaining: 0,
        isRevealed: true
      });
      triggerShareFate(board, victim, context.logs, context.graveyard);
      BoardManager.setPiece(board, targetPos, null);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】貫通狙撃！あらゆる駒を貫いて ${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を直接消滅させました！`,
        type: 'ability'
      });
      break;
    }

    case 'VAULT_EXECUTE': {
      if (victim.isKing) return;
      // Jump over the target to the cell behind it, then destroy it
      const dy = Math.sign(targetPos.y - context.to.y);
      const dx = Math.sign(targetPos.x - context.to.x);
      const landY = targetPos.y + dy;
      const landX = targetPos.x + dx;
      if (!isWithinBounds(landY, landX)) break;
      const landOccupant = BoardManager.getPiece(board, { x: landX, y: landY });
      if (landOccupant !== null) break;
      // Relocate acting piece to the landing cell
      const actingPieceVE = BoardManager.getPiece(board, context.currentActingPos);
      if (!actingPieceVE) break;
      BoardManager.setPiece(board, { x: landX, y: landY }, actingPieceVE);
      BoardManager.setPiece(board, context.currentActingPos, null);
      // Destroy the vaulted-over enemy
      context.graveyard.push({
        ...victim,
        isPromoted: false,
        coolDownTurnsRemaining: 0,
        isRevealed: true
      });
      triggerShareFate(board, victim, context.logs, context.graveyard);
      BoardManager.setPiece(board, targetPos, null);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】跳躍撃破！${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を飛び越えながら撃破し、${getCellLabel(landY, landX)} へ着地！`,
        type: 'ability'
      });
      break;
    }

    case 'CLEAVE_LINE': {
      // Cleave the 3 vertical cells centered on the acting piece (self, +1, -1 rows)
      const actingPos = context.currentActingPos;
      const cleaveDirs = [-1, 0, 1];
      let cleaveCount = 0;
      for (const dRow of cleaveDirs) {
        const cellY = actingPos.y + dRow;
        const cellX = actingPos.x;
        if (!isWithinBounds(cellY, cellX)) continue;
        const target = BoardManager.getPiece(board, { x: cellX, y: cellY });
        if (target && target.owner !== context.player && !target.isKing) {
          context.graveyard.push({
            ...target,
            isPromoted: false,
            coolDownTurnsRemaining: 0,
            isRevealed: true
          });
          triggerShareFate(board, target, context.logs, context.graveyard);
          BoardManager.setPiece(board, { x: cellX, y: cellY }, null);
          cleaveCount++;
        }
      }
      if (cleaveCount > 0) {
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】縦ライン一掃！${getCellLabel(actingPos.y, actingPos.x)} を軸に縦3マスを薙ぎ払い、${cleaveCount}体の敵駒を消滅させました！`,
          type: 'ability'
        });
      }
      break;
    }

    case 'GUARD_STANCE': {
      // Grant absolute guard shield to the target piece (self or ally)
      const guardTarget = BoardManager.getPiece(board, targetPos);
      if (!guardTarget) break;
      BoardManager.setPiece(board, targetPos, {
        ...guardTarget,
        hasAbsoluteGuard: true,
        guardDuration: 1
      });
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】絶対防護！${guardTarget.word} (${getCellLabel(targetPos.y, targetPos.x)}) に1ターン限定の鉄壁シールドを付与しました！`,
        type: 'ability'
      });
      break;
    }

    case 'SILENCE_SEAL': {
      if (victim.isKing) return;
      victim.isSilenced = true;
      victim.silenceDuration = 1;
      BoardManager.setPiece(board, targetPos, victim);
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】能力封印！${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) の特殊能力と移動を1ターン完全に封印しました！`,
        type: 'ability'
      });
      break;
    }

    case 'OVERDRIVE_BOOST': {
      // Grant overdrive to the acting piece + schedule 1-turn freeze after
      const actingPieceOD = BoardManager.getPiece(board, context.currentActingPos);
      if (!actingPieceOD) break;
      BoardManager.setPiece(board, context.currentActingPos, {
        ...actingPieceOD,
        isOverdrive: true,
        isFrozen: true,
        frozenDuration: 1
      });
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】限界突破！${actingPieceOD.word} がオーバードライブ状態に突入！今ターンは移動範囲2倍、だが次の手番は反動で行動不可になります！`,
        type: 'ability'
      });
      break;
    }

    case 'PROBABILITY_STRIKE': {
      if (victim.isKing) return;
      const successRate = (context as any).successRate !== undefined ? (context as any).successRate : 0.5;
      const isSuccess = Math.random() < successRate;
      if (isSuccess) {
        applyCoreActionEffect('DESTROY', targetPos, board, to, context);
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】確率撃破成功！(確率: ${Math.round(successRate * 100)}%) ${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を一撃粉砕しました！`,
          type: 'ability'
        });
      } else {
        const actingPiece = BoardManager.getPiece(board, context.currentActingPos);
        if (actingPiece) {
          BoardManager.setPiece(board, context.currentActingPos, {
            ...actingPiece,
            stunTurnsRemaining: 1
          });
        }
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】確率撃破失敗…！ (確率: ${Math.round(successRate * 100)}%) 攻撃がミスとなり、反動で1手番麻痺しました！`,
          type: 'ability'
        });
      }
      break;
    }

    case 'CHAOS_GAMBLE': {
      if (victim.isKing) return;
      const isLucky = Math.random() < 0.5;
      if (isLucky) {
        applyCoreActionEffect('FORCE_CAPTURE', targetPos, board, to, context);
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】運命のコイン: 表！(大成功) ${victim.word} (${getCellLabel(targetPos.y, targetPos.x)}) を奪取し、持ち駒化しました！`,
          type: 'ability'
        });
      } else {
        const actingPiece = BoardManager.getPiece(board, context.currentActingPos);
        if (actingPiece) {
          BoardManager.setPiece(board, context.currentActingPos, {
            ...actingPiece,
            isFrozen: true,
            frozenDuration: 1
          });
        }
        context.triggeredRef.value = true;
        context.logs.push({
          player: context.player,
          message: `【${context.effectName}】運命のコイン: 裏…！(失敗) カオスバウンドの反動で自身が1手番凍結しました！`,
          type: 'ability'
        });
      }
      break;
    }

    case 'LUCKY_DODGE': {
      const targetPiece = BoardManager.getPiece(board, targetPos);
      if (!targetPiece) break;
      const dodgeRate = (context as any).successRate !== undefined ? (context as any).successRate : 0.3;
      BoardManager.setPiece(board, targetPos, {
        ...targetPiece,
        hasAbsoluteGuard: Math.random() < dodgeRate,
        guardDuration: 1
      });
      context.triggeredRef.value = true;
      context.logs.push({
        player: context.player,
        message: `【${context.effectName}】見切り・回避展開！${targetPiece.word} (${getCellLabel(targetPos.y, targetPos.x)}) に直感回避を展開しました！`,
        type: 'ability'
      });
      break;
    }

  }
}

/**
 * 複合アクション安全パイプライン用ヘルパー:
 * 指定IDを持つ駒を盤面から検索し、現在の座標と一緒に返す。
 * 移動・入れ替え系アクション後の再評価（Re-evaluation）に使用する。
 */
export function getPieceById(board: Board, pieceId: string): { piece: Piece; pos: Position } | null {
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const p = board[r][c];
      if (p && p.id === pieceId) {
        return { piece: p, pos: { x: c, y: r } };
      }
    }
  }
  return null;
}

/**
 * 複合アクション安全パイプライン用ヘルパー:
 * そのアクション種別が「対象駒が盤面に存在すること」を必要とするかを判定する。
 * DESTROY/CAPTURE 後に後続アクションがあっても安全にスキップできる。
 */
function isTargetRequiredAction(actionKey: string): boolean {
  const targetFreeActions = ['CLEAVE_LINE', 'OVERDRIVE_BOOST', 'LEAVE_TRAIL_FIRE', 'RE_ACTION', 'BOOMERANG', 'TIME_REWIND', 'PROBABILITY_STRIKE', 'CHAOS_GAMBLE', 'LUCKY_DODGE'];
  return !targetFreeActions.includes(actionKey);
}

export const ActionRegistry: Record<string, ActionFunction> = {
  DESTROY: (targetPos, board, to, context) => applyCoreActionEffect('DESTROY', targetPos, board, to, context),
  FREEZE: (targetPos, board, to, context) => applyCoreActionEffect('FREEZE', targetPos, board, to, context),
  KNOCKBACK: (targetPos, board, to, context) => applyCoreActionEffect('KNOCKBACK', targetPos, board, to, context),
  KNOCKBACK_MAX: (targetPos, board, to, context) => applyCoreActionEffect('KNOCKBACK_MAX', targetPos, board, to, context),
  SWAP_POSITION: (targetPos, board, to, context) => applyCoreActionEffect('SWAP_POSITION', targetPos, board, to, context),
  PULL_1: (targetPos, board, to, context) => applyCoreActionEffect('PULL_1', targetPos, board, to, context),
  RE_ACTION: (targetPos, board, to, context) => applyCoreActionEffect('RE_ACTION', targetPos, board, to, context),
  AUTO_FOLLOW_UP: (targetPos, board, to, context) => applyCoreActionEffect('AUTO_FOLLOW_UP', targetPos, board, to, context),
  STEALTH_ON: (targetPos, board, to, context) => applyCoreActionEffect('STEALTH_ON', targetPos, board, to, context),
  SHIELD_GAIN: (targetPos, board, to, context) => applyCoreActionEffect('SHIELD_GAIN', targetPos, board, to, context),
  SPAWN_TOKEN: (targetPos, board, to, context) => applyCoreActionEffect('SPAWN_TOKEN', targetPos, board, to, context),
  INVERT_DIR: (targetPos, board, to, context) => applyCoreActionEffect('INVERT_DIR', targetPos, board, to, context),
  FORCE_CAPTURE: (targetPos, board, to, context) => applyCoreActionEffect('FORCE_CAPTURE', targetPos, board, to, context),
  TRANSFORM_PAWN: (targetPos, board, to, context) => applyCoreActionEffect('TRANSFORM_PAWN', targetPos, board, to, context),
  STEAL_HAND: (targetPos, board, to, context) => applyCoreActionEffect('STEAL_HAND', targetPos, board, to, context),
  TIME_REWIND: (targetPos, board, to, context) => applyCoreActionEffect('TIME_REWIND', targetPos, board, to, context),
  BOOMERANG: (targetPos, board, to, context) => applyCoreActionEffect('BOOMERANG', targetPos, board, to, context),
  GRAVITY_PULL: (targetPos, board, to, context) => applyCoreActionEffect('GRAVITY_PULL', targetPos, board, to, context),
  SHARE_FATE: (targetPos, board, to, context) => applyCoreActionEffect('SHARE_FATE', targetPos, board, to, context),
  WALL_CREATE: (targetPos, board, to, context) => applyCoreActionEffect('WALL_CREATE', targetPos, board, to, context),
  LEAVE_TRAIL_FIRE: (targetPos, board, to, context) => applyCoreActionEffect('LEAVE_TRAIL_FIRE', targetPos, board, to, context),
  EVOLUTION: (targetPos, board, to, context) => applyCoreActionEffect('EVOLUTION', targetPos, board, to, context),
  MIND_CONTROL: (targetPos, board, to, context) => applyCoreActionEffect('MIND_CONTROL', targetPos, board, to, context),
  CLEAR_DEBUFF: (targetPos, board, to, context) => applyCoreActionEffect('CLEAR_DEBUFF', targetPos, board, to, context),
  MAGNET_PULL: (targetPos, board, to, context) => applyCoreActionEffect('MAGNET_PULL', targetPos, board, to, context),
  KNOCKBACK_BUMP: (targetPos, board, to, context) => applyCoreActionEffect('KNOCKBACK_BUMP', targetPos, board, to, context),
  POS_SWAP_ENEMY: (targetPos, board, to, context) => applyCoreActionEffect('POS_SWAP_ENEMY', targetPos, board, to, context),
  STUN_LOCK: (targetPos, board, to, context) => applyCoreActionEffect('STUN_LOCK', targetPos, board, to, context),
  PENETRATE_STRIKE: (targetPos, board, to, context) => applyCoreActionEffect('PENETRATE_STRIKE', targetPos, board, to, context),
  VAULT_EXECUTE: (targetPos, board, to, context) => applyCoreActionEffect('VAULT_EXECUTE', targetPos, board, to, context),
  CLEAVE_LINE: (targetPos, board, to, context) => applyCoreActionEffect('CLEAVE_LINE', targetPos, board, to, context),
  GUARD_STANCE: (targetPos, board, to, context) => applyCoreActionEffect('GUARD_STANCE', targetPos, board, to, context),
  SILENCE_SEAL: (targetPos, board, to, context) => applyCoreActionEffect('SILENCE_SEAL', targetPos, board, to, context),
  OVERDRIVE_BOOST: (targetPos, board, to, context) => applyCoreActionEffect('OVERDRIVE_BOOST', targetPos, board, to, context),
  PROBABILITY_STRIKE: (targetPos, board, to, context) => applyCoreActionEffect('PROBABILITY_STRIKE', targetPos, board, to, context),
  CHAOS_GAMBLE: (targetPos, board, to, context) => applyCoreActionEffect('CHAOS_GAMBLE', targetPos, board, to, context),
  LUCKY_DODGE: (targetPos, board, to, context) => applyCoreActionEffect('LUCKY_DODGE', targetPos, board, to, context),
  SET_TILE_FIRE: (targetPos, board, to, context) => applyCoreActionEffect('SET_TILE_FIRE', targetPos, board, to, context),
  SET_TILE_POISON: (targetPos, board, to, context) => applyCoreActionEffect('SET_TILE_POISON', targetPos, board, to, context),
  SET_TILE_ICE: (targetPos, board, to, context) => applyCoreActionEffect('SET_TILE_ICE', targetPos, board, to, context),
  SET_TILE_BOMB: (targetPos, board, to, context) => applyCoreActionEffect('SET_TILE_BOMB', targetPos, board, to, context),
  SET_TILE_TRAP: (targetPos, board, to, context) => applyCoreActionEffect('SET_TILE_TRAP', targetPos, board, to, context),
  DELAYED_BURST: (targetPos, board, to, context) => applyCoreActionEffect('DELAYED_BURST', targetPos, board, to, context),
  CHARGE_TURN: (targetPos, board, to, context) => applyCoreActionEffect('CHARGE_TURN', targetPos, board, to, context),
  SACRIFICE_COST: (targetPos, board, to, context) => applyCoreActionEffect('SACRIFICE_COST', targetPos, board, to, context),
  SELF_STUN: (targetPos, board, to, context) => applyCoreActionEffect('SELF_STUN', targetPos, board, to, context),
  EVOLUTION_CHECK: (targetPos, board, to, context) => applyCoreActionEffect('EVOLUTION_CHECK', targetPos, board, to, context)
};

export function filterUniquePositions(positions: Position[]): Position[] {
  const seen = new Set<string>();
  const list: Position[] = [];
  for (const pos of positions) {
    const key = `${pos.x},${pos.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      list.push(pos);
    }
  }
  return list;
}

function applyConstraints(piece: Piece, constraints: string[]): { abilityUsed: boolean; coolDownTurnsRemaining: number } {
  let setCooldown = 0;
  let setOnce = false;
  for (const c of constraints) {
    if (c === 'ONCE') {
      setOnce = true;
    } else if (c.startsWith('COOLDOWN_')) {
      const num = parseInt(c.split('_')[1], 10);
      if (!isNaN(num)) {
        setCooldown = num;
      }
    }
  }
  return {
    abilityUsed: setOnce ? true : !!piece.abilityUsed,
    coolDownTurnsRemaining: setOnce ? 99 : (setCooldown > 0 ? setCooldown : (piece.coolDownTurnsRemaining || 0))
  };
}

export function executeCustomAbility(
  arg1: any,
  arg2: any,
  arg3?: any,
  arg4?: any,
  arg5?: any,
  arg6?: any,
  arg7?: any
): {
  board: Board;
  capturedPieces: Piece[];
  opponentCapturedPieces?: Piece[];
  graveyard: Piece[];
  logs: Omit<GameLog, 'id' | 'timestamp'>[];
  triggered: boolean;
  reAction: boolean;
} {
  let board: Board;
  let to: Position;
  let ability: CustomAbility;
  let player: Player;
  let from: Position;
  let clickedTarget: Position | null = null;
  let piece: Piece | null = null;
  let opponentCapturedPieces: Piece[] | undefined = undefined;

  if (arg1 && typeof arg1 === 'object' && 'word' in arg1) {
    // Signature 1: executeCustomAbility(piece, board, from, to)
    piece = arg1 as Piece;
    board = arg2 as Board;
    from = ensurePosition(arg3);
    to = ensurePosition(arg4);
    ability = piece.custom_ability || (piece as any).ability;
    player = piece.owner;
  } else {
    // Signature 2: executeCustomAbility(board, position, ability, player, fromPosition, targetPosition, opponentCapturedPieces)
    board = arg1 as Board;
    to = ensurePosition(arg2);
    ability = arg3 as CustomAbility;
    player = arg4 as Player;
    from = arg5 ? ensurePosition(arg5) : to;
    if (arg6) {
      clickedTarget = ensurePosition(arg6);
    }
    opponentCapturedPieces = arg7 as Piece[];
    piece = BoardManager.getPiece(board, to);
  }

  if (!piece || !ability) {
    return { board, capturedPieces: [], graveyard: [], logs: [], triggered: false, reAction: false };
  }

  // 1. Constraints Check
  if (piece.abilityUsed || (piece.coolDownTurnsRemaining && piece.coolDownTurnsRemaining > 0)) {
    return { board, capturedPieces: [], graveyard: [], logs: [], triggered: false, reAction: false };
  }

  const nextBoard = board.map(row => [...row]);
  const capturedPieces: Piece[] = [];
  const graveyard: Piece[] = [];
  const logs: Omit<GameLog, 'id' | 'timestamp'>[] = [];
  const triggeredRef = { value: false };
  const effectName = ability.ability_name || piece.effect_name;

  // 2. Select Targets
  let allTargets: Position[] = [];
  const targets = ability.targets || [];
  const hasRange = targets.includes('RANGE_2') || targets.includes('RANGE_3');
  const hasPoint = targets.includes('POINT');

  const origin = (ability.target_mode === 'POINT_CENTERED' && clickedTarget) ? clickedTarget : to;

  if (hasRange && hasPoint && clickedTarget) {
    allTargets = [clickedTarget];
  } else {
    targets.forEach(targetKey => {
      if (TargetRegistry[targetKey]) {
        const cells = TargetRegistry[targetKey](origin, nextBoard, from);
        allTargets = [...allTargets, ...cells];
      }
    });
  }

  const uniqueTargets = filterUniquePositions(allTargets);

  const reActionRef = { value: false };
  const localOpponentCaptured = opponentCapturedPieces ? [...opponentCapturedPieces] : [];

  const context: ActionContext = {
    piece,
    player,
    from,
    to,
    graveyard,
    capturedPieces,
    opponentCapturedPieces: localOpponentCaptured,
    logs,
    triggeredRef,
    reActionRef,
    effectName,
    currentActingPos: to,
    ability
  };

  // 3. Execute Actions — 複合アクション安全パイプライン
  //    actions 配列を順番に実行しながら、ステップごとに:
  //      [Re-eval]   対象駒の現在座標を盤面から再検索（移動系アクション後の座標更新）
  //      [Exist Guard] 対象が消滅・消失済みなら後続アクションを安全スキップ

  const isSingleExecution = (actionKey: string) =>
    ['RE_ACTION', 'STEALTH_ON', 'SHIELD_GAIN', 'SWAP_POSITION', 'AUTO_FOLLOW_UP', 'STEAL_HAND',
      'BOOMERANG', 'GRAVITY_PULL', 'SHARE_FATE', 'LEAVE_TRAIL_FIRE', 'EVOLUTION', 'MIND_CONTROL',
      'MAGNET_PULL', 'KNOCKBACK_BUMP', 'POS_SWAP_ENEMY', 'STUN_LOCK', 'PENETRATE_STRIKE',
      'VAULT_EXECUTE', 'CLEAVE_LINE', 'GUARD_STANCE', 'SILENCE_SEAL', 'OVERDRIVE_BOOST'].includes(actionKey);

  // 最初のターゲット位置（1ステップ目の起点）とターゲット駒ID（Re-eval の基準）
  const initialTargetPos: Position = uniqueTargets.length > 0 ? uniqueTargets[0] : to;
  const initialTargetPiece = BoardManager.getPiece(nextBoard, initialTargetPos);
  const targetPieceId: string | null = initialTargetPiece ? initialTargetPiece.id : null;

  const actionsToRun = (ability.actions && ability.actions.length > 0) ? ability.actions : ((ability as any).effect_type ? [(ability as any).effect_type] : []);
  actionsToRun.forEach((actionKey, actionIndex) => {
    if (!ActionRegistry[actionKey]) return;

    // 複合アクションの2ステップ目以降、または単一実行アクションの場合は Re-eval された最新ターゲット位置に対して実行
    if (isSingleExecution(actionKey) || (actionIndex > 0 && targetPieceId)) {
      // ─── Re-evaluation: 最新のターゲット座標を再取得 ───────────────────
      let currentTargetPos: Position = initialTargetPos;
      if (actionIndex > 0 && targetPieceId) {
        const reEval = getPieceById(nextBoard, targetPieceId);
        if (reEval) {
          currentTargetPos = reEval.pos;
        } else {
          // ─── Exist Guard: 駒が盤面から消滅 → 対象必要アクションはスキップ ──
          if (isTargetRequiredAction(actionKey)) {
            console.log(`[MultiAction Exist Guard] Target (id=${targetPieceId}) no longer on board. Skipping: ${actionKey}`);
            return; // forEach の continue に相当
          }
        }
      }

      // SWAP_POSITION: 敵駒が必要
      const needsVictim = ['SWAP_POSITION'].includes(actionKey);
      if (needsVictim) {
        const found = uniqueTargets.find(pos => {
          const p = BoardManager.getPiece(nextBoard, pos);
          return p !== null && p.owner !== player && !p.isKing;
        });
        if (found) currentTargetPos = found;
      }

      ActionRegistry[actionKey](currentTargetPos, nextBoard, to, context);
    } else {
      // 複数セル型アクション（単一アクション時の DESTROY 等で範囲攻撃時）
      uniqueTargets.forEach(targetPos => {
        ActionRegistry[actionKey](targetPos, nextBoard, to, context);
      });
    }
  });

  // 4. Set Constraints (Cooldown / Once per game)
  if (triggeredRef.value) {
    const updatedConstraints = applyConstraints(piece, ability.constraints);
    const finalActingPos = context.currentActingPos;
    const currentPiece = BoardManager.getPiece(nextBoard, finalActingPos);
    if (currentPiece) {
      const currentUses = currentPiece.remaining_uses ?? currentPiece.usesRemaining ?? 3;
      const nextUses = currentUses - 1;

      decrementCacheUses(currentPiece.word).catch((e: any) => console.warn(e));

      const specCooldown = currentPiece.ability_spec?.cooldown_turns;
      const normalCooldown = currentPiece.cool_down_turns || currentPiece.maxCooldown || 3;
      const defaultCd = specCooldown !== undefined ? specCooldown : normalCooldown;
      const targetCD = updatedConstraints.coolDownTurnsRemaining > 0
        ? updatedConstraints.coolDownTurnsRemaining
        : (defaultCd > 0 ? defaultCd : 1);

      let finalPieceState: Piece = {
        ...currentPiece,
        abilityUsed: updatedConstraints.abilityUsed,
        coolDownTurnsRemaining: targetCD,
        cooldownTurnsRemaining: targetCD,
        maxCooldown: defaultCd,
        remaining_uses: nextUses,
        usesRemaining: nextUses
      };

      if (nextUses <= 0) {
        finalPieceState = degradeToNormalPawn(finalPieceState);
        finalPieceState.remaining_uses = 0;
        finalPieceState.usesRemaining = 0;
        logs.push({
          player: currentPiece.owner,
          message: `【能力消滅】${currentPiece.word} の能力は使用回数制限に達したため消滅し、普通の歩兵になりました。`,
          type: 'system'
        });
      } else {
        finalPieceState.remaining_uses = nextUses;
        finalPieceState.usesRemaining = nextUses;
        if (finalPieceState.custom_ability) {
          finalPieceState.custom_ability = {
            ...finalPieceState.custom_ability,
            remaining_uses: nextUses
          };
        }
        logs.push({
          player: currentPiece.owner,
          message: `【耐久度】${currentPiece.word} の能力残り使用回数: ${nextUses}回`,
          type: 'system'
        });
      }

      BoardManager.setPiece(nextBoard, finalActingPos, finalPieceState);
    }
  }

  return {
    board: nextBoard,
    capturedPieces,
    opponentCapturedPieces: localOpponentCaptured,
    graveyard,
    logs,
    triggered: triggeredRef.value,
    reAction: reActionRef.value
  };
}
