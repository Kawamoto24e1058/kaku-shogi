import type { Board, Piece, Player, GameLog, AbilityEvent, AbilitySpec } from './types';

export const BOARD_SIZE = 9;

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
  if (piece.isPromoted && piece.promoted_effect) {
    return piece.promoted_effect.ability_spec;
  }
  // Check if the unpromoted piece should have NO ability based on description/name
  if (!hasNormalAbility(piece)) {
    return undefined;
  }
  // Prevent unpromoted pieces from inheriting duplicate promoted ability_spec
  if (!piece.isPromoted && piece.promoted_effect?.ability_spec) {
    const rootSpec = piece.ability_spec;
    const promoSpec = piece.promoted_effect.ability_spec;
    if (rootSpec && rootSpec.effect_type === promoSpec.effect_type && rootSpec.activation_trigger === promoSpec.activation_trigger) {
      return undefined;
    }
  }
  return piece.ability_spec;
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

export function getPieceTrigger(piece: Piece): 'ALWAYS' | 'ON_MOVE' | 'TURN_START' | 'ON_TAKEN' | 'ON_APPROACH' {
  if (piece.isPromoted && piece.promoted_effect && piece.promoted_effect.ability_spec) {
    return piece.promoted_effect.ability_spec.activation_trigger;
  }
  return piece.trigger || 'ALWAYS';
}

export function isTriggerMatching(piece: Piece, triggerType: 'ON_MOVE' | 'TURN_START' | 'ON_APPROACH' | 'ON_TAKEN'): boolean {
  if (!piece.isPromoted && !hasNormalAutomatedAbility(piece)) {
    return false;
  }
  if (piece.isPromoted && !hasPromotedAutomatedAbility(piece) && !hasNormalAutomatedAbility(piece)) {
    return false;
  }
  const trigger = getPieceTrigger(piece);
  return trigger === 'ALWAYS' || trigger === triggerType;
}

