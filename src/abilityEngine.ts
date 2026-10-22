// 能力プログラム（v2, shared/abilityProgram.ts）の実行エンジン
// 駒が abilities を持っている場合、gameLogic の applyAutomatedEffect / isTriggerMatching からここが呼ばれる。
// 状態異常の持続（凍結・麻痺・封印・洗脳・死の宣告・防護）は既存の手番終了処理（App.tsx）がそのまま減らすので、
// ここでは駒の状態を書き換えるだけにする。消滅・捕獲・分身・壁などは既存の applyCoreActionEffect に任せ、
// 墓地送り・道連れ・死亡時能力などの既存ルールとの整合を保つ。
import type { Board, GameLog, Piece, Player, Position } from './types';
import type { AbilityProgram, ProgramEffect, ProgramTarget, TileKind } from '../shared/abilityProgram';
import { NAMED_AREAS } from '../shared/abilityProgram';
import { applyCoreActionEffect, getCellLabel, queueTilePlacement } from './gameLogic';

export type ProgramTriggerEvent = 'ON_MOVE' | 'TURN_START' | 'ON_APPROACH' | 'ON_TAKEN' | 'TURN_END' | 'ON_DEATH' | 'ON_PROMOTE' | 'ON_CAPTURE';

type Log = Omit<GameLog, 'id' | 'timestamp'>;

export interface ProgramRunResult {
  board: Board;
  capturedPieces: Piece[];
  opponentCapturedPieces?: Piece[];
  graveyard: Piece[];
  logs: Log[];
  triggered: boolean;
  reAction: boolean;
}

const SIZE = 9;
const inBounds = (y: number, x: number) => y >= 0 && y < SIZE && x >= 0 && x < SIZE;
const isObstacle = (p: Piece | null) => !!p && (p.type === 'wall' || p.type === 'hazard' || !!p.isObstacle);

function abilityMatchesEvent(a: AbilityProgram, event: ProgramTriggerEvent): boolean {
  if (a.trigger === event) return true;
  return a.trigger === 'EVERY_N_TURNS' && event === 'TURN_START';
}

/** この駒に、今使える（充填が終わっている）能力でイベントに反応するものがあるか */
export function programTriggerMatches(piece: Piece, event: ProgramTriggerEvent): boolean {
  return (piece.abilities ?? []).some((a, i) => abilityMatchesEvent(a, event) && (piece.abilityCooldowns?.[i] ?? 0) === 0);
}

/** 駒のおおよその価値（STRONGEST / WEAKEST の選択用） */
function pieceStrength(p: Piece): number {
  if (p.isKing) return 100;
  let v = p.isHisha || p.isKaku ? 8 : p.isPawn ? 1 : (p.abilities || p.custom_ability || p.ability_spec) ? 6 : 4;
  if (p.isPromoted) v += 2;
  return v;
}

function findPieceById(board: Board, id: string): Position | null {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (board[y][x]?.id === id) return { y, x };
  return null;
}

/** 方向に進み、最初に駒があるマスまで（そのマスを含む） */
function ray(board: Board, origin: Position, dy: number, dx: number): Position[] {
  const cells: Position[] = [];
  let y = origin.y + dy;
  let x = origin.x + dx;
  while (inBounds(y, x)) {
    cells.push({ y, x });
    if (board[y][x]) break;
    y += dy;
    x += dx;
  }
  return cells;
}

const DIRS_ORTHO: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIRS_DIAG: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function areaCells(board: Board, area: string, origin: Position, player: Player): Position[] {
  const forward = player === 'sente' ? -1 : 1;
  const around = (c: Position, r: number) => {
    const out: Position[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if ((dy || dx) && inBounds(c.y + dy, c.x + dx)) out.push({ y: c.y + dy, x: c.x + dx });
    }
    return out;
  };
  if (!(NAMED_AREAS as readonly string[]).includes(area)) {
    // 5x5 のマス目（上の行が敵陣側）
    const out: Position[] = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if (area[r * 5 + c] !== '1') continue;
      const dy = player === 'sente' ? r - 2 : 2 - r;
      const dx = player === 'sente' ? c - 2 : 2 - c;
      if (inBounds(origin.y + dy, origin.x + dx)) out.push({ y: origin.y + dy, x: origin.x + dx });
    }
    return out;
  }
  switch (area) {
    case 'SELF': case 'ATTACKER': return [origin];
    case 'ADJACENT': return around(origin, 1);
    case 'RADIUS_2': return around(origin, 2);
    case 'FRONT_LINE': return ray(board, origin, forward, 0);
    case 'CROSS': return DIRS_ORTHO.flatMap(([dy, dx]) => ray(board, origin, dy, dx));
    case 'DIAGONALS': return DIRS_DIAG.flatMap(([dy, dx]) => ray(board, origin, dy, dx));
    case 'LINES_8': return [...DIRS_ORTHO, ...DIRS_DIAG].flatMap(([dy, dx]) => ray(board, origin, dy, dx));
    case 'ROW': return Array.from({ length: SIZE }, (_, x) => ({ y: origin.y, x })).filter(c => c.x !== origin.x);
    case 'COLUMN': return Array.from({ length: SIZE }, (_, y) => ({ y, x: origin.x })).filter(c => c.y !== origin.y);
    case 'ALL': {
      const out: Position[] = [];
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (y !== origin.y || x !== origin.x) out.push({ y, x });
      return out;
    }
    case 'ENEMY_KING_AROUND': {
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const p = board[y][x];
        if (p?.isKing && p.owner !== player) return around({ y, x }, 1);
      }
      return [];
    }
    default: return around(origin, 1);
  }
}

