export type Player = 'sente' | 'gote';

export interface Position {
  x: number;
  y: number;
}

export interface CustomMoveDef {
  dx: number;
  dy: number;
  slide?: boolean;
  jump?: boolean;
}

export interface EffectOffset {
  dx: number;
  dy: number;
}

export type TargetMode = 'SELF_CENTERED' | 'POINT_CENTERED';

export interface CustomAbility {
  ability_name: string;
  flavor_text: string;
  triggers: string[];
  targets: string[];
  actions: string[];
  constraints: string[];
  remaining_uses: number; // ✨ 【新設】残り使用回数カウント（初期値は一律 3）
  custom_moves?: CustomMoveDef[];
  target_mode?: TargetMode;
  range_distance?: number;
  effect_offsets?: EffectOffset[];
  isAutonomous?: boolean; // 暴走・自動行動フラグ（勝手に動く / 他駒移動後に発動など）
  trigger_override?: 'MANUAL' | 'ON_TURN_END' | 'PASSIVE';
  activation_type?: ActivationType;
}

export interface VisualEffect {
  trajectory_type: 'PARABOLA' | 'BEAM' | 'STRIKE' | 'SPIRAL' | 'BURST';
  particle_color: string;
  particle_count: number;
  particle_speed: number;
  screen_shake: number;
}

export interface PromotedEffect {
  effect_name: string;
  description: string;
  logic_code?: string;
  ability_spec?: AbilitySpec;
  visual_effect?: VisualEffect;
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

// ─── 動的インタープリター型能力システム（AbilitySpec） ────────────────────────
// AIが出力する数値パラメータを元に、ゲームロジックが動的に射程・範囲・効果を計算する

export type TileEffectType = 'FIRE_ZONE' | 'POISON_MUD' | 'ICE_FLOOR' | 'TIME_BOMB' | 'STEALTH_TRAP';

export interface TileState {
  effectType: TileEffectType;
  duration: number;
  ownerPlayer: Player;
  isStealth?: boolean;
  payloadAbility?: AbilitySpec;
}

// EffectType: 全アクション種別の共有型エイリアス
export type EffectType = 'DESTROY' | 'CAPTURE' | 'IMMOBILIZE' | 'SWAP' | 'PULL' | 'PUSH' | 'STEALTH' | 'SPAWN' | 'TRANSFORM' | 'RESURRECT' | 'FORCE_CAPTURE' | 'TRANSFORM_PAWN' | 'STEAL_HAND' | 'TIME_REWIND' | 'BOOMERANG' | 'GRAVITY_PULL' | 'SHARE_FATE' | 'WALL_CREATE' | 'LEAVE_TRAIL_FIRE' | 'EVOLUTION' | 'MIND_CONTROL' | 'CLEAR_DEBUFF' | 'MAGNET_PULL' | 'KNOCKBACK_BUMP' | 'POS_SWAP_ENEMY' | 'STUN_LOCK' | 'PENETRATE_STRIKE' | 'VAULT_EXECUTE' | 'CLEAVE_LINE' | 'GUARD_STANCE' | 'SILENCE_SEAL' | 'OVERDRIVE_BOOST' | 'PROBABILITY_STRIKE' | 'CHAOS_GAMBLE' | 'LUCKY_DODGE' | 'DELAYED_BURST' | 'CHARGE_TURN' | 'SACRIFICE_COST' | 'SELF_STUN' | 'EVOLUTION_CHECK' | 'SET_TILE_FIRE' | 'SET_TILE_POISON' | 'SET_TILE_ICE' | 'SET_TILE_BOMB' | 'SET_TILE_TRAP';

export type ActivationType = 'ACTIVE' | 'AUTO_TRIGGER' | 'PASSIVE';

export type TargetSelection = 'CLICK_ZONE' | 'AUTOMATIC' | 'SELF';
export type AreaShape = 'POINT' | 'SQUARE_3X3' | 'SQUARE_5X5' | 'CROSS' | 'LINE_STRAIGHT' | 'RANGE_2' | 'RANGE_3' | 'LINE_DIAGONAL' | 'KNIGHT_JUMP_ALL' | 'FRONT_3_LINE' | 'ALL_ENEMY_PIECES' | 'LEADER_SURROUND' | 'DYNAMIC_OFFSETS';
export type AffectsWho = 'ENEMY_ONLY' | 'ALL_PIECES' | 'ALLY_ONLY' | 'EMPTY_ONLY';

export interface AbilitySpec {
  activation_type?: ActivationType;
  activation_trigger: 'ON_MOVE' | 'TURN_START' | 'ON_TAKEN' | 'ON_APPROACH' | 'ALWAYS' | 'ON_DEATH';
  range: number;             // Range radius (1, 2, 3, etc.) or straight infinity
  target_selection: TargetSelection;
  area_shape: AreaShape;
  effect_type: EffectType;   // 単体アクション（互換性維持・非推奨）
  actions?: EffectType[];    // 複合アクション配列（最大3要素）— effect_type より優先
  affects_who: AffectsWho;
  cooldown_turns: number;    // 0 = none, N = turn cooldown
  target_mode?: TargetMode;  // Specific target resolution strategy
  effect_offsets?: EffectOffset[]; // Precise multi-cell shape offsets
  success_rate?: number;     // 確率判定アクション用成功率 (0.0 ～ 1.0)
  delayed_turns?: number;    // 遅延発動ターン数
}

export interface PieceData {
  word: string;
  effect_name: string;
  mechanics_type: 'MOVEMENT_HACK' | 'STEALTH_TRAP' | 'RULE_BREAK' | 'DYNAMICS_HACK' | 'AUTOMATIC_DRIVE';
  ability_genre: string; // Display-only Japanese genre name
  visual_theme?: 'WARRIOR_IRON' | 'MYSTIC_MIST' | 'SHADOW_NIGHT' | 'NATURE_STONE' | 'SPACE_NATURE' | 'UNIQUE';
  trigger: 'ALWAYS' | 'ON_MOVE' | 'TURN_START' | 'ON_TAKEN' | 'ON_APPROACH' | 'TURN_END' | 'ON_DEATH';
  cool_down_turns: number; // Cooldown (charging) turns required. 99 = once-per-game (永続歩兵化)
  is_once_per_game?: boolean; // 1ゲームに1回限りの必殺技フラグ（発動後は永続歩兵化）
  range_geometry: RangeGeometry;
  description: string;
  spawn_piece_name: string | null; // For copy/replication type logic (clone name, otherwise null)
  spawn_config?: SpawnConfig;       // New field for spawning limits
  promoted_effect: PromotedEffect;
  deep_search_analysis: string;
  logic_code?: string;
  ability_spec?: AbilitySpec; // 動的インタープリター用パラメータ（新システム）
  visual_effect?: VisualEffect; // AIデザイン of ビジュアルエフェクト仕様
  custom_ability?: CustomAbility;
  isStealth?: boolean;
  remaining_uses?: number; // Remaining uses for the custom ability (default 3)
  custom_moves?: CustomMoveDef[];
  target_mode?: TargetMode;
  range_distance?: number;
  effect_offsets?: EffectOffset[];
  isAutonomous?: boolean; // 暴走・自動行動フラグ
  activation_type?: ActivationType;
}


export interface Piece extends PieceData {
  id: string;
  owner: Player;
  isKing: boolean;
  isPawn: boolean;
  isHisha?: boolean;
  isKaku?: boolean;
  originalPosition: [number, number] | null;
  previousPosition?: Position;
  isPromoted: boolean;
  
