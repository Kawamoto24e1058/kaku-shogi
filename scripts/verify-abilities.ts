// 能力まわりの動作確認スクリプト。
// 1. 簡易生成の全能力型が、ゲームエンジン上で実際に効果を発揮するか
// 2. 発動条件・成り後の能力・地形効果・罠イベントがエンジンで正しく扱われるか
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
// 実行: npm run verify:abilities
import { initializeBoard, applyAutomatedEffect, applyTileEffects, createEmptyTileBoard, drainTilePlacements, executeMove, isTriggerMatching, BOARD_SIZE } from '../src/gameLogic';
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
// ─── エンジンの回帰テスト ─────────────────────────────────────────────
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const archetypePiece = (key: string, extra: Partial<Piece> = {}): Piece => {
  const a = OFFLINE_ARCHETYPES.find(x => x.key === key)!;
  return {
    ...sanitizePieceData(buildOfflinePiece(`テスト${key}`, a), 'テスト'),
    id: `p-${key}`, owner: 'sente', isKing: false, isPawn: false, originalPosition: null,
    coolDownTurnsRemaining: 0, isRevealed: true, isPromoted: false, ...extra,
  } as Piece;
};
const boardWith = (piece: Piece): Board => {
  const b = emptyBoard();
  b[8][0] = { ...template[8][4]!, id: 'sk' };
  b[0][8] = { ...template[0][4]!, id: 'gk' };
  b[4][4] = piece;
  for (const [y, x] of [[3, 3], [3, 4], [3, 5], [4, 3], [4, 5], [2, 4]]) b[y][x] = mk('gote', `e${y}${x}`);
  b[5][4] = mk('sente', 'ally');
  return b;
};

// 発動条件が一致しないイベントでは発動しない
const mine = archetypePiece('mine');
check('罠(取られた時)は移動時に発動しない', !isTriggerMatching(mine, 'ON_MOVE') && !isTriggerMatching(mine, 'TURN_START'));
check('罠(取られた時)は取られた時に発動する', isTriggerMatching(mine, 'ON_TAKEN'));
const blaze = archetypePiece('blaze');
check('移動時能力は手番開始時に発動しない', !applyAutomatedEffect(boardWith(blaze), [4, 4], 'TURN_START', 'sente', []).triggered);
check('移動時能力は取られた時/死亡時に発動しない', !isTriggerMatching(blaze, 'ON_TAKEN') && !isTriggerMatching(blaze, 'ON_DEATH'));
const fortress = archetypePiece('fortress');
check('手番開始時能力は移動時に発動しない', !applyAutomatedEffect(boardWith(fortress), [4, 4], 'ON_MOVE', 'sente', []).triggered);
const always = archetypePiece('blaze');
always.custom_ability = { ...always.custom_ability!, triggers: ['ALWAYS'] };
check('常時(ALWAYS)は手番開始時のみ発動', isTriggerMatching(always, 'TURN_START') && !isTriggerMatching(always, 'ON_MOVE'));

// 成った後は覚醒後の能力で動く
const promoted = archetypePiece('blaze', { isPromoted: true });
promoted.promoted_effect = {
  ...promoted.promoted_effect,
  ability_spec: { ...promoted.ability_spec!, area_shape: 'SQUARE_3X3', actions: ['FREEZE'], effect_type: 'FREEZE' },
};
const promoRes = applyAutomatedEffect(boardWith(promoted), [4, 4], 'ON_MOVE', 'sente', []);
const frozen = promoRes.board.flat().filter(p => p && p.owner === 'gote' && (p.isFrozen || (p.frozenDuration ?? 0) > 0)).length;
const destroyedAfterPromo = 6 - promoRes.board.flat().filter(p => p && p.owner === 'gote' && p.id.startsWith('e')).length;
check('成った駒は覚醒後の能力(凍結)を使う', promoRes.triggered && frozen > 0 && destroyedAfterPromo === 0, `凍結${frozen} 消滅${destroyedAfterPromo}`);

// 地形効果が盤面に残り、敵にだけ効き、時間で消える
drainTilePlacements();
const fire = archetypePiece('blaze');
fire.custom_ability = { ...fire.custom_ability!, targets: ['SQUARE_3X3'], actions: ['SET_TILE_FIRE'] };
const fireBoard = boardWith(fire);
const fireRes = applyAutomatedEffect(fireBoard, [4, 4], 'ON_MOVE', 'sente', []);
const placements = drainTilePlacements();
check('炎マスが配置される', fireRes.triggered && placements.length === 8 && placements.every(p => p.tile.effectType === 'FIRE_ZONE'), `${placements.length}マス`);
let tiles = createEmptyTileBoard();
for (const { y, x, tile } of placements) tiles[y][x] = tile;
const tileLogs: { message: string }[] = [];
const tick = applyTileEffects(fireRes.board, tiles, 'sente', tileLogs as never);
const enemiesLeft = tick.board.flat().filter(p => p && p.owner === 'gote' && p.id.startsWith('e')).length;
check('炎マス上の敵は焼かれ、味方は無事', enemiesLeft === 1 && tick.board[5][4]?.id === 'ally', `残り敵${enemiesLeft}`);
check('地形の残り手番は元データを書き換えずに減る', tiles[3][3]!.duration === 3 && tick.tileBoard[3][3]!.duration === 2);
tiles = tick.tileBoard;
for (let i = 0; i < 2; i++) tiles = applyTileEffects(tick.board, tiles, 'sente', []).tileBoard;
check('地形は3手番で消える', tiles.flat().every(t => t === null));

// 通常の駒を取っても「死亡時」イベントは出ない／罠は1回だけ発動
const capBoard = emptyBoard();
capBoard[8][0] = { ...template[8][4]!, id: 'sk' };
capBoard[0][8] = { ...template[0][4]!, id: 'gk' };
capBoard[5][4] = { ...pawn, id: 'attacker', owner: 'sente' };
capBoard[4][4] = { ...pawn, id: 'victim', owner: 'gote' };
const normalCap = executeMove(capBoard, [5, 4], [4, 4], 'sente');
check('通常の駒取りで能力イベントが出ない', (normalCap.abilityEvents || []).length === 0, JSON.stringify((normalCap.abilityEvents || []).map(e => e.triggerType)));
capBoard[4][4] = { ...archetypePiece('mine'), owner: 'gote', id: 'trap' };
const trapCap = executeMove(capBoard, [5, 4], [4, 4], 'sente');
const trapEvents = (trapCap.abilityEvents || []).map(e => e.triggerType);
check('罠を取ると「取られた時」イベントが1回だけ出る', trapEvents.length === 1 && trapEvents[0] === 'ON_TAKEN', JSON.stringify(trapEvents));

if (failed) throw new Error(`${failed} check(s) failed`);