interface ResolvedTarget { pos: Position; id: string | null }

function resolveTargets(board: Board, target: ProgramTarget, origin: Position, player: Player, selfId: string | null): ResolvedTarget[] {
  const cells = areaCells(board, target.area, origin, player);
  const matches = cells.filter(({ y, x }) => {
    const p = board[y][x];
    if (target.area === 'SELF') return true;
    if (target.who === 'EMPTY') return !p;
    if (!p || isObstacle(p) || p.id === selfId) return false;
    if (target.who === 'ENEMY') return p.owner !== player;
    if (target.who === 'ALLY') return p.owner === player;
    return true;
  });
  const dist = (c: Position) => Math.max(Math.abs(c.y - origin.y), Math.abs(c.x - origin.x));
  const byPos = (a: Position, b: Position) => a.y - b.y || a.x - b.x;
  let ordered = [...matches];
  switch (target.pick) {
    case 'NEAREST': ordered.sort((a, b) => dist(a) - dist(b) || byPos(a, b)); break;
    case 'FARTHEST': ordered.sort((a, b) => dist(b) - dist(a) || byPos(a, b)); break;
    case 'STRONGEST': ordered.sort((a, b) => pieceStrength(board[b.y][b.x]!) - pieceStrength(board[a.y][a.x]!) || byPos(a, b)); break;
    case 'WEAKEST': ordered.sort((a, b) => pieceStrength(board[a.y][a.x]!) - pieceStrength(board[b.y][b.x]!) || byPos(a, b)); break;
    case 'RANDOM': ordered = ordered.map(c => ({ c, r: Math.random() })).sort((a, b) => a.r - b.r).map(o => o.c); break;
    default: break;
  }
  if (target.pick !== 'ALL') ordered = ordered.slice(0, target.count);
  return ordered.map(pos => ({ pos, id: board[pos.y][pos.x]?.id ?? null }));
}

function conditionHolds(a: AbilityProgram, board: Board, origin: Position, piece: Piece, player: Player, myHand: number, enemyHand: number): boolean {
  const n = a.condition_value ?? 0;
  const neighbors = () => {
    let enemies = 0;
    let allies = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dy && !dx) continue;
      const y = origin.y + dy;
      const x = origin.x + dx;
      const p = inBounds(y, x) ? board[y][x] : null;
      if (!p || isObstacle(p)) continue;
      if (p.owner === player) allies++; else enemies++;
    }
    return { enemies, allies };
  };
  switch (a.condition) {
    case 'IN_ENEMY_CAMP': return player === 'sente' ? origin.y <= 2 : origin.y >= 6;
    case 'IN_OWN_CAMP': return player === 'sente' ? origin.y >= 6 : origin.y <= 2;
    case 'ENEMIES_NEAR_AT_LEAST': return neighbors().enemies >= n;
    case 'ALLIES_NEAR_AT_LEAST': return neighbors().allies >= n;
    case 'NO_ALLY_NEAR': return neighbors().allies === 0;
    case 'MY_HAND_AT_LEAST': return myHand >= n;
    case 'ENEMY_HAND_AT_LEAST': return enemyHand >= n;
    case 'PROMOTED': return !!piece.isPromoted;
    case 'CHANCE': return Math.random() * 100 < n;
    default: return true;
  }
}

