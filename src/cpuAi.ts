// CPU対戦相手（後手）の指し手選択
// 以前は「その場で取れる一番高い駒を取る」だけの1手読みで、取った直後に取り返される手や
// 自玉を王手に晒す手も平気で指していた。ここでは軽量な2手読み（自分の手 → 相手の最善の取り返し）で評価する。
// ※ 能力効果のシミュレーションは行わず、通常の移動・捕獲のみで盤面を予測する。
import type { Board, Piece, Player } from './types';
import { BOARD_SIZE, getValidMoves, getValidDropCells, isKingInCheck, getPieceTrigger, getPieceLogicCode } from './gameLogic';

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

  for (const [y, x, piece] of piecesOf(board, me)) {
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
      const score = scoreAfter(next, me, gain) + positionalBonus([ty, tx], me) * 0.5;
      scored.push({ move, score });
    }
  }

  const addDrops = (pieces: Piece[], type: 'drop' | 'custom_deck_drop', bonus: number) => {
    pieces.forEach((piece, index) => {
      for (const [ty, tx] of getValidDropCells(board, piece, me)) {
        const next = simulate(board, [ty, tx], { ...piece, owner: me });
        const score = scoreAfter(next, me, bonus) + positionalBonus([ty, tx], me);
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
