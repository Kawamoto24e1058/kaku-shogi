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
  mechanics_type: 'MOVEMENT_HACK' | 'STEALTH_TRAP' | 'RULE_BREAK' | 'DYNAMICS_HACK';
  trigger: 'ALWAYS' | 'ON_MOVE' | 'TURN_START' | 'ON_TAKEN' | 'ON_APPROACH';
  cool_down_turns: number; // Cooldown (charging) turns required
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
  originalPosition: [number, number] | null;
  isPromoted: boolean;
  
  // Dynamic runtime states for new gimmicks
  coolDownTurnsRemaining: number; // If > 0, the piece is in the "charging" state
  isRevealed: boolean;            // Reveal state for STEALTH_TRAP pieces (starts as false for opponent)
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
  promotionPending: {
    from: [number, number];
    to: [number, number];
    piece: Piece;
  } | null;
}
