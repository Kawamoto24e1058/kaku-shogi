import type { Board, Piece, Player, GameLog } from './types';

export const BOARD_SIZE = 9;

// Helper to generate UUID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function getPieceLogicCode(piece: Piece): string {
  if (piece.isPromoted && piece.promoted_effect) {
    return piece.promoted_effect.logic_code || '';
  }
  return piece.logic_code || '';
}

export function getPieceTrigger(piece: Piece): 'ALWAYS' | 'ON_MOVE' | 'TURN_START' | 'ON_TAKEN' | 'ON_APPROACH' {
  return piece.trigger || 'ALWAYS';
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
      trigger: 'ALWAYS',
      cool_down_turns: 0,
      range_geometry: {
        normal_grid: '0000000100012100010000000',
        charging_grid: '0000000100012100010000000',
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
      trigger: 'ALWAYS',
      cool_down_turns: 0,
      range_geometry: {
        normal_grid: '0000000100012100010000000',
        charging_grid: '0000000100012100010000000',
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

export function getValidMoves(y: number, x: number, board: Board): [number, number][] {
  const piece = board[y][x];
  if (!piece) return [];

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
    }

    // Fallback to 5x5 grid parser if it is not a classic sliding/jumping move
    if (!hasCustomMove && piece.range_geometry) {
      const grid = piece.isPromoted && piece.range_geometry.promoted_grid ? piece.range_geometry.promoted_grid : piece.range_geometry.normal_grid;
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
  logs: Omit<GameLog, 'id' | 'timestamp'>[];
  shieldTriggered: boolean;
  bombTriggered: boolean;
  gameOver: boolean;
  winner: Player | null;
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
  promote: boolean = false
): MoveResult {
  const [fy, fx] = from;
  const [ty, tx] = to;
  const piece = board[fy][fx];

  if (!piece || piece.owner !== player) {
    throw new Error('Invalid move coordinates');
  }

  let nextBoard = board.map(row => [...row]);
  let capturedPiece: Piece | null = null;
  const isStealthTrap = piece.mechanics_type === 'STEALTH_TRAP';
  let finalPiece = promote
    ? { ...piece, isPromoted: true, isRevealed: isStealthTrap ? piece.isRevealed : true }
    : { ...piece, isRevealed: isStealthTrap ? piece.isRevealed : true };
  const logs: Omit<GameLog, 'id' | 'timestamp'>[] = [];
  const targetCell = board[ty][tx];
  let shieldTriggered = false;
  let bombTriggered = false;
  let gameOver = false;
  let winner: Player | null = null;
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
          // 罠 (ON_TAKEN) のチェック
          const isTrapOrCurse = pathPiece.trigger === 'ON_TAKEN' && (
            pathPiece.mechanics_type === 'STEALTH_TRAP' ||
            pathPiece.mechanics_type === 'DYNAMICS_HACK' ||
            getPieceLogicCode(pathPiece) === 'curse_retaliation' ||
            pathPiece.description.includes('呪い') ||
            pathPiece.description.includes('道連れ')
          );
          if (isTrapOrCurse) {
            const logMsg = pathPiece.mechanics_type === 'STEALTH_TRAP'
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
              winner: pathPiece.isKing ? player : null
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
      const isTrapOrCurse = targetCell.trigger === 'ON_TAKEN' && (
        targetCell.mechanics_type === 'STEALTH_TRAP' ||
        targetCell.mechanics_type === 'DYNAMICS_HACK' ||
        getPieceLogicCode(targetCell) === 'curse_retaliation' ||
        targetCell.description.includes('呪い') ||
        targetCell.description.includes('道連れ')
      );

      if (isTrapOrCurse) {
        const logMsg = targetCell.mechanics_type === 'STEALTH_TRAP'
          ? `【罠発動】移動先の駒は罠「${targetCell.effect_name}」でした！ ${piece.word} が道連れになり、両者消滅しました！`
          : `【呪詛発動】${targetCell.word} を捕獲した瞬間、呪い「${targetCell.effect_name}」が発動！ ${piece.word} は道連れになり、両者消滅しました！`;
        logs.push({
          player,
          message: logMsg,
          type: 'ability'
        });
        
        nextBoard[ty][tx] = null;
        nextBoard[fy][fx] = null;
        bombTriggered = true;
        
        if (targetCell.isKing || piece.isKing) {
          gameOver = true;
          winner = player === 'sente' ? 'gote' : 'sente';
        }
      } else {
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
            message: `敵の玉将が討ち取られました！${player === 'sente' ? '先手' : '後手'}の勝利！`,
            type: 'system',
          });
        }
      }
    } else {
      // 空きマスへの移動
      nextBoard[ty][tx] = finalPiece;
      nextBoard[fy][fx] = null;
    }
  }

  // 接近警報 (ON_APPROACH 罠の判定)
  // 移動が完了し、自駒が盤面 (ty, tx) に存在する場合のみ実行
  if (nextBoard[ty][tx] && nextBoard[ty][tx] === finalPiece && !bombTriggered) {
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
          adjacentPiece.mechanics_type === 'STEALTH_TRAP' &&
          adjacentPiece.trigger === 'ON_APPROACH' &&
          !adjacentPiece.isRevealed
        ) {
          // 罠の強制開示
          nextBoard[ny][nx] = {
            ...adjacentPiece,
            isRevealed: true
          };
          
          logs.push({
            player: adjacentPiece.owner,
            message: `【接近開示】${getCellLabel(ny, nx)} に潜む罠「${adjacentPiece.effect_name}」が接近により発動し、姿が露見しました！`,
            type: 'ability'
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
    logs,
    shieldTriggered,
    bombTriggered,
    gameOver,
    winner,
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

  // 罠駒の場合は裏向きで配置
  if (placedPiece.mechanics_type === 'STEALTH_TRAP') {
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

      validCells.push([y, x]);
    }
  }

  return validCells;
}

export function checkAndApplyNullification(
  board: Board,
  attackerPosition: [number, number],
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

export function applyAutomatedEffect(
  board: Board,
  position: [number, number],
  triggerType: 'ON_MOVE' | 'TURN_START',
  player: Player,
  capturedPieces: Piece[],
  fromPosition?: [number, number],
  targetPosition?: [number, number]
): {
  board: Board;
  capturedPieces: Piece[];
  logs: Omit<GameLog, 'id' | 'timestamp'>[];
  triggered: boolean;
} {
  const [y, x] = position;
  const piece = board[y][x];
  if (!piece || piece.owner !== player || getPieceTrigger(piece) !== triggerType || piece.coolDownTurnsRemaining > 0) {
    return { board, capturedPieces, logs: [], triggered: false };
  }

  let nextBoard = board.map(row => [...row]);
  let nextCaptured = [...capturedPieces];
  const logs: Omit<GameLog, 'id' | 'timestamp'>[] = [];
  let triggered = false;

  const logic = getPieceLogicCode(piece);
  const desc = piece.description || '';
  const effectName = piece.isPromoted ? (piece.promoted_effect?.effect_name || piece.effect_name) : piece.effect_name;

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
          trigger: 'ALWAYS',
          cool_down_turns: 0,
          range_geometry: {
            normal_grid: '0000000100012100010000000',
            charging_grid: '0000000100012100010000000'
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
            description: `覚醒した${spawnPieceName}。`
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
  else if (desc.includes('爆破') || desc.includes('爆発') || desc.includes('自爆') || desc.includes('爆砕') || logic === 'kill_adjacent_remote' || logic === 'kill_front_enemy' || logic === 'kill_linear') {
    const adjacent = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    const targets: [number, number][] = [];
    for (const [dy, dx] of adjacent) {
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
        return { board: nullifyRes.board, capturedPieces: nextCaptured, logs, triggered: true };
      }

      for (const [ny, nx] of targets) {
        const victim = nextBoard[ny][nx];
        if (victim) {
          logs.push({
            player,
            message: `【自動発動】${piece.word} の効果「${effectName}」の衝撃波が命中！ ${victim.word} (${getCellLabel(ny, nx)}) を爆破捕獲しました！`,
            type: 'capture'
          });
          nextCaptured.push({
            ...victim,
            owner: player,
            isPromoted: false,
            coolDownTurnsRemaining: 0,
            isRevealed: true
          });
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
  else if (desc.includes('瞬間移動') || desc.includes('ワープ') || logic === 'random_move' || logic === 'teleport_anywhere') {
    const emptyCells: [number, number][] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (nextBoard[r][c] === null) {
          emptyCells.push([r, c]);
        }
      }
    }
    if (emptyCells.length > 0) {
      const [ny, nx] = emptyCells[Math.floor(Math.random() * emptyCells.length)];
      const updatedPiece = {
        ...piece,
        coolDownTurnsRemaining: piece.cool_down_turns
      };
      nextBoard[ny][nx] = updatedPiece;
      nextBoard[y][x] = null;
      triggered = true;
      logs.push({
        player,
        message: `【自動発動】${piece.word} の効果「${effectName}」により、${getCellLabel(ny, nx)} へ瞬間移動しました！`,
        type: 'ability'
      });
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
  )) {
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

  if (triggered) {
    const updatedPiece = nextBoard[y][x] || nextBoard[position[0]][position[1]];
    if (updatedPiece && updatedPiece.id === piece.id) {
      if (updatedPiece.cool_down_turns > 0) {
        updatedPiece.coolDownTurnsRemaining = updatedPiece.cool_down_turns;
      }
    }
  }

  return { board: nextBoard, capturedPieces: nextCaptured, logs, triggered };
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
  player: Player
): { targets: [number, number][]; type: 'transform' | 'mind_control' | 'swap' } | null {
  const [y, x] = position;
  const piece = board[y][x];
  if (!piece || piece.coolDownTurnsRemaining > 0) return null;

  const desc = piece.description || '';
  const logic = getPieceLogicCode(piece);

  const isTransform = logic === 'transform' || logic === 'mimic' || logic === 'ability_theft' || desc.includes('擬態') || desc.includes('コピー') || desc.includes('変身');
  const isMindControl = logic === 'mind_control' || logic === 'puppet' || logic === 'parasite' || desc.includes('洗脳') || desc.includes('寄生') || desc.includes('支配');
  const isSwap = logic === 'swap' || logic === 'swap_pawn' || desc.includes('スワップ') || desc.includes('入れ替え');

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