const TILE_TYPES: Record<TileKind, 'FIRE_ZONE' | 'POISON_MUD' | 'ICE_FLOOR' | 'TIME_BOMB' | 'STEALTH_TRAP'> = {
  FIRE: 'FIRE_ZONE', POISON: 'POISON_MUD', ICE: 'ICE_FLOOR', BOMB: 'TIME_BOMB', TRAP: 'STEALTH_TRAP',
};

interface RunState {
  board: Board;
  player: Player;
  piece: Piece;
  /** 能力を持つ駒の現在位置（取られたときは盤上にいないので null） */
  selfPos: Position | null;
  origin: Position;
  name: string;
  logs: Log[];
  captured: Piece[];
  graveyard: Piece[];
  opponentCaptured: Piece[];
  reAction: boolean;
}

/** 既存の applyCoreActionEffect を1回呼ぶ。効果が出たかを返す */
function core(state: RunState, actionKey: string, targetPos: Position, extra: Partial<{ piece: Piece; allowAllies: boolean }> = {}): boolean {
  const triggeredRef = { value: false };
  const reActionRef = { value: false };
  const acting = state.selfPos ?? state.origin;
  applyCoreActionEffect(actionKey, targetPos, state.board, acting, {
    piece: extra.piece ?? state.piece,
    player: state.player,
    from: acting,
    to: acting,
    graveyard: state.graveyard,
    capturedPieces: state.captured,
    opponentCapturedPieces: state.opponentCaptured,
    logs: state.logs,
    triggeredRef,
    reActionRef,
    effectName: state.name,
    currentActingPos: acting,
    // 取られたときは「自分のマス」に取った駒がいる。既存処理は自分のマスへの効果を弾くので、明示的に許可する
    ability: {
      targets: !state.selfPos && targetPos.y === acting.y && targetPos.x === acting.x ? ['SELF'] : [],
      constraints: extra.allowAllies ? ['MUTUAL_DAMAGE'] : [],
    },
  });
  return triggeredRef.value;
}

function log(state: RunState, message: string, type: Log['type'] = 'ability') {
  state.logs.push({ player: state.player, message: `【${state.name}】${message}`, type });
}

/** 敵の能力から守られているか（防護中）。守られていればログを残して true */
function guarded(state: RunState, victim: Piece, pos: Position): boolean {
  if (victim.owner !== state.player && victim.hasAbsoluteGuard) {
    log(state, `${victim.word} (${getCellLabel(pos.y, pos.x)}) は防護中のため効果を受けませんでした。`);
    return true;
  }
  return false;
}

function slide(board: Board, from: Position, dy: number, dx: number, steps: number, stopAt?: Position): Position {
  let cur = from;
  for (let i = 0; i < steps; i++) {
    const next = { y: cur.y + dy, x: cur.x + dx };
    if (!inBounds(next.y, next.x) || board[next.y][next.x]) break;
    if (stopAt && next.y === stopAt.y && next.x === stopAt.x) break;
    cur = next;
  }
  if (cur !== from) {
    board[cur.y][cur.x] = board[from.y][from.x];
    board[from.y][from.x] = null;
  }
  return cur;
}

