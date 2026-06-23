export type Player = 'sente' | 'gote';

export interface PromotedEffect {
  effect_name: string;
  description: string;
  logic_code?: string;
}

export interface RangeGeometry {
  normal_grid: string;
  charging_grid: string;
  promoted_grid?: string; // Optional field for classic pawn's promoted (Tokin) movement
}

export interface UltimateEffect {
  effect_name: string;
  description: string;
}

export interface SpawnConfig {
  spawn_piece_name: string | null;            // 生み出される駒の名称（不要な場合はnull）
  max_limit: number;                          // 盤面に同時に存在できる最大数（1または2。生み出さない場合は0）
  spawn_range_geometry: string | null;        // どの範囲に生み出すかの5x5グリッドデータ（不要ならnull）
}

export interface PieceData {
  word: string;
  effect_name: string;
  mechanics_type: 'MOVEMENT_HACK' | 'STEALTH_TRAP' | 'RULE_BREAK' | 'DYNAMICS_HACK' | 'AUTOMATIC_DRIVE';
  ability_genre: string; // Display-only Japanese genre name
  visual_theme?: 'WARRIOR_IRON' | 'MYSTIC_MIST' | 'SHADOW_NIGHT' | 'NATURE_STONE';
  trigger: 'ALWAYS' | 'ON_MOVE' | 'TURN_START' | 'ON_TAKEN' | 'ON_APPROACH';
  cool_down_turns: number; // Cooldown (charging) turns required. 99 = once-per-game (永続歩兵化)
  is_once_per_game?: boolean; // 1ゲームに1回限りの必殺技フラグ（発動後は永続歩兵化）
  range_geometry: RangeGeometry;
  description: string;
  spawn_piece_name: string | null; // For copy/replication type logic (clone name, otherwise null)
  spawn_config?: SpawnConfig;       // New field for spawning limits
  promoted_effect: PromotedEffect;
  deep_search_analysis: string;
  logic_code?: string;
}

export interface Piece extends PieceData {
  id: string;
  owner: Player;
  isKing: boolean;
  isPawn: boolean;
  isHisha?: boolean;
  isKaku?: boolean;
  originalPosition: [number, number] | null;
  isPromoted: boolean;
  
  // Dynamic runtime states for new gimmicks
  coolDownTurnsRemaining: number; // If > 0, the piece is in the "charging" state
  isRevealed: boolean;            // Reveal state for STEALTH_TRAP pieces (starts as false for opponent)
  stunTurnsRemaining?: number;    // Action-lock/immobility curse (0 = active, > 0 = stunned)
  deathCountdown?: number;        // Death countdown curse (decrements every turn, 0 = vaporized)
  hasMovedManually?: boolean;     // Flag to mute automatic abilities until first manual move
}

export type Board = (Piece | null)[][]; // 9x9 grid

export interface GameLog {
  id: string;
  timestamp: string;
  player: Player;
  message: string;
  type: 'move' | 'action' | 'system' | 'capture' | 'ability';
}

export type GamePhase = 'start' | 'setup' | 'placement' | 'playing' | 'finished';

export interface HistoryState {
  turnNumber: number;
  boardJson: string;           // JSON snapshot of the board
  capturedPiecesJson: string;  // JSON snapshot of capturedPieces
  customDecksJson: string;     // JSON snapshot of customDecks
  destroyedPiecesJson: string; // JSON snapshot of destroyedPieces
  turn: Player;
  logsJson: string;            // JSON snapshot of logs
}

export interface GameState {
  board: Board;
  turn: Player;
  phase: GamePhase;
  customPieces: {
    sente: Piece[];
    gote: Piece[];
  };
  customDecks: {
    sente: Piece[];
    gote: Piece[];
  };
  destroyedPieces: Piece[];
  capturedPieces: {
    sente: Piece[];
    gote: Piece[];
  };
  onlineMode?: boolean;
  roomCode?: string;
  myRole?: 'sente' | 'gote' | null;
  sharedPieces: Piece[]; 
  selectedCell: [number, number] | null;
  activeAbilityMode: boolean;
  activeAbilitySource: [number, number] | null;
  activeAbilityTargets: [number, number][]; // target highlight cells
  winner: Player | null;
  logs: GameLog[];
  historyStates: HistoryState[]; // Snapshots of previous turns for time rewind
  geminiApiKey: string;
  playerNames: {
    sente: string;
    gote: string;
  };
  promotionPending: {
    from: [number, number];
    to: [number, number];
    piece: Piece;
  } | null;
}

export interface AbilityEvent {
  id: string;
  priority: number; // 1 = Traps (ON_TAKEN, ON_APPROACH), 2 = Moving piece abilities (ON_MOVE), 3 = Turn start / environmental (TURN_START)
  triggerType: 'ON_TAKEN' | 'ON_APPROACH' | 'ON_MOVE' | 'TURN_START';
  pieceId: string; // The ID of the piece triggering the event (to check if it's still alive/valid)
  position: [number, number]; // Position of the triggering piece on the board
  owner: Player;
  fromPosition?: [number, number]; // Specifically for ON_MOVE
  attackerPieceId?: string; // For traps, the ID of the piece that triggered them (the intruder)
  attackerPiecePos?: [number, number]; // For traps, where the intruder landed
  targetCellPiece?: Piece; // For ON_TAKEN trap context (a copy of the captured trap piece)
}
