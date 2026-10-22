// 簡易生成の全能力型が、ゲームエンジン上で実際に効果を発揮するかを確認するスクリプト。
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
// 実行: npx tsx scripts/verify-offline.ts
import { initializeBoard, applyAutomatedEffect, BOARD_SIZE } from '../src/gameLogic';
import { sanitizePieceData } from '../src/aiGenerator';
import { OFFLINE_ARCHETYPES, buildOfflinePiece } from '../src/offlineGenerator';
import type { Board, Piece } from '../src/types';

const template = initializeBoard();
const pawn = template[6][0]!;
const emptyBoard = (): Board => Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
const mk = (owner: 'sente' | 'gote', id: string, extra: Partial<Piece> = {}): Piece =>
  ({ ...pawn, owner, id, isPawn: false, word: `駒${id}`, ...extra }) as Piece;

const snapshot = (b: Board) => JSON.stringify(b.map(r => r.map(p => p && [p.id, p.owner, p.isPawn, p.stunTurnsRemaining, p.frozenDuration, p.isFrozen, p.hasShield, p.isStealth, p.hasAbsoluteGuard, p.isOverdrive])));

let failed = 0;
for (const archetype of OFFLINE_ARCHETYPES) {
  const piece: Piece = {
    ...sanitizePieceData(buildOfflinePiece(`テスト${archetype.key}`, archetype), 'テスト'),
    id: 'me', owner: 'sente', isKing: false, isPawn: false, originalPosition: null,
    coolDownTurnsRemaining: 0, isRevealed: true, isPromoted: false,
  };
  const board = emptyBoard();
  board[8][0] = { ...template[8][4]!, id: 'sk' };
  board[0][8] = { ...template[0][4]!, id: 'gk' };
  board[4][4] = piece;
  // 敵: 周囲8マスのうち前方3マスと左右、2マス先にも配置。味方: 後方
  for (const [y, x] of [[3, 3], [3, 4], [3, 5], [4, 3], [4, 5], [2, 4], [1, 4], [7, 7], [1, 1]]) board[y][x] = mk('gote', `e${y}${x}`);
  for (const [y, x] of [[5, 4], [5, 3]]) board[y][x] = mk('sente', `a${y}${x}`);
  const before = snapshot(board);
  const oppHand = [mk('gote', 'hand1')];
  const isTrap = archetype.trigger === 'ON_TAKEN';
  const pos: [number, number] = [4, 4];
  if (isTrap) board[4][4] = mk('gote', 'attacker');
  const res = applyAutomatedEffect(
    board, pos, archetype.trigger, 'sente', [], [5, 4], undefined, [], [], undefined,
    isTrap ? piece : undefined, oppHand,
  );
  const changed = snapshot(res.board) !== (isTrap ? snapshot(board) : before)
    || (res.capturedPieces?.length ?? 0) > 0
    || (res.opponentCapturedPieces && res.opponentCapturedPieces.length !== oppHand.length);
  const ok = res.triggered && changed;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${archetype.key.padEnd(9)} ${archetype.actions.join('+').padEnd(18)} triggered=${res.triggered} changed=${changed} ${res.logs.map(l => l.message).join(' / ').slice(0, 90)}`);
}
if (failed) throw new Error(`${failed} archetype(s) had no effect`);
