// CPU対戦相手（後手）の指し手選択
// 以前は「その場で取れる一番高い駒を取る」だけの1手読みで、取った直後に取り返される手や
// 自玉を王手に晒す手も平気で指していた。ここでは軽量な2手読み（自分の手 → 相手の最善の取り返し）で評価する。
// 能力は盤面を変えずに先読みする previewPrograms（画面の ⚡ 表示と同じ判定）で、得と代償をおおまかに見積もる。
// 泥沼化（300手で決着しない対局）を減らすため、行ったり来たりを避け、敵玉に近づく手を少し優先する。
import type { Board, Piece, Player } from './types';
import { BOARD_SIZE, getValidMoves, getValidDropCells, isKingInCheck, getPieceTrigger, getPieceLogicCode, applyAutomatedEffect, drainTilePlacements, queueTilePlacement, isTriggerMatching } from './gameLogic';
import { canCommand } from './traits';
import { previewPrograms } from './abilityEngine';

export type CpuMove =
  | { type: 'move'; from: [number, number]; to: [number, number]; piece?: undefined; index?: undefined }
  | { type: 'drop' | 'custom_deck_drop'; to: [number, number]; piece: Piece; index: number; from?: undefined };

const KING_VALUE = 10000;

export function pieceValue(p: Piece | null): number {
  if (!p || p.isObstacle || p.type === 'wall' || p.type === 'hazard') return 0;
  if (p.isKing) return KING_VALUE;
  if (p.isHisha || p.isKaku) return p.isPromoted ? 1100 : 900;
  if (p.isPawn) return p.isPromoted ? 400 : 100;
  return p.isPromoted ? 650 : 550; // AI生成のカスタム駒
}

function isSelfDestructTrap(p: Piece | null): boolean {
  return !!p && getPieceTrigger(p) === 'ON_TAKEN' && getPieceLogicCode(p) === 'kill_adjacent';
}

function opponentOf(player: Player): Player {
  return player === 'sente' ? 'gote' : 'sente';
}

function simulate(board: Board, to: [number, number], piece: Piece, from?: [number, number]): Board {
  const next = board.map(row => [...row]);
  if (from) next[from[0]][from[1]] = null;
  next[to[0]][to[1]] = piece;
  return next;
}

function piecesOf(board: Board, player: Player): [number, number, Piece][] {
  const list: [number, number, Piece][] = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const p = board[y][x];
      if (p && p.owner === player) list.push([y, x, p]);
    }
  }
  return list;
}

function isDefended(board: Board, square: [number, number], defender: Player): boolean {
  return piecesOf(board, defender).some(([y, x]) =>
    getValidMoves(y, x, board).some(([ty, tx]) => ty === square[0] && tx === square[1])
  );
}

/** 相手が次の1手で得られる最大の駒得（取り返されるなら差し引く） */
function worstReply(board: Board, me: Player): number {
  const opp = opponentOf(me);
  let worst = 0;
  for (const [y, x, attacker] of piecesOf(board, opp)) {
    for (const [ty, tx] of getValidMoves(y, x, board)) {
      const victim = board[ty][tx];
      if (!victim || victim.owner !== me) continue;
      const victimValue = pieceValue(victim);
      if (victimValue <= worst) continue;
      let loss = victimValue;
      if (!victim.isKing) {
        const after = simulate(board, [ty, tx], attacker, [y, x]);
        if (isDefended(after, [ty, tx], me)) loss -= pieceValue(attacker);
      }
      worst = Math.max(worst, loss);
    }
  }
  return worst;
}

function positionalBonus(to: [number, number], player: Player): number {
  // 敵陣に近いほど・中央に近いほどわずかに加点
  const advance = player === 'gote' ? to[0] : BOARD_SIZE - 1 - to[0];
  const centrality = 4 - Math.abs(4 - to[1]);
  return advance * 2 + centrality;
}