export function isStealthPiece(p: any): boolean {
  if (!p) return false;
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
  board[8][4] = {
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
    description: 'このゲームの王。捕獲されると敗北する。',
    spawn_piece_name: null,
    promoted_effect: {
      effect_name: '王権 of 守護',
      description: 'このゲームの王。捕獲されると敗北する。',
    },
    deep_search_analysis: '基本となる王駒。本質的な勝利条件を定義。',
    owner: 'sente',
    isKing: true,
    isPawn: false,
    originalPosition: [8, 4],
    coolDownTurnsRemaining: 0,
    isRevealed: true,
    isPromoted: false
  };

  // Place Gote (Player 2) King at (0, 4)
  board[0][4] = {
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
    description: 'このゲームの王。捕獲されると敗北する。',
    spawn_piece_name: null,
    promoted_effect: {
      effect_name: '王権 of 守護',
      description: 'このゲームの王。捕獲されると敗北する。',
    },
    deep_search_analysis: '基本となる王駒。本質的な勝利条件を定義。',
    owner: 'gote',
    isKing: true,
    isPawn: false,
    originalPosition: [0, 4],
    coolDownTurnsRemaining: 0,
    isRevealed: true,
    isPromoted: false
  };

  // Place 9 Sente Pawns (歩) at row 6 (index 6, files 1-9)
  for (let x = 0; x < BOARD_SIZE; x++) {
    board[6][x] = {
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
    };
  }

  // Place 9 Gote Pawns (歩) at row 2 (index 2, files 1-9)
  for (let x = 0; x < BOARD_SIZE; x++) {
    board[2][x] = {
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
    };
  }

  // --- Place Sente Hisha (飛車) at Y=7, X=7 (2八) and Kaku (角) at Y=7, X=1 (8八) ---
  board[7][7] = {
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
  };

  board[7][1] = {
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
  };

  // --- Place Gote Hisha (飛車) at Y=1, X=1 (8二) and Kaku (角) at Y=1, X=7 (2二) ---
  board[1][1] = {
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
  };

  board[1][7] = {
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
  };

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

export function getValidMoves(y: number, x: number, board: Board): [number, number][] {
  const piece = board[y][x];
  if (!piece) return [];

  if (piece.stunTurnsRemaining && piece.stunTurnsRemaining > 0) {
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
            const target = board[ny][nx];
            if (!target || target.owner !== piece.owner) {
              validMoves.push([ny, nx]);
            }
          }
        }
      }
    }
    return validMoves;
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
        const target = board[ny][nx];
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
        const target = board[ny][nx];
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
        const target = board[ny][nx];
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
          const target = board[ny][nx];
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
        const target = board[ny][nx];
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
          const target = board[ny][nx];
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
          const target = board[ny][nx];
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
            const target = board[ny][nx];
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
          const target = board[ny][nx];
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
            const target = board[ny][nx];
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
        const target = board[ny][x];
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
            const target = board[ny][nx];
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
          const target = board[ny][nx];
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
            const target = board[ny][nx];
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
          const target = board[ny][nx];
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
            const target = board[ny][nx];
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
          const target = board[ny][nx];
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
          if (board[r][c] === null) {
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
          const target = board[ny][nx];
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
            const target = board[ny][nx];
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
                const target = board[ny][nx];
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
  for (const [ny, nx] of validMoves) {
    const key = `${ny},${nx}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueMoves.push([ny, nx]);
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
        const p = board[ny][nx];
        if (p && p.owner !== piece.owner && p.mechanics_type === 'RULE_BREAK' && p.isRevealed !== false) {
          isStunnedByField = true;
        }
      }
    }
  }

  if (isStunnedByField) {
    // 現在地から1マス以内のみに制限（鈍化）
    return validMoves.filter(([ny, nx]) => Math.abs(ny - y) <= 1 && Math.abs(nx - x) <= 1);
  }

  return validMoves;
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
  const piece = board[y][x];
  if (!piece) return board;

  const ny = y + dy;
  const nx = x + dx;

  let nextBoard = board.map(row => [...row]);
  nextBoard[y][x] = null;

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
    const target = board[ny][nx];
    if (target) {
      nextBoard = pushPiece(nextBoard, ny, nx, dy, dx, player, logs, capturedPieces);
    }
    nextBoard[ny][nx] = piece;
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
  const piece = board[fy][fx];

  if (!piece || piece.owner !== player) {
    throw new Error('Invalid move coordinates');
  }

  let nextBoard = board.map(row => [...row]);
  let capturedPiece: Piece | null = null;
  const destroyedPieces: Piece[] = [];
  const isStealthTrap = isStealthPiece(piece);
  let finalPiece = promote
    ? { ...piece, isPromoted: true, isRevealed: isStealthTrap ? piece.isRevealed : true }
    : { ...piece, isRevealed: isStealthTrap ? piece.isRevealed : true };
  
  finalPiece.hasMovedManually = true;
  const isOnce = finalPiece.is_once_per_game || finalPiece.cool_down_turns === 99;
  if (isOnce) {
    if (getPieceTrigger(finalPiece) === 'ON_MOVE') {
      finalPiece.coolDownTurnsRemaining = 99;
    }
  }

  const logs: Omit<GameLog, 'id' | 'timestamp'>[] = [];
  const targetCell = board[ty][tx];
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
      const pathPiece = nextBoard[cy][cx];
      if (pathPiece) {
        if (pathPiece.owner !== player) {
          // 敵の駒：一撃で破壊・捕獲
          const code = pathPiece.logic_code || '';
          const desc = pathPiece.description || '';
          const isCurseStun = code === 'curse_stun' || desc.includes('呪縛') || desc.includes('行動封印');
          const isCurseSilence = code === 'curse_silence' || desc.includes('能力封印');
          const isCurseDeath = code === 'curse_death' || desc.includes('死の宣告');

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
            nextBoard[cy][cx] = null;
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
              nextBoard[cy][cx] = null;
              nextBoard[fy][fx] = null;
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
              nextBoard[cy][cx] = null;
              if (pathPiece.isKing) {
                gameOver = true;
                winner = player;
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

    nextBoard[ty][tx] = finalPiece;
    nextBoard[fy][fx] = null;

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
        nextBoard[ty][tx] = null;
        nextBoard[fy][fx] = null;
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

      const code = targetCell.logic_code || '';
      const desc = targetCell.description || '';
      const isCurseStun = code === 'curse_stun' || desc.includes('呪縛') || desc.includes('行動封印');
      const isCurseSilence = code === 'curse_silence' || desc.includes('能力封印');
      const isCurseDeath = code === 'curse_death' || desc.includes('死の宣告');
      const isTrap = targetCell.trigger === 'ON_TAKEN';

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

      capturedPiece = {
        ...targetCell,
        owner: player,
        isPromoted: false,
        isRevealed: true,
        coolDownTurnsRemaining: 0
      };

      nextBoard[ty][tx] = finalPiece;
      nextBoard[fy][fx] = null;

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
      nextBoard[ty][tx] = finalPiece;
      nextBoard[fy][fx] = null;
    }
  }

  // 接近警報 (ON_APPROACH 罠の判定)
  // 移動が完了し、自駒が盤面 (ty, tx) に存在する場合のみ実行
  if (nextBoard[ty][tx] && nextBoard[ty][tx] === finalPiece) {
    const adjacent = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    for (const [ady, adx] of adjacent) {
      const ny = ty + ady;
      const nx = tx + adx;
      if (isWithinBounds(ny, nx)) {
        const adjacentPiece = nextBoard[ny][nx];
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

  if (promote && nextBoard[ty][tx] === finalPiece) {
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

  if (board[ty][tx] !== null) {
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
  if (isStealthPiece(placedPiece)) {
    placedPiece.isRevealed = false;
  } else {
    placedPiece.isRevealed = true;
  }

  nextBoard[ty][tx] = placedPiece;
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
      const p = board[r][c];
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
        const p = board[y][x];
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
      if (board[y][x] !== null) continue;

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
      const p = board[r][c];
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
          nextBoard[r][c] = updatedNullifier;
          
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
      
      const cell = board[y][x];
      if (affects_who === 'ENEMY_ONLY') {
        if (cell && cell.owner !== player && !cell.isKing) results.push([y, x]);
      } else if (affects_who === 'ALLY_ONLY') {
        if (cell && cell.owner === player) results.push([y, x]);
      } else if (affects_who === 'EMPTY_ONLY') {
        if (!cell) results.push([y, x]);
      } else {
        if (cell && !cell.isKing) results.push([y, x]);
        if (!cell) results.push([y, x]);
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
  _sx?: number
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
        ny += dy;
        nx += dx;
      }
    }
    return cells;
  }
  if (shape === 'LINE_STRAIGHT') {
    const lineCells: [number, number][] = [];
    for (let ny = 0; ny < BOARD_SIZE; ny++) {
      lineCells.push([ny, cx]);
    }
    return lineCells;
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
  selectedGraveyardPiece?: Piece
): {
  board: Board;
  capturedPieces: Piece[];
  graveyard: Piece[];
  logs: Omit<GameLog, 'id' | 'timestamp'>[];
  triggered: boolean;
} {
  const [y, x] = position;
  const piece = board[y][x];
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
    if (targetPosition && isWithinBounds(targetPosition[0], targetPosition[1]) && nextBoard[targetPosition[0]][targetPosition[1]] === null) {
      spawnCell = targetPosition;
    } else {
      const adjacent: [number, number][] = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
      for (const [dy, dx] of adjacent) {
        const ny = y + dy, nx = x + dx;
        if (isWithinBounds(ny, nx) && nextBoard[ny][nx] === null) { spawnCell = [ny, nx]; break; }
      }
    }

    if (reviveTarget && reviveIdx !== -1 && spawnCell) {
      const [sy, sx] = spawnCell;
      const revived: Piece = {
        ...reviveTarget,
        id: generateId(),
        owner: player,
        isPromoted: reviveTarget.isPromoted,
        coolDownTurnsRemaining: 0,
        originalPosition: [sy, sx],
        stunTurnsRemaining: 0,
        deathCountdown: 0,
        isRevealed: true
      };
      nextBoard[sy][sx] = revived;
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
    for (const cell of getEffectCells(cy, cx, spec.area_shape, y, x)) {
      const key = `${cell[0]},${cell[1]}`;
      if (!seen.has(key)) { seen.add(key); allEffectCells.push(cell); }
    }
  }

  for (const [ey, ex] of allEffectCells) {
    if (!isWithinBounds(ey, ex)) continue;
    const victim = nextBoard[ey][ex];
    const isAlly = victim && victim.owner === player;
    const isEnemy = victim && victim.owner !== player;

    if (spec.affects_who === 'ENEMY_ONLY' && (!victim || !isEnemy || victim.isKing)) continue;
    if (spec.affects_who === 'ALLY_ONLY' && (!victim || !isAlly)) continue;
    if (spec.affects_who === 'EMPTY_ONLY' && victim) continue;
    if (spec.affects_who === 'ALL_PIECES' && (!victim || victim.isKing)) continue;

    switch (spec.effect_type) {
      case 'DESTROY':
        if (victim) {
          nextGraveyard.push({
            ...victim,
            owner: victim.owner,
            isPromoted: victim.isPromoted,
            coolDownTurnsRemaining: 0,
            isRevealed: true,
            stunTurnsRemaining: 0,
            deathCountdown: 0
          });
          nextBoard[ey][ex] = null;
          triggered = true;
          logs.push({ player, message: `【${effectName}】${piece.word} の効果により ${victim.word} (${getCellLabel(ey, ex)}) を消滅（墓地送り）しました！`, type: 'system' });
        }
        break;

      case 'CAPTURE':
        if (victim && victim.owner !== player && !victim.isKing) {
          nextCaptured.push({ ...victim, owner: player, isPromoted: false, isRevealed: true, coolDownTurnsRemaining: 0 });
          nextBoard[ey][ex] = null;
          triggered = true;
          logs.push({ player, message: `【${effectName}】${piece.word} の効果により ${victim.word} (${getCellLabel(ey, ex)}) を捕獲しました！`, type: 'capture' });
        }
        break;

      case 'IMMOBILIZE':
        if (victim) {
          nextBoard[ey][ex] = { ...victim, stunTurnsRemaining: 2 };
          triggered = true;
          logs.push({ player, message: `【${effectName}】${victim.word} (${getCellLabel(ey, ex)}) を2手番の間、行動封印しました！`, type: 'ability' });
        }
        break;

      case 'STEALTH':
        if (ey === y && ex === x) {
          const p = nextBoard[ey][ex];
          if (p) { nextBoard[ey][ex] = { ...p, isRevealed: false }; triggered = true; }
          logs.push({ player, message: `【${effectName}】${piece.word} が潜伏状態に入りました。`, type: 'ability' });
        }
        break;

      case 'SWAP': {
        const swapPiece = nextBoard[ey][ex];
        if (swapPiece && (ey !== y || ex !== x)) {
          const currentSelf = nextBoard[y][x];
          if (currentSelf) {
            nextBoard[ey][ex] = { ...currentSelf, originalPosition: [ey, ex] };
            nextBoard[y][x] = { ...swapPiece, originalPosition: [y, x] };
            triggered = true;
            logs.push({ player, message: `【${effectName}】${piece.word} が ${swapPiece.word} (${getCellLabel(ey, ex)}) と位置を入れ替えました！`, type: 'ability' });
          }
        }
        break;
      }

      case 'PULL': {
        if (victim && victim.owner !== player) {
          const dy = Math.sign(y - ey);
          const dx = Math.sign(x - ex);
          const ny = ey + dy;
          const nx = ex + dx;
          if (isWithinBounds(ny, nx) && nextBoard[ny][nx] === null) {
            nextBoard[ny][nx] = { ...victim, originalPosition: [ny, nx] };
            nextBoard[ey][ex] = null;
            triggered = true;
            logs.push({ player, message: `【${effectName}】${victim.word} (${getCellLabel(ey, ex)}) を ${getCellLabel(ny, nx)} に引き寄せました！`, type: 'ability' });
          }
        }
        break;
      }

      case 'PUSH': {
        if (victim) {
          const dy = Math.sign(ey - y);
          const dx = Math.sign(ex - x);
          nextBoard = pushPiece(nextBoard, ey, ex, dy, dx, player, logs, nextCaptured);
          triggered = true;
        }
        break;
      }

      case 'TRANSFORM': {
        if (victim && victim.owner !== player && !victim.isKing) {
          const currentSelf = nextBoard[y][x];
          if (currentSelf) {
            nextBoard[y][x] = {
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
              ability_spec: victim.ability_spec ? { ...victim.ability_spec } : undefined
            };
            triggered = true;
            logs.push({ player, message: `【${effectName}】${piece.word} が ${victim.word} の姿と能力に変化しました！`, type: 'ability' });
          }
        }
        break;
      }
    }
  }

  return { board: nextBoard, capturedPieces: nextCaptured, graveyard: nextGraveyard, logs, triggered };
}

function isAutonomousPiece(p: Piece | null): boolean {
  if (!p) return false;
  const logic = getPieceLogicCode(p);
  const desc = getPieceDescription(p);
  return p.trigger === 'ALWAYS' || 
         logic.includes('runaway') || 
         logic === 'random_teleport' || 
         desc.includes('操作不能') || 
         desc.includes('猪突猛進') || 
         desc.includes('暴走列車');
}

export function applyAutomatedEffect(
  board: Board,
  position: [number, number],
  triggerType: 'ON_MOVE' | 'TURN_START' | 'ON_APPROACH' | 'ON_TAKEN',
  player: Player,
  capturedPieces: Piece[],
  fromPosition?: [number, number],
  targetPosition?: [number, number],
  _graveyardCandidates?: Piece[],
  graveyard?: Piece[],
  selectedGraveyardPiece?: Piece
): {
  board: Board;
  capturedPieces: Piece[];
  graveyard?: Piece[];
  logs: Omit<GameLog, 'id' | 'timestamp'>[];
  triggered: boolean;
} {
  const [y, x] = position;
  const piece = board[y][x];
  if (!piece || piece.owner !== player || !isTriggerMatching(piece, triggerType)) {
    return { board, capturedPieces, graveyard, logs: [], triggered: false };
  }
  const trigger = getPieceTrigger(piece);
  const isTrap = trigger === 'ON_TAKEN' || trigger === 'ON_APPROACH';
  if (!isTrap && piece.hasMovedManually === false) {
    return { board, capturedPieces, graveyard, logs: [], triggered: false };
  }
  if (!isAutonomousPiece(piece) && piece.coolDownTurnsRemaining > 0) {
    return { board, capturedPieces, graveyard, logs: [], triggered: false };
  }

  let nextBoard = board.map(row => [...row]);
  let nextCaptured = [...capturedPieces];
  let nextGraveyard = graveyard ? [...graveyard] : [];
  const logs: Omit<GameLog, 'id' | 'timestamp'>[] = [];
  let triggered = false;

  const logic = getPieceLogicCode(piece);
  const desc = getPieceDescription(piece);
  const effectName = piece.isPromoted ? (piece.promoted_effect?.effect_name || piece.effect_name) : piece.effect_name;

  // ── 動的インタープリター優先ルート ──
  const spec = getPieceAbilitySpec(piece);
  if (spec) {
    if (spec.activation_trigger === triggerType || spec.activation_trigger === 'ALWAYS') {
      const specResult = interpretAbilitySpec(
        nextBoard, position, spec, player,
        nextCaptured, nextGraveyard,
        targetPosition, selectedGraveyardPiece
      );
      if (specResult.triggered) {
        const isOnce = piece.is_once_per_game || piece.cool_down_turns === 99;
        const targetCd = isOnce ? 99 : (spec.cooldown_turns > 0 ? spec.cooldown_turns : 0);
        if (targetCd > 0) {
          for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
              const p = specResult.board[r][c];
              if (p && p.id === piece.id) {
                specResult.board[r][c] = {
                  ...p,
                  coolDownTurnsRemaining: targetCd
                };
                break;
              }
            }
          }
        }
      }
      return {
        board: specResult.board,
        capturedPieces: specResult.capturedPieces,
        graveyard: specResult.graveyard,
        logs: specResult.logs,
        triggered: specResult.triggered
      };
    }
    return { board, capturedPieces, graveyard, logs: [], triggered: false };
  }

  // 1. Replication/Clone (spawn_piece_name is present)
  if (piece.spawn_piece_name && piece.spawn_piece_name.trim() !== '') {
    const spawnPieceName = piece.spawn_config?.spawn_piece_name || piece.spawn_piece_name;
    const maxLimit = piece.spawn_config?.max_limit ?? 2;

    // Count existing minions on the board owned by this player
    let minionCount = 0;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
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
          targetOffsets.push([ny - y, nx - x]);
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
        const isCurseStun = code === 'curse_stun' || vdesc.includes('呪縛') || vdesc.includes('行動封印');
        const isCurseSilence = code === 'curse_silence' || vdesc.includes('能力封印');
        const isCurseDeath = code === 'curse_death' || vdesc.includes('死の宣告');

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
        spawn_piece_name: target.spawn_piece_name
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
        const zombiePiece: Piece = {
          ...target,
          id: generateId(),
          word: isZombie ? `ゾンビ・${target.word}` : target.word,
          owner: player,
          isPromoted: false,
          coolDownTurnsRemaining: 0,
          originalPosition: [sy, sx]
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

  return { board: nextBoard, capturedPieces: nextCaptured, graveyard: nextGraveyard, logs, triggered };
}

export function isKingInCheck(board: Board, player: Player): boolean {
  let kingY = -1;
  let kingX = -1;
  
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const piece = board[y][x];
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
      const piece = board[y][x];
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
  const piece = board[y][x];

  if (!piece) return null;

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
          if (isWithinBounds(ny, nx) && board[ny][nx] === null) targets.push([ny, nx]);
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
      if (isWithinBounds(ny, nx) && board[ny][nx] === null) {
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
          const p = board[ny][nx];
          if (p && p.owner !== player && !p.isKing) {
            targets.push([ny, nx]);
          }
        }
      }
    } else {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = board[r][c];
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
        const p = board[ny][nx];
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
        const p = board[r][c];
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
      if (board[r][c]?.isKing && board[r][c]?.owner === 'gote') {
        goteKingPos = [r, c];
      }
    }
  }

  // Find Sente King position (should be at (8, 4))
  let senteKingPos: [number, number] = [8, 4];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c]?.isKing && board[r][c]?.owner === 'sente') {
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
        if (nextBoard[r][c] === null) {
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
          nextBoard[py][px] = {
            ...piece,
            originalPosition: [py, px],
            coolDownTurnsRemaining: 0,
            hasMovedManually: true, // starts on board, so active from start
            isRevealed: isStealthPiece(piece) ? false : true
          };
          emptyCells.splice(idx, 1);
          placed = true;
          break;
        }
      }

      // Fallback
      if (!placed && emptyCells.length > 0) {
        const [py, px] = emptyCells[0];
        nextBoard[py][px] = {
          ...piece,
          originalPosition: [py, px],
          coolDownTurnsRemaining: 0,
          hasMovedManually: true,
          isRevealed: isStealthPiece(piece) ? false : true
        };
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