/** 1つの効果を1つの対象に適用する。効果が出たら true */
function applyEffect(state: RunState, effect: ProgramEffect, target: ResolvedTarget): boolean {
  const { board } = state;
  const value = effect.value ?? 1;
  let pos = target.pos;
  if (target.id) {
    const found = findPieceById(board, target.id);
    if (!found) return false; // 前の効果で消えた
    pos = found;
  }
  const victim = board[pos.y][pos.x];
  const label = victim ? `${victim.word} (${getCellLabel(pos.y, pos.x)})` : getCellLabel(pos.y, pos.x);
  const setVictim = (patch: Partial<Piece>) => { board[pos.y][pos.x] = { ...victim!, ...patch }; };
  const enemyVictim = !!victim && victim.owner !== state.player;

  switch (effect.op) {
    case 'DESTROY':
    case 'CAPTURE':
    case 'TRANSFORM_PAWN':
      if (!victim || (enemyVictim && guarded(state, victim, pos))) return false;
      return core(state, effect.op, pos, { allowAllies: !enemyVictim });

    case 'PUSH':
    case 'PULL': {
      if (!victim || victim.isKing || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos))) return false;
      const center = state.selfPos ?? state.origin;
      const dy = Math.sign(pos.y - center.y);
      const dx = Math.sign(pos.x - center.x);
      if (!dy && !dx) return false;
      const end = effect.op === 'PUSH' ? slide(board, pos, dy, dx, value) : slide(board, pos, -dy, -dx, value, center);
      if (end === pos) return false;
      log(state, `${label} を ${getCellLabel(end.y, end.x)} へ${effect.op === 'PUSH' ? '押し出しました' : '引き寄せました'}！`);
      return true;
    }

    case 'SWAP': {
      const self = state.selfPos;
      if (!self || !victim || victim.isKing || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos))) return false;
      board[pos.y][pos.x] = board[self.y][self.x];
      board[self.y][self.x] = victim;
      state.selfPos = pos;
      log(state, `${label} と位置を入れ替えました！`);
      return true;
    }

    case 'TELEPORT': {
      const self = state.selfPos;
      if (!self || victim) return false;
      board[pos.y][pos.x] = board[self.y][self.x];
      board[self.y][self.x] = null;
      state.selfPos = pos;
      log(state, `${getCellLabel(pos.y, pos.x)} へ瞬間移動しました！`);
      return true;
    }

    case 'FREEZE':
      if (!victim || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos))) return false;
      setVictim({ isFrozen: true, frozenDuration: value });
      log(state, `${label} を${value}手番凍結させました！`);
      return true;

    case 'STUN':
      if (!victim || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos))) return false;
      setVictim({ stunTurnsRemaining: Math.max(victim.stunTurnsRemaining ?? 0, value) });
      log(state, `${label} を${value}手番麻痺させました！`);
      return true;

    case 'SILENCE':
      if (!victim || victim.isKing || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos))) return false;
      setVictim({ isSilenced: true, silenceDuration: value });
      log(state, `${label} の能力を${value}手番封じました！`);
      return true;

    case 'CONTROL':
      if (!victim || !enemyVictim || victim.isKing || isObstacle(victim) || guarded(state, victim, pos)) return false;
      // 手番終了ごとに1減り、0で元の持ち主に戻る。今の手番の終わりの分を足す
      setVictim({ isMindControlled: true, originalPlayer: victim.owner, owner: state.player, isStealth: false, controlDuration: value + 1 });
      log(state, `${label} を${value}手番のあいだ寝返らせました！`);
      return true;

    case 'DOOM':
      if (!victim || victim.isKing || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos))) return false;
      setVictim({ deathCountdown: value });
      log(state, `${label} に${value}手番後に消滅する呪いをかけました！`);
      return true;

    case 'SHIELD':
      if (!victim || enemyVictim || isObstacle(victim)) return false;
      setVictim({ hasShield: true });
      log(state, `${label} に1回だけ攻撃を防ぐ盾を付けました！`);
      return true;

    case 'GUARD':
      if (!victim || enemyVictim || isObstacle(victim)) return false;
      // 持ち主の手番終了ごとに1減るので、今の手番の終わりの分を足す
      setVictim({ hasAbsoluteGuard: true, guardDuration: value + 1 });
      log(state, `${label} は${value}手番、能力による効果を受けなくなりました！`);
      return true;

    case 'STEALTH': {
      const self = state.selfPos;
      if (!self) return false;
      const me = board[self.y][self.x]!;
      board[self.y][self.x] = { ...me, isStealth: true, isRevealed: false };
      log(state, `${me.word} が姿を隠しました！`);
      return true;
    }

    case 'CLEANSE':
      if (!victim || enemyVictim || isObstacle(victim)) return false;
      setVictim({
        isFrozen: false, frozenDuration: 0, stunTurnsRemaining: 0, isSilenced: false, silenceDuration: 0,
        deathCountdown: 0, isInverted: false,
      });
      log(state, `${label} の状態異常を治しました！`);
      return true;

    case 'EXTRA_ACTION':
      if (state.reAction) return false;
      state.reAction = true;
      log(state, 'もう一度行動できます！');
      return true;

    case 'SPAWN': {
      if (victim) return false;
      const template = {
        ...state.piece,
        spawn_piece_name: `${state.piece.word}の分身`,
        spawn_config: { spawn_piece_name: `${state.piece.word}の分身`, max_limit: 6, spawn_range_geometry: null },
      };
      return core(state, 'SPAWN_TOKEN', pos, { piece: template });
    }

    case 'WALL': {
      if (victim || !core(state, 'WALL_CREATE', pos)) return false;
      const wall = board[pos.y][pos.x];
      if (wall) board[pos.y][pos.x] = { ...wall, duration: value };
      return true;
    }

    case 'TILE': {
      // 敵のいるマス・空きマス・自分自身のマス（足元に残す）に置ける。味方の駒がいるマスには置かない
      if (victim && !enemyVictim && victim.id !== state.piece.id) return false;
      const kind = effect.tile ?? 'FIRE';
      queueTilePlacement(pos.y, pos.x, {
        effectType: TILE_TYPES[kind],
        duration: value,
        ownerPlayer: state.player,
        isStealth: kind === 'TRAP',
      });
      log(state, `${getCellLabel(pos.y, pos.x)} に地形効果を置きました！`);
      return true;
    }

    case 'STEAL_HAND': {
      let stolen = 0;
      for (let i = 0; i < value; i++) if (core(state, 'STEAL_HAND', state.selfPos ?? state.origin)) stolen++;
      return stolen > 0;
    }

    default:
      return false;
  }
}

