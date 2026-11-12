// 能力プログラム（v2, shared/abilityProgram.ts）の実行エンジン
// 駒が abilities を持っている場合、gameLogic の applyAutomatedEffect / isTriggerMatching からここが呼ばれる。
// 状態異常の持続（凍結・麻痺・封印・洗脳・死の宣告・防護）は既存の手番終了処理（App.tsx）がそのまま減らすので、
// ここでは駒の状態を書き換えるだけにする。消滅・捕獲・分身・壁などは既存の applyCoreActionEffect に任せ、
// 墓地送り・道連れ・死亡時能力などの既存ルールとの整合を保つ。
import type { Board, GameLog, Piece, Player, Position, TileEffectType } from './types';
import type { AbilityProgram, ProgramEffect, ProgramTarget, TileKind } from '../shared/abilityProgram';
import { NAMED_AREAS, TILE_LABELS } from '../shared/abilityProgram';
import { applyCoreActionEffect, getCellLabel, queueTilePlacement } from './gameLogic';

export type ProgramTriggerEvent = 'ON_MOVE' | 'TURN_START' | 'ON_APPROACH' | 'ON_TAKEN' | 'TURN_END' | 'ON_DEATH' | 'ON_PROMOTE' | 'ON_CAPTURE' | 'ON_DROP' | 'ON_ALLY_TAKEN';

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
/** ランダム型で「1ゲーム1回」の能力を引いた後、残りの能力が使えるようになるまでの手番 */
const RANDOM_AFTER_ONCE_COOLDOWN = 4;
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

function isNextToEnemyKing(board: Board, pos: Position, player: Player): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const y = pos.y + dy;
    const x = pos.x + dx;
    const p = inBounds(y, x) ? board[y][x] : null;
    if (p?.isKing && p.owner !== player) return true;
  }
  return false;
}

/** pos が player 自身の玉の隣か（入れ替えで敵駒を自玉の隣に呼び込まないための確認） */
function isNextToOwnKing(board: Board, pos: Position, player: Player): boolean {
  return isNextToEnemyKing(board, pos, player === 'sente' ? 'gote' : 'sente');
}

