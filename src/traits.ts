// 性質（shared/abilityProgram.ts の TRAIT_SPECS）の動き。
// 対人・CPU・オンライン・自動対局（scripts/simulate-games.ts）で同じ動きになるよう、盤面を受け取って返す関数だけにしている。
//   - 動かす前: canCommand（暴れ馬・休み中の鈍足は操作できない）/ fickleTarget（気まぐれ）
//   - 動かした後: markMoved（鈍足の休み）/ applyCaptureTraits（不死身・分裂・成長。gameLogic の executeMove から呼ぶ）
//   - 手番の終わり: chooseWildMove（暴れ馬の行き先）/ endOfTurnTraits（ワープ癖・寿命・鈍足・臆病・透明）
//   - 能力を受けるとき: 挑発・反射・重量は src/abilityEngine.ts、飛行は gameLogic の applyTileEffects
import type { Board, GameLog, Piece, Player } from './types';
import { TRAIT_SPECS, type TraitKind } from '../shared/abilityProgram';

const SIZE = 9;
const inBounds = (y: number, x: number) => y >= 0 && y < SIZE && x >= 0 && x < SIZE;
const opponent = (p: Player): Player => (p === 'sente' ? 'gote' : 'sente');
const isObstacle = (p: Piece | null) => !!p && (p.type === 'wall' || p.type === 'hazard' || !!p.isObstacle);

export function traitKind(p: Piece | null | undefined): TraitKind | null {
  return p?.trait?.kind ?? null;
}

export function traitLabel(p: Piece): string {
  const kind = traitKind(p);
  return kind ? TRAIT_SPECS[kind].label : '';
}

/** プレイヤーが選んで動かせるか（暴れ馬は操作できない。鈍足は休み中なら動かせない） */
export function canCommand(p: Piece | null): boolean {
  if (!p) return false;
  const kind = traitKind(p);
  if (kind === 'WILD') return false;
  if (kind === 'SLOW' && (p.traitRest ?? 0) > 0) return false;
  return true;
}

/** 操作できない理由（画面の案内用） */
export function commandBlockReason(p: Piece): string | null {
  const kind = traitKind(p);
  if (kind === 'WILD') return `「${p.word}」は暴れ馬なので操作できません（手番の終わりに勝手に動きます）`;
  if (kind === 'SLOW' && (p.traitRest ?? 0) > 0) return `「${p.word}」は鈍足のため、この手番は休みです`;
  return null;
}

/** 気まぐれ: 3回に1回くらい、指示とは別の動けるマスへ動く */
export const FICKLE_CHANCE = 0.33;
export function fickleTarget(p: Piece, chosen: [number, number], validMoves: [number, number][], board: Board, random: () => number = Math.random): [number, number] {
  if (traitKind(p) !== 'FICKLE' || random() >= FICKLE_CHANCE) return chosen;
  const others = validMoves.filter(([y, x]) => (y !== chosen[0] || x !== chosen[1]) && board[y][x]?.owner !== p.owner && !board[y][x]?.isKing);
  return others.length ? others[Math.floor(random() * others.length)] : chosen;
}

/** 動いた後の印（鈍足は次の自分の手番を休む。手番の終わりに1ずつ減るので2を入れる） */
export function markMoved(board: Board, to: [number, number]): Board {
  const p = board[to[0]][to[1]];
  if (!p || traitKind(p) !== 'SLOW') return board;
  const next = board.map(r => [...r]);
  next[to[0]][to[1]] = { ...p, traitRest: 2 };
  return next;
}

const PIECE_VALUE = (p: Piece | null) => (!p ? 0 : p.isKing ? 1000 : p.isHisha || p.isKaku ? 90 : p.isPawn ? 10 : 50);