/**
 * イベントに反応する能力をすべて実行する。
 * ON_TAKEN では能力を持つ駒はすでに盤上にいないので deadPiece で渡し、position は取られたマス（取った駒がいる）にする。
 */
export function runAbilityPrograms(
  board: Board,
  position: [number, number],
  event: ProgramTriggerEvent,
  player: Player,
  capturedPieces: Piece[],
  graveyard: Piece[] | undefined,
  opponentCapturedPieces: Piece[] | undefined,
  deadPiece?: Piece,
): ProgramRunResult {
  const origin = { y: position[0], x: position[1] };
  const boardPiece = board[origin.y][origin.x];
  const piece = deadPiece ?? boardPiece;
  const empty: ProgramRunResult = { board, capturedPieces, opponentCapturedPieces, graveyard: graveyard ?? [], logs: [], triggered: false, reAction: false };
  if (!piece?.abilities?.length || piece.isSilenced) return empty;

  const nextBoard = board.map(row => [...row]);
  const onBoard = !deadPiece || boardPiece?.id === deadPiece.id;
  const state: RunState = {
    board: nextBoard,
    player,
    piece,
    selfPos: onBoard ? origin : null,
    origin,
    name: piece.effect_name,
    logs: [],
    captured: [],
    graveyard: [],
    opponentCaptured: opponentCapturedPieces ? [...opponentCapturedPieces] : [],
    reAction: false,
  };
  const cooldowns = [...(piece.abilityCooldowns ?? piece.abilities.map(() => 0))];
  let anyTriggered = false;

  piece.abilities.forEach((ability, index) => {
    if (!abilityMatchesEvent(ability, event) || (cooldowns[index] ?? 0) > 0) return;
    const center = state.selfPos ?? state.origin;
    if (!conditionHolds(ability, nextBoard, center, piece, player, capturedPieces.length, state.opponentCaptured.length)) return;
    // 取られたときは自分自身への効果は意味がない
    if (!state.selfPos && ability.target.area === 'SELF') return;

    state.name = ability.name;
    const targets = resolveTargets(nextBoard, ability.target, center, player, piece.id);
    let triggered = false;
    for (const effect of ability.effects) {
      const selfOnly = effect.op === 'STEALTH' || effect.op === 'EXTRA_ACTION' || effect.op === 'STEAL_HAND';
      if (selfOnly) {
        if (applyEffect(state, effect, { pos: state.selfPos ?? center, id: null })) triggered = true;
        continue;
      }
      for (const target of targets) if (applyEffect(state, effect, target)) triggered = true;
    }
    if (triggered) {
      anyTriggered = true;
      cooldowns[index] = ability.cooldown;
    } else if (targets.length === 0) {
      state.logs.push({ player, message: `【${ability.name}】対象がいなかったため不発でした。`, type: 'system' });
    }
  });

  // 充填手番を駒に書き戻す（盤上にいる場合）
  if (anyTriggered && state.selfPos) {
    const me = nextBoard[state.selfPos.y][state.selfPos.x];
    if (me && me.id === piece.id) nextBoard[state.selfPos.y][state.selfPos.x] = { ...me, abilityCooldowns: cooldowns };
  }

  return {
    board: nextBoard,
    capturedPieces: [...capturedPieces, ...state.captured],
    opponentCapturedPieces: state.opponentCaptured,
    graveyard: [...(graveyard ?? []), ...state.graveyard],
    logs: state.logs,
    triggered: anyTriggered,
    reAction: state.reAction,
  };
}

/** 手番の開始時に、各能力の充填手番を1つ減らす（99 = 1ゲーム1回はそのまま） */
export function tickAbilityCooldowns(piece: Piece): Piece {
  if (!piece.abilityCooldowns?.some(c => c > 0 && c < 99)) return piece;
  return { ...piece, abilityCooldowns: piece.abilityCooldowns.map(c => (c > 0 && c < 99 ? c - 1 : c)) };
}
