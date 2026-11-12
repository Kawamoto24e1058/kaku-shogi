// ルールの組み合わせ（成った・封印・凍結・地形・透明など）が、決めたとおりに動くかを確かめる。実行: npm run verify:rules
let failed = 0;
const check = (ok: boolean, label: string) => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${label}`); };
import type { Board, Piece } from '../src/types';
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { initializeBoard, getValidMoves, applyAutomatedEffect, applyTileEffects, createEmptyTileBoard, executeMove } = await import('../src/gameLogic');
const { normalizeAbilityPrograms } = await import('../shared/abilityProgram');
const t = initializeBoard();
const pawn = t[6][0]!;
const fresh = (): Board => { const b: Board = Array.from({ length: 9 }, () => Array(9).fill(null)); b[8][0] = { ...t[8][4]!, id: 'sk' }; b[0][8] = { ...t[0][4]!, id: 'gk' }; return b; };
const mk = (extra: Partial<Piece> = {}): Piece => ({ ...pawn, id: 'me', isPawn: false, word: 'me', logic_code: 'normal', range_geometry: { normal_grid: '0000001110012100111000000', promoted_grid: '0000001110012100111000000' }, ...extra } as Piece);
const fmt = (m: [number, number][]) => m.map(x => x.join(',')).sort().join(' ');

// 1. 能力が発動した後、駒の動き（古い「充填中は十字移動」）
{
  const b = fresh();
  b[4][4] = mk({ abilities: normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'STUN', value: 1 }], cooldown: 3 }])! });
  b[3][4] = { ...pawn, id: 'e', owner: 'gote' };
  const before = getValidMoves(4, 4, b);
  const r = applyAutomatedEffect(b, [4, 4], 'ON_MOVE', 'sente', []);
  const me = r.board[4][4]!;
  check(me.abilityCooldowns?.[0] === 3 && getValidMoves(4, 4, r.board).length === before.length, '能力の充填中でも、新しい駒の動ける範囲は変わらない（古い「充填中は十字」は効かない）');
}
// 2. 封印中の新しい駒の動き
{
  const b = fresh();
  b[4][4] = mk({ isSilenced: true, silenceDuration: 2, move_extra: { kind: 'SLIDE_DIAGONAL', range: 3 }, abilities: normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'STUN', value: 1 }] }])! });
  check(fmt(getValidMoves(4, 4, b)) === '3,3 3,4 3,5 4,3 4,5 5,3 5,4 5,5', '封印中: マス目どおりには動けるが、移動の特徴（斜めに滑る）は使えない');
}
// 3. 成った駒の、移動の特徴の範囲
{
  const b = fresh();
  b[4][4] = mk({ isPromoted: true, move_extra: { kind: 'SLIDE_DIAGONAL', range: 2 } });
  const far = getValidMoves(4, 4, b).filter(([y, x]) => Math.abs(y - 4) === Math.abs(x - 4) && Math.abs(y - 4) >= 3);
  check(far.length > 0, '成ると、滑る動きが1マス伸びる');
}
// 4. 重量の駒と跳ね床
{
  const b = fresh();
  b[5][4] = { ...pawn, id: 'heavy', owner: 'gote', trait: { kind: 'HEAVY' } } as Piece;
  const tiles = createEmptyTileBoard(); tiles[5][4] = { effectType: 'SPRING_FLOOR', ownerPlayer: 'sente', duration: 3 };
  check(!!applyTileEffects(b, tiles, 'sente', []).board[5][4], '重量の駒は、跳ね床で弾かれない');
}
// 5. 飛行の駒と聖域
{
  const b = fresh();
  b[5][4] = { ...pawn, id: 'bird', trait: { kind: 'FLYING' } } as Piece;
  const tiles = createEmptyTileBoard(); tiles[5][4] = { effectType: 'SANCTUARY', ownerPlayer: 'sente', duration: 3 };
  check(!!applyTileEffects(b, tiles, 'sente', []).board[5][4]?.hasAbsoluteGuard, '飛行の駒も、聖域の守りは受けられる');
}
// 6. 姿を消している敵を、能力で狙えるか
{
  const b = fresh();
  b[4][4] = mk({ abilities: normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'STUN', value: 1 }] }])! });
  b[3][4] = { ...pawn, id: 'ghost', owner: 'gote', isStealth: true, isRevealed: false } as Piece;
  check(!applyAutomatedEffect(b, [4, 4], 'ON_MOVE', 'sente', []).board[3][4]?.stunTurnsRemaining, '姿を消した敵は、狙って選ぶ能力の対象にならない');
  const b2 = fresh();
  b2[4][4] = mk({ abilities: normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'STUN', value: 1 }] }])! });
  b2[3][4] = { ...pawn, id: 'ghost', owner: 'gote', isStealth: true, isRevealed: false } as Piece;
  check(!!applyAutomatedEffect(b2, [4, 4], 'ON_MOVE', 'sente', []).board[3][4]?.stunTurnsRemaining, '姿を消した敵も、範囲の「すべて」に効く能力は受ける');
}
// 7. 姿を消した敵のマスへ、普通に動いて取れるか
{
  const b = fresh();
  b[4][4] = mk();
  b[3][4] = { ...pawn, id: 'ghost', owner: 'gote', isStealth: true, isRevealed: false } as Piece;
  const moves = getValidMoves(4, 4, b);
  const r = executeMove(b, [4, 4], [3, 4], 'sente', false);
  check(moves.some(([y, x]) => y === 3 && x === 4) && r.capturedPiece?.id === 'ghost', '姿を消した敵のマスへ動くと、取れる（見えない駒に踏み込む）');
}
// 8. 凍結中・麻痺中の駒
{
  const b = fresh();
  b[4][4] = mk({ stunTurnsRemaining: 1, move_extra: { kind: 'RANDOM_WARP', range: 3 } });
  check(getValidMoves(4, 4, b).length === 0, '麻痺・凍結中は、移動の特徴（ワープなど）も含めて動けない');
}

console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