/** 暴れ馬の行き先: 取れる敵がいれば一番価値の高い敵を取り、いなければ一番近い敵へ近づく */
export function chooseWildMove(board: Board, from: [number, number], validMoves: [number, number][], random: () => number = Math.random): [number, number] | null {
  const me = board[from[0]][from[1]];
  if (!me) return null;
  const legal = validMoves.filter(([y, x]) => board[y][x]?.owner !== me.owner && !isObstacle(board[y][x]));
  if (!legal.length) return null;
  const captures = legal.filter(([y, x]) => board[y][x] && board[y][x]!.owner !== me.owner);
  if (captures.length) return captures.reduce((best, c) => (PIECE_VALUE(board[c[0]][c[1]]) > PIECE_VALUE(board[best[0]][best[1]]) ? c : best));
  const enemies: [number, number][] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (board[y][x] && board[y][x]!.owner === opponent(me.owner) && !isObstacle(board[y][x])) enemies.push([y, x]);
  const dist = ([y, x]: [number, number]) => Math.min(...enemies.map(([ey, ex]) => Math.max(Math.abs(ey - y), Math.abs(ex - x))), 99);
  const best = Math.min(...legal.map(dist));
  const closest = legal.filter(m => dist(m) === best);
  return closest[Math.floor(random() * closest.length)];
}

/** 取ったとき・取られたときの性質（executeMove の結果に後から当てはめる） */
export function applyCaptureTraits(
  board: Board,
  captured: Piece[],
  to: [number, number],
  player: Player,
): { board: Board; captured: Piece[]; logs: Omit<GameLog, 'id' | 'timestamp'>[] } {
  let next = board;
  const logs: Omit<GameLog, 'id' | 'timestamp'>[] = [];
  const kept: Piece[] = [];
  for (const cap of captured) {
    // 不死身: 1回だけ、取られても自陣の空きマスによみがえる（持ち駒にはならない）
    if (traitKind(cap) === 'UNDYING' && !cap.traitUsed && !cap.isKing) {
      const owner = opponent(player);
      const cell = findHomeCell(next, owner);
      if (cell) {
        next = next === board ? board.map(r => [...r]) : next;
        next[cell[0]][cell[1]] = { ...cap, owner, isPromoted: false, traitUsed: true, coolDownTurnsRemaining: 0 };
        logs.push({ player: owner, message: `【不死身】「${cap.word}」は倒れず、自陣によみがえりました！`, type: 'ability' });
        continue;
      }
    }
    // 分裂: 1回だけ、取られた場所の隣の空きマスに分身が残る（本体は普通に取られる）
    if (traitKind(cap) === 'SPLIT' && !cap.traitUsed && !cap.isKing) {
      const owner = opponent(player);
      const cell = cellsAround(to[0], to[1], 1).find(([cy, cx]) => !next[cy][cx]);
      if (cell) {
        next = next === board ? board.map(r => [...r]) : next;
        next[cell[0]][cell[1]] = { ...cap, id: `${cap.id}_split`, owner, isPromoted: false, traitUsed: true, coolDownTurnsRemaining: 0, isStealth: false, isRevealed: true };
        logs.push({ player: owner, message: `【分裂】「${cap.word}」は取られる直前に分裂し、分身が残りました！`, type: 'ability' });
      }
    }
    kept.push(cap);
  }
  // 成長: 取るたびに移動範囲が広がる（2段階まで）
  const mover = next[to[0]][to[1]];
  if (mover && mover.owner === player && traitKind(mover) === 'GROWTH' && kept.some(c => !c.isKing) && (mover.traitLevel ?? 0) < GROWTH_GRIDS.length) {
    const level = (mover.traitLevel ?? 0) + 1;
    next = next === board ? board.map(r => [...r]) : next;
    const grid = mergeGrid(mover.range_geometry?.normal_grid ?? '', GROWTH_GRIDS[level - 1]);
    next[to[0]][to[1]] = { ...mover, traitLevel: level, range_geometry: { ...mover.range_geometry, normal_grid: grid } };
    logs.push({ player, message: `【成長】「${mover.word}」が成長し、動ける範囲が広がりました！（${level}段階目）`, type: 'ability' });
  }
  return { board: next, captured: kept, logs };
}

/** 成長の各段階で足す移動範囲（5x5。1段目=周囲1マス、2段目=縦横2マス） */
const GROWTH_GRIDS = ['0000001110012100111000000', '0010001110112110111000100'];