/** 駒のおおよその価値（STRONGEST / WEAKEST の選択用）。空きマスは 0（空きマスを対象に「最も強い」を選ぶ能力もある） */
function pieceStrength(p: Piece | null): number {
  if (!p) return 0;
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

/**
 * excludeAdjacent: 引き寄せる能力では、すでに隣にいる駒は動かせないので対象にしない
 * （「最も近い敵」が隣の駒になって不発になるのを防ぐ）
 */
function resolveTargets(board: Board, target: ProgramTarget, origin: Position, player: Player, selfId: string | null, excludeAdjacent = false): ResolvedTarget[] {
  const cells = areaCells(board, target.area, origin, player)
    .filter(c => !excludeAdjacent || Math.max(Math.abs(c.y - origin.y), Math.abs(c.x - origin.x)) > 1);
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
    case 'STRONGEST': ordered.sort((a, b) => pieceStrength(board[b.y][b.x]) - pieceStrength(board[a.y][a.x]) || byPos(a, b)); break;
    case 'WEAKEST': ordered.sort((a, b) => pieceStrength(board[a.y][a.x]) - pieceStrength(board[b.y][b.x]) || byPos(a, b)); break;
    case 'RANDOM': ordered = ordered.map(c => ({ c, r: Math.random() })).sort((a, b) => a.r - b.r).map(o => o.c); break;
    default: break;
  }
  // 性質「挑発」: 敵の能力は、届く範囲にいる挑発の駒を先に狙う
  if (target.pick !== 'ALL' && target.area !== 'SELF') {
    const taunts = ordered.filter(c => { const p = board[c.y][c.x]; return !!p && p.owner !== player && p.trait?.kind === 'TAUNT'; });
    if (taunts.length) ordered = [...taunts, ...ordered.filter(c => !taunts.includes(c))];
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

const TILE_TYPES: Record<TileKind, TileEffectType> = {
  FIRE: 'FIRE_ZONE', POISON: 'POISON_MUD', ICE: 'ICE_FLOOR', BOMB: 'TIME_BOMB', TRAP: 'STEALTH_TRAP',
  HOLY: 'SANCTUARY', SEAL: 'SEAL_ZONE', SPRING: 'SPRING_FLOOR',
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
  /** 性質「反射」でこの発動を跳ね返した駒（同じ発動の残りの効果も受けない） */
  reflected?: Set<string>;
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

/** 性質「反射」で使った駒に返す効果 */
const REFLECTED: Record<string, (value: number) => Partial<Piece>> = {
  FREEZE: v => ({ isFrozen: true, frozenDuration: v }),
  STUN: v => ({ stunTurnsRemaining: v }),
  SILENCE: v => ({ isSilenced: true, silenceDuration: v }),
  DOOM: v => ({ deathCountdown: v }),
};

/**
 * 敵の能力から守られているか。守られていればログを残して true
 *   - 防護中（GUARD）
 *   - 性質「重量」: 押す・引く・入れ替えを受けない
 *   - 性質「反射」: 1回だけ受けずに跳ね返す
 */
function guarded(state: RunState, victim: Piece, pos: Position, op?: string, value = 1): boolean {
  if (victim.owner === state.player) return false;
  if (victim.hasAbsoluteGuard) {
    log(state, `${victim.word} (${getCellLabel(pos.y, pos.x)}) は防護中のため効果を受けませんでした。`);
    return true;
  }
  const trait = victim.trait?.kind;
  if (trait === 'HEAVY' && (op === 'PUSH' || op === 'PULL' || op === 'SWAP')) {
    log(state, `${victim.word} (${getCellLabel(pos.y, pos.x)}) は重すぎてびくともしません！`);
    return true;
  }
  if (state.reflected?.has(victim.id)) return true;
  if (trait === 'REFLECT' && !victim.traitUsed) {
    (state.reflected ??= new Set()).add(victim.id);
    state.board[pos.y][pos.x] = { ...victim, traitUsed: true };
    const back = op ? REFLECTED[op] : undefined;
    const self = state.selfPos;
    const me = self ? state.board[self.y][self.x] : null;
    if (back && self && me && !me.isKing && me.owner === state.player) {
      state.board[self.y][self.x] = { ...me, ...back(value) };
      log(state, `${victim.word} が能力を跳ね返した！ ${me.word} が自分の能力を受けました！`);
    } else {
      log(state, `${victim.word} (${getCellLabel(pos.y, pos.x)}) が能力を跳ね返しました！`);
    }
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
      if (!victim || (enemyVictim && guarded(state, victim, pos, effect.op, value))) return false;
      return core(state, effect.op, pos, { allowAllies: !enemyVictim });

    case 'PUSH':
    case 'PULL': {
      if (!victim || victim.isKing || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos, effect.op, value))) return false;
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
      if (!self || !victim || victim.isKing || isObstacle(victim)) return false;
      // 敵駒を自分の玉の隣へ呼び込む入れ替えはしない（入れ替えた直後に玉を取られてしまう。自動対局で2手目に玉を取られる対局が出た）
      if (enemyVictim && isNextToOwnKing(board, self, state.player)) return false;
      if (enemyVictim && guarded(state, victim, pos, effect.op, value)) return false;
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

    // 玉将は凍結・麻痺しない（動けない玉はすぐ取られ、数手で決着してしまう。自動対局で5〜7手の決着が出た）
    case 'FREEZE':
      if (!victim || victim.isKing || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos, effect.op, value))) return false;
      setVictim({ isFrozen: true, frozenDuration: value });
      log(state, `${label} を${value}手番凍結させました！`);
      return true;

    case 'STUN':
      if (!victim || victim.isKing || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos, effect.op, value))) return false;
      setVictim({ stunTurnsRemaining: Math.max(victim.stunTurnsRemaining ?? 0, value) });
      log(state, `${label} を${value}手番麻痺させました！`);
      return true;

    case 'SILENCE':
      if (!victim || victim.isKing || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos, effect.op, value))) return false;
      setVictim({ isSilenced: true, silenceDuration: value });
      log(state, `${label} の能力を${value}手番封じました！`);
      return true;

    case 'CONTROL':
      if (!victim || !enemyVictim || victim.isKing || isObstacle(victim) || guarded(state, victim, pos, effect.op, value)) return false;
      // 手番終了ごとに1減り、0で元の持ち主に戻る。今の手番の終わりの分を足す
      setVictim({ isMindControlled: true, originalPlayer: victim.owner, owner: state.player, isStealth: false, controlDuration: value + 1 });
      log(state, `${label} を${value}手番のあいだ寝返らせました！`);
      return true;

    case 'DOOM':
      if (!victim || victim.isKing || isObstacle(victim) || (enemyVictim && guarded(state, victim, pos, effect.op, value))) return false;
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
      // 敵玉のすぐ隣に分身を出すと、出した瞬間に玉を取れる位置に駒が湧く（自動対局で勝率100%）
      if (victim || isNextToEnemyKing(board, pos, state.player)) return false;
      const template = {
        ...state.piece,
        spawn_piece_name: `${state.piece.word}の分身`,
        spawn_config: { spawn_piece_name: `${state.piece.word}の分身`, max_limit: 6, spawn_range_geometry: null },
      };
      return core(state, 'SPAWN_TOKEN', pos, { piece: template });
    }

    case 'WALL': {
      // 敵玉の周り8マスには壁を置かない。玉を閉じ込めると、どの範囲指定でも即勝ちに近くなる（自動対局で勝率93%）
      if (victim || isNextToEnemyKing(board, pos, state.player) || !core(state, 'WALL_CREATE', pos)) return false;
      const wall = board[pos.y][pos.x];
      if (wall) board[pos.y][pos.x] = { ...wall, duration: value };
      return true;
    }

    case 'TILE': {
      // 敵のいるマス・空きマス・自分自身のマス（足元に残す）に置ける。味方の駒がいるマスには置かない
      // （聖域だけは味方を守る地形なので、味方の足元に置ける。敵の足元には置かない）
      const holy = effect.tile === 'HOLY';
      if (victim && !enemyVictim && victim.id !== state.piece.id && !holy) return false;
      if (holy && enemyVictim) return false;
      // 敵玉の周りに罠などを敷き詰めると玉が逃げられなくなる（自動対局で罠が勝率82%）
      if (isNextToEnemyKing(board, pos, state.player)) return false;
      const kind = effect.tile ?? 'FIRE';
      queueTilePlacement(pos.y, pos.x, {
        effectType: TILE_TYPES[kind],
        duration: value,
        ownerPlayer: state.player,
        isStealth: kind === 'TRAP',
      });
      log(state, `${getCellLabel(pos.y, pos.x)} に${TILE_LABELS[kind]}を置きました！`);
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

  // 代償「代価」の能力は、捨てる持ち駒が足りなければ使えない
  let handCost = 0;
  const canPay = (ability: AbilityProgram) =>
    ability.drawback?.kind !== 'HAND_COST' || capturedPieces.length - handCost >= (ability.drawback.value ?? 1);
  const ready = (ability: AbilityProgram, index: number) =>
    abilityMatchesEvent(ability, event) && (cooldowns[index] ?? 0) === 0 && canPay(ability)
    && conditionHolds(ability, nextBoard, state.selfPos ?? state.origin, piece, player, capturedPieces.length, state.opponentCaptured.length);
  // ランダム型（ガチャ・サイコロなど）は、使える能力のうち1つだけをランダムに選んで発動する
  let chosen: number | null = null;
  if (piece.ability_mode === 'RANDOM') {
    const candidates = piece.abilities.map((a, i) => (ready(a, i) ? i : -1)).filter(i => i >= 0);
    if (candidates.length === 0) return empty;
    chosen = candidates[Math.floor(Math.random() * candidates.length)];
  }

  piece.abilities.forEach((ability, index) => {
    if (chosen !== null && index !== chosen) return;
    if (!ready(ability, index)) return;
    const center = state.selfPos ?? state.origin;
    // 取られたときは自分自身への効果は意味がない
    if (!state.selfPos && ability.target.area === 'SELF') return;

    state.name = ability.name;
    const targets = resolveTargets(nextBoard, ability.target, center, player, piece.id, ability.effects[0]?.op === 'PULL');
    let triggered = false;
    // 範囲に効く効果（押す・凍らせるなど）と、自分に効く効果（隠れる・もう1回・持ち駒を奪う）に分ける。
    // 範囲に効く効果がある能力は、範囲に対象がいなければ丸ごと不発。自分に効く効果も、範囲の効果が実際に効いたときだけ出す
    // （以前は「周りの敵を押す＋もう1回」で、周りに敵がいなくても「もう1回」だけ発動していた）
    const isSelfOnly = (e: ProgramEffect) => e.op === 'STEALTH' || e.op === 'EXTRA_ACTION' || e.op === 'STEAL_HAND';
    const ranged = ability.effects.filter(e => !isSelfOnly(e));
    const selfEffects = ability.effects.filter(isSelfOnly);
    let rangedHit = false;
    for (const effect of ranged) {
      for (const target of targets) if (applyEffect(state, effect, target)) rangedHit = true;
    }
    if (rangedHit) triggered = true;
    if (ranged.length === 0 || rangedHit) {
      for (const effect of selfEffects) if (applyEffect(state, effect, { pos: state.selfPos ?? center, id: null })) triggered = true;
    }
    if (triggered) {
      anyTriggered = true;
      cooldowns[index] = ability.cooldown;
      // 代償を払う（発動したときだけ）
      const drawback = ability.drawback;
      const self = state.selfPos;
      const me = self ? nextBoard[self.y][self.x] : null;
      const meOnBoard = !!me && me.id === piece.id;
      if (drawback?.kind === 'RECOIL' && meOnBoard) {
        // 動けない手番は持ち主の手番の終わりに1減るので、今の手番の分を足す
        const turns = drawback.value ?? 1;
        // ただし仇討ちは相手の手番に起きるので、足さない（足すと1手番多く止まる）
        const stun = event === 'ON_ALLY_TAKEN' ? turns : turns + 1;
        nextBoard[self!.y][self!.x] = { ...me!, stunTurnsRemaining: Math.max(me!.stunTurnsRemaining ?? 0, stun) };
        state.logs.push({ player, message: `【反動】${me!.word} は反動で${turns}手番動けません。`, type: 'ability' });
      } else if (drawback?.kind === 'SACRIFICE' && meOnBoard && !me!.isKing) {
        nextBoard[self!.y][self!.x] = null;
        state.graveyard.push({ ...me! });
        state.selfPos = null;
        state.logs.push({ player, message: `【捨て身】${me!.word} は力を使い果たして消えました。`, type: 'ability' });
      } else if (drawback?.kind === 'HAND_COST') {
        handCost += drawback.value ?? 1;
        state.logs.push({ player, message: `【代価】持ち駒を${drawback.value ?? 1}枚捨てました。`, type: 'ability' });
      }
      if (chosen !== null) {
        // ランダム型は「1回引いたら、また引けるまで待つ」。充填中の間はどの能力も選ばれない。
        // 能力ごとに別々に充填すると、どれかが毎手番使えてしまい強すぎた（自動対局で勝率76%）。
        // 1ゲーム1回の大当たりを引いた後は、残りの能力を4手番待たせる
        const shared = ability.cooldown >= 99 ? RANDOM_AFTER_ONCE_COOLDOWN : ability.cooldown;
        piece.abilities!.forEach((_, i) => {
          if (i !== index && (cooldowns[i] ?? 0) < 99) cooldowns[i] = Math.max(cooldowns[i] ?? 0, shared);
        });
      }
    } else if (ranged.length > 0) {
      state.logs.push({ player, message: `【${ability.name}】${targets.length === 0 ? '範囲に対象がいなかった' : '効果を受ける駒がいなかった'}ため不発でした。`, type: 'system' });
    }
  });

  // 充填手番を駒に書き戻す（盤上にいる場合）
  if (anyTriggered && state.selfPos) {
    const me = nextBoard[state.selfPos.y][state.selfPos.x];
    if (me && me.id === piece.id) nextBoard[state.selfPos.y][state.selfPos.x] = { ...me, abilityCooldowns: cooldowns };
  }

  // 代価で捨てる持ち駒は、元から持っていた駒の新しい方から
  const hand = handCost > 0 ? capturedPieces.slice(0, Math.max(0, capturedPieces.length - handCost)) : capturedPieces;
  return {
    board: nextBoard,
    capturedPieces: [...hand, ...state.captured],
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

/** 盤面を変えずに、能力がどこに効くかを先読みした結果（画面の「どこに置けば発動するか」表示用） */
export interface ProgramPreview {
  /** yes = 発動する / maybe = 確率や無作為の選び方しだい / no = 発動しない */
  status: 'yes' | 'maybe' | 'no';
  /** 効果を受けるマス（無作為に選ぶ能力は、選ばれうるマスすべて） */
  targets: Position[];
}

/** 先読み用: その効果がそのマスに実際に効きうるか（applyEffect の前提条件のおおまかな写し） */
function couldAffect(op: string, cell: Piece | null, player: Player, self: Piece, tile?: string, board: Board = [], selfAt: Position | null = null): boolean {
  const enemy = !!cell && cell.owner !== player;
  if (cell && isObstacle(cell)) return false;
  if (enemy && cell!.hasAbsoluteGuard) return false;
  if (enemy && cell!.trait?.kind === 'REFLECT' && !cell!.traitUsed) return true; // 跳ね返されるが「発動」はする
  switch (op) {
    case 'SPAWN': case 'WALL': case 'TELEPORT': return !cell;
    case 'TILE': return tile === 'HOLY' ? !enemy : !cell || enemy || cell.id === self.id;
    case 'SHIELD': case 'GUARD': case 'CLEANSE': return !!cell && !enemy;
    case 'CONTROL': return enemy && !cell!.isKing;
    case 'DESTROY': case 'CAPTURE': case 'TRANSFORM_PAWN': return !!cell && !cell.isKing;
    case 'PUSH': case 'PULL': return !!cell && !cell.isKing && !(enemy && cell.trait?.kind === 'HEAVY');
    case 'SWAP': return !!cell && !cell.isKing && !(enemy && cell.trait?.kind === 'HEAVY') && !(enemy && selfAt !== null && isNextToOwnKing(board, selfAt, player));
    default: return !!cell && !cell.isKing; // 凍結・麻痺・封印・呪い
  }
}

/**
 * 能力を実際には発動させずに、position にいる駒がイベントで発動するか・どのマスに効くかを返す。
 * 判定は実際の発動（runAbilityPrograms）と同じ範囲・条件・対象の選び方を使う
 */
export function previewPrograms(board: Board, position: [number, number], event: ProgramTriggerEvent, player: Player, myHand: number, enemyHand: number): ProgramPreview {
  const origin = { y: position[0], x: position[1] };
  const piece = board[origin.y]?.[origin.x];
  const none: ProgramPreview = { status: 'no', targets: [] };
  if (!piece?.abilities?.length || piece.isSilenced) return none;
  let status: ProgramPreview['status'] = 'no';
  const cells = new Map<string, Position>();
  piece.abilities.forEach((ability, index) => {
    if (!abilityMatchesEvent(ability, event) || (piece.abilityCooldowns?.[index] ?? 0) > 0) return;
    if (ability.drawback?.kind === 'HAND_COST' && myHand < (ability.drawback.value ?? 1)) return;
    const chance = ability.condition === 'CHANCE';
    if (!chance && !conditionHolds(ability, board, origin, piece, player, myHand, enemyHand)) return;
    const isSelfOnly = (e: ProgramEffect) => e.op === 'STEALTH' || e.op === 'EXTRA_ACTION' || e.op === 'STEAL_HAND';
    const ranged = ability.effects.some(e => !isSelfOnly(e));
    // 持ち駒を奪うだけの能力は、相手の持ち駒がなければ何も起きない
    if (!ranged && ability.effects.every(e => e.op === 'STEAL_HAND') && enemyHand === 0) return;
    let found: Position[] = [origin];
    let random = false;
    if (ranged) {
      // 無作為に選ぶ能力は、選ばれうる候補をすべて見せる（実際にはこのうち count 体）
      random = ability.target.pick === 'RANDOM';
      const target = random ? { ...ability.target, pick: 'ALL' as const } : ability.target;
      found = resolveTargets(board, target, origin, player, piece.id, ability.effects[0]?.op === 'PULL').map(t => t.pos)
        // 効果がそのマスに効きうるものだけ（玉・防護中・空きマスなど、効かない相手は外す）
        .filter(c => ability.effects.some(e => !isSelfOnly(e) && couldAffect(e.op, board[c.y][c.x], player, piece, e.tile, board, origin)
          // 分身・壁・地形は敵玉のすぐ隣には置けない（実際の発動と同じ制限）
          && !(['SPAWN', 'WALL', 'TILE'].includes(e.op) && isNextToEnemyKing(board, c, player))));
      if (found.length === 0) return;
      random = random && found.length > ability.target.count;
    }
    for (const c of found) cells.set(`${c.y},${c.x}`, c);
    const s = chance || random || piece.ability_mode === 'RANDOM' ? 'maybe' : 'yes';
    if (status !== 'yes') status = s;
  });
  return { status, targets: status === 'no' ? [] : [...cells.values()] };
}