  // Dynamic runtime states for new gimmicks
  coolDownTurnsRemaining: number; // If > 0, the piece is in the "charging" state
  cooldownTurnsRemaining?: number; // Alias for coolDownTurnsRemaining
  maxCooldown?: number;            // Original cooldown turns limit
  isRevealed: boolean;            // Reveal state for STEALTH_TRAP pieces (starts as false for opponent)
  stunTurnsRemaining?: number;    // Action-lock/immobility curse (0 = active, > 0 = stunned)
  deathCountdown?: number;        // Death countdown curse (decrements every turn, 0 = vaporized)
  hasMovedManually?: boolean;     // Flag to mute automatic abilities until first manual move
  isFrozen?: boolean;
  frozenDuration?: number;
  abilityUsed?: boolean;
  isStealth?: boolean;
  remaining_uses?: number; // Remaining uses for the custom ability (reverts to normal when <= 0)
  usesRemaining?: number;  // Alias for remaining_uses
  hasShield?: boolean;
  isInverted?: boolean;
  
  // Group 3 fields
  linkedPieceId?: string;
  type?: 'wall' | 'hazard';
  duration?: number;
  isObstacle?: boolean;
  isHazard?: boolean;

  // Group 4 fields
  level?: number;
  isMindControlled?: boolean;
  originalPlayer?: Player;

  // Group 5 fields
  hasAbsoluteGuard?: boolean;
  guardDuration?: number;
  isSilenced?: boolean;
  silenceDuration?: number;
  isOverdrive?: boolean;
}

export type Board = (Piece | null)[][]; // 9x9 grid

export interface GameLog {
  id: string;
  timestamp: string;
  player: Player;
  message: string;
  type: 'move' | 'action' | 'system' | 'capture' | 'ability';
}

export type GamePhase = 'start' | 'setup' | 'placement' | 'playing' | 'SELECTING_ABILITY_TARGET' | 'RESOLVING_ACTION' | 'TURN_TRANSITION' | 'finished';

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
  tileBoard: (TileState | null)[][];
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
  triggerType: 'ON_TAKEN' | 'ON_APPROACH' | 'ON_MOVE' | 'TURN_START' | 'TURN_END' | 'ON_DEATH' | 'ON_PROMOTE';
  pieceId: string; // The ID of the piece triggering the event (to check if it's still alive/valid)
  position: [number, number]; // Position of the triggering piece on the board
  owner: Player;
  fromPosition?: [number, number]; // Specifically for ON_MOVE
  attackerPieceId?: string; // For traps, the ID of the piece that triggered them (the intruder)
  attackerPiecePos?: [number, number]; // For traps, where the intruder landed
  targetCellPiece?: Piece; // For ON_TAKEN trap context (a copy of the captured trap piece)
}

export type ValidMove = [number, number] & { moveType?: 'normal' | 'slide' | 'jump' };