function mergeGrid(base: string, add: string): string {
  const b = base.replace(/\//g, '').padEnd(25, '0').slice(0, 25);
  return b.split('').map((c, i) => (c === '2' || i === 12 ? '2' : c === '1' || add[i] === '1' ? '1' : '0')).join('');
}

/** よみがえる場所: 自陣（奥の3段）の空きマスのうち、真ん中の奥に近いところ */
function findHomeCell(board: Board, owner: Player): [number, number] | null {
  const rows = owner === 'sente' ? [8, 7, 6] : [0, 1, 2];
  for (const y of rows) {
    for (const dx of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
      const x = 4 + dx;
      if (!board[y][x]) return [y, x];
    }
  }
  return null;
}

/**
 * 手番の終わりの性質。player はいま手番を終えた側。
 *   - ワープ癖（player の駒）: 周囲2マスの空きマスへ瞬間移動
 *   - 寿命（player の駒）: 残りを1減らし、0で消える
 *   - 鈍足（player の駒）: 休みを1減らす
 *   - 透明（player の駒）: 隣に敵がいなければ姿を消す
 *   - 臆病（相手の駒）: player の駒が隣にいれば、1マス逃げる
 */
export function endOfTurnTraits(board: Board, player: Player, random: () => number = Math.random): { board: Board; logs: Omit<GameLog, 'id' | 'timestamp'>[] } {
  const logs: Omit<GameLog, 'id' | 'timestamp'>[] = [];
  let next = board.map(r => [...r]);
  const positions: [number, number][] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (next[y][x]?.trait) positions.push([y, x]);

  for (const [y, x] of positions) {
    const p = next[y][x];
    if (!p?.trait) continue;
    const kind = p.trait.kind;
    if (p.owner === player) {
      if (kind === 'LIFESPAN') {
        const life = (p.traitLife ?? p.trait.value ?? TRAIT_SPECS.LIFESPAN.value![2]) - 1;
        if (life <= 0 && !p.isKing) {
          next[y][x] = null;
          logs.push({ player, message: `【寿命】「${p.word}」は役目を終えて消えました。`, type: 'ability' });
          continue;
        }
        next[y][x] = { ...p, traitLife: life };
      } else if (kind === 'SLOW' && (p.traitRest ?? 0) > 0) {
        next[y][x] = { ...p, traitRest: (p.traitRest ?? 0) - 1 };
      } else if (kind === 'INVISIBLE') {
        const enemyNear = cellsAround(y, x, 1).some(([cy, cx]) => { const q = next[cy][cx]; return !!q && q.owner !== player && !isObstacle(q); });
        if (!enemyNear && !p.isStealth) {
          next[y][x] = { ...p, isStealth: true, isRevealed: false };
          logs.push({ player, message: `【透明】「${p.word}」が姿を消しました。`, type: 'ability' });
        }
      } else if (kind === 'WARP') {
        const empties = cellsAround(y, x, 2).filter(([cy, cx]) => !next[cy][cx]);
        if (empties.length) {
          const [ty, tx] = empties[Math.floor(random() * empties.length)];
          next[ty][tx] = p;
          next[y][x] = null;
          logs.push({ player, message: `【ワープ癖】「${p.word}」が勝手に瞬間移動しました。`, type: 'ability' });
        }
      }
    } else if (kind === 'COWARD') {
      const threatened = cellsAround(y, x, 1).some(([cy, cx]) => next[cy][cx]?.owner === player && !isObstacle(next[cy][cx]));
      if (!threatened) continue;
      const escapes = cellsAround(y, x, 1)
        .filter(([cy, cx]) => !next[cy][cx])
        .map(c => ({ c, danger: cellsAround(c[0], c[1], 1).filter(([ay, ax]) => next[ay][ax]?.owner === player).length }))
        .sort((a, b) => a.danger - b.danger);
      if (escapes.length) {
        const [ty, tx] = escapes[0].c;
        next[ty][tx] = p;
        next[y][x] = null;
        logs.push({ player: p.owner, message: `【臆病】「${p.word}」は敵に驚いて逃げました。`, type: 'ability' });
      }
    }
  }
  return { board: next, logs };
}

function cellsAround(y: number, x: number, radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if ((dy || dx) && inBounds(y + dy, x + dx)) out.push([y + dy, x + dx]);
  }
  return out;
}