/** 敵玉の位置（いなければ null） */
function enemyKingAt(board: Board, me: Player): [number, number] | null {
  for (let y = 0; y < BOARD_SIZE; y++) for (let x = 0; x < BOARD_SIZE; x++) {
    const p = board[y][x];
    if (p?.isKing && p.owner !== me) return [y, x];
  }
  return null;
}
const chebyshev = (a: [number, number], b: [number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

/** 効果ごとの「敵駒1体に効いたときの価値（駒の価値に対する割合）」 */
const EFFECT_WORTH: Record<string, number> = {
  DESTROY: 1, CAPTURE: 1.1, DOOM: 0.6, TRANSFORM_PAWN: 0.6, CONTROL: 0.5, FREEZE: 0.25, STUN: 0.2, SILENCE: 0.15, PUSH: 0.08, PULL: 0.08, SWAP: 0.1,
};

/**
 * この位置にこの駒が来たときに発動する能力の、おおまかな得（代償を差し引く）。
 * 先読みと同じ判定なので、範囲に敵がいなければ 0
 */
function abilityGain(next: Board, at: [number, number], piece: Piece, me: Player, events: ('ON_MOVE' | 'ON_CAPTURE' | 'ON_DROP')[], myHand: number, enemyHand: number): number {
  if (!piece.abilities?.length) return 0;
  let total = 0;
  for (const event of events) {
    const pv = previewPrograms(next, at, event, me, myHand, enemyHand);
    if (pv.status === 'no') continue;
    const ability = piece.abilities.find(a => a.trigger === event);
    if (!ability) continue;
    const worth = Math.max(0, ...ability.effects.map(e => EFFECT_WORTH[e.op] ?? 0));
    let gain = 0;
    for (const c of pv.targets) {
      const t = next[c.y][c.x];
      if (t && t.owner !== me) gain += pieceValue(t) * worth;
      else if (t && t.owner === me && ability.drawback?.kind === 'FRIENDLY_FIRE') gain -= pieceValue(t) * worth;
    }
    if (ability.effects.some(e => e.op === 'EXTRA_ACTION')) gain += 150;
    if (ability.effects.some(e => e.op === 'STEAL_HAND')) gain += 120 * Math.min(enemyHand, 2);
    if (pv.status === 'maybe') gain *= 0.5;
    // 代償
    if (ability.drawback?.kind === 'SACRIFICE') gain -= pieceValue(piece);
    if (ability.drawback?.kind === 'RECOIL') gain -= 30 * (ability.drawback.value ?? 1);
    if (ability.drawback?.kind === 'HAND_COST') gain -= 100 * (ability.drawback.value ?? 1);
    total += gain;
  }
  // 見積もりは粗いので、駒の取り合いの評価より控えめに使う
  return total * 0.6;
}

/**
 * 能力が発動する手は、実際の能力を盤面の写しで動かした後の盤面で玉の安全を確かめる
 * （入れ替え・引き寄せなどで、自分の玉の近くに敵駒を呼び込んでしまう手を避ける）。
 * 試しに動かしたときに置かれた地形は、本物の対局に残らないよう元に戻す
 */
function boardAfterAbilities(next: Board, at: [number, number], me: Player, events: ('ON_MOVE' | 'ON_CAPTURE' | 'ON_DROP')[], hand: Piece[], from?: [number, number]): Board {
  const piece = next[at[0]][at[1]];
  if (!piece?.abilities?.length) return next;
  const pending = drainTilePlacements();
  let board = next;
  try {
    for (const event of events) {
      const cur = board[at[0]][at[1]];
      if (!cur || cur.id !== piece.id || !isTriggerMatching(cur, event)) continue;
      board = applyAutomatedEffect(board, at, event, me, hand, from).board;
    }
  } finally {
    drainTilePlacements();
    for (const t of pending) queueTilePlacement(t.y, t.x, t.tile);
  }
  return board;
}

function scoreAfter(board: Board, me: Player, gain: number): number {
  if (isKingInCheck(board, me)) return -KING_VALUE;
  let score = gain - worstReply(board, me) * 0.9;
  if (isKingInCheck(board, opponentOf(me))) score += 40;
  return score;
}

export function chooseCpuMove(
  board: Board,
  hand: Piece[],
  customDeck: Piece[],
  me: Player = 'gote',
  random: () => number = Math.random
): CpuMove | null {
  const scored: { move: CpuMove; score: number }[] = [];
  const kingAt = enemyKingAt(board, me);

  for (const [y, x, piece] of piecesOf(board, me)) {
    // 暴れ馬・休み中の鈍足は操作できない（勝手に動く分は手番の終わりに処理される）
    if (!canCommand(piece)) continue;
    for (const [ty, tx] of getValidMoves(y, x, board)) {
      const target = board[ty][tx];
      if (target && target.owner === me) continue;
      const move: CpuMove = { type: 'move', from: [y, x], to: [ty, tx] };
      if (target?.isKing) {
        scored.push({ move, score: KING_VALUE * 10 });
        continue;
      }
      let gain = pieceValue(target);
      // 取ると周囲を巻き込んで自爆する罠駒は、取る駒を失う前提で評価
      if (isSelfDestructTrap(target)) gain -= pieceValue(piece) + 200;
      const next = simulate(board, [ty, tx], piece, [y, x]);
      const captures = !!target && target.owner !== me;
      const events: ('ON_MOVE' | 'ON_CAPTURE')[] = captures ? ['ON_MOVE', 'ON_CAPTURE'] : ['ON_MOVE'];
      const abGain = abilityGain(next, [ty, tx], piece, me, events, hand.length + (captures ? 1 : 0), 0);
      gain += abGain;
      const after = abGain !== 0 ? boardAfterAbilities(next, [ty, tx], me, events, hand, [y, x]) : next;
      let score = scoreAfter(after, me, gain) + positionalBonus([ty, tx], me) * 0.5;
      // 敵玉に近づく手を少し優先（玉は除く）。泥沼化を減らす
      if (kingAt && !piece.isKing) score += (chebyshev([y, x], kingAt) - chebyshev([ty, tx], kingAt)) * 6;
      // 直前にいたマスへ戻る手（行ったり来たり）は避ける
      const prev = piece.previousPosition;
      if (prev && prev.y === ty && prev.x === tx && !captures) score -= 25;
      scored.push({ move, score });
    }
  }

  const addDrops = (pieces: Piece[], type: 'drop' | 'custom_deck_drop', bonus: number) => {
    pieces.forEach((piece, index) => {
      for (const [ty, tx] of getValidDropCells(board, piece, me)) {
        const dropped = { ...piece, owner: me };
        const next = simulate(board, [ty, tx], dropped);
        const abGain = abilityGain(next, [ty, tx], dropped, me, ['ON_DROP'], hand.length - 1, 0);
        const after = abGain !== 0 ? boardAfterAbilities(next, [ty, tx], me, ['ON_DROP'], hand) : next;
        const score = scoreAfter(after, me, bonus + abGain) + positionalBonus([ty, tx], me);
        scored.push({ move: { type, to: [ty, tx], piece, index }, score });
      }
    });
  };
  addDrops(hand, 'drop', 15);
  // カスタム駒は出さないと能力が活きないので、展開を少し優先する
  addDrops(customDeck, 'custom_deck_drop', 35);

  if (scored.length === 0) return null;

  // 同点付近の手からランダムに選んで、毎回同じ展開にならないようにする
  const best = Math.max(...scored.map(s => s.score));
  const nearBest = scored.filter(s => s.score >= best - 5);
  return nearBest[Math.floor(random() * nearBest.length)].move;
}
