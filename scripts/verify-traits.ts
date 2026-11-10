// 性質（src/traits.ts）が盤面上で説明どおりに動くかを確かめる。実行: npm run verify:traits
import type { Board, Piece } from '../src/types';
import { normalizeTrait, applyTraitBalance, describeTrait, normalizeAbilityPrograms } from '../shared/abilityProgram';
import { canCommand, chooseWildMove, endOfTurnTraits, fickleTarget, markMoved } from '../src/traits';

(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { initializeBoard, executeMove } = await import('../src/gameLogic');

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` … ${detail}` : ''}`);
};

const template = initializeBoard();
const pawn = template[6][0]!;
const empty = (): Board => Array.from({ length: 9 }, () => Array(9).fill(null));
const mk = (owner: 'sente' | 'gote', id: string, extra: Partial<Piece> = {}): Piece => ({ ...pawn, id, owner, isPawn: false, word: id, range_geometry: { normal_grid: '0000001110012100111000000' }, logic_code: 'normal', ...extra });
const withKings = (b: Board) => { b[8][0] = { ...template[8][4]!, id: 'sk' }; b[0][8] = { ...template[0][4]!, id: 'gk' }; return b; };

{
  check(normalizeTrait({ kind: 'WILD' })?.kind === 'WILD' && normalizeTrait('暴れ馬')?.kind === 'WILD' && normalizeTrait('NOPE') === null, '性質を英語名・日本語名で読み、知らないものは無視する');
  check(normalizeTrait({ kind: 'LIFESPAN', value: 99 })?.value === 8, '寿命の手番数は範囲内に収める');
  const ab = normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'DESTROY' }] }])!;
  const wild = applyTraitBalance(ab, { kind: 'WILD' })[0].cooldown;
  const undying = applyTraitBalance(ab, { kind: 'UNDYING' })[0].cooldown;
  check(wild < ab[0].cooldown && undying > ab[0].cooldown, '弱点の性質は充填を短く、得な性質は長くする', `元${ab[0].cooldown} 暴れ馬${wild} 不死身${undying}`);
  check(describeTrait({ kind: 'LIFESPAN', value: 4 }).includes('4回'), '説明文に数値が入る', describeTrait({ kind: 'LIFESPAN', value: 4 }));
}

{
  const wild = mk('sente', 'wild', { trait: { kind: 'WILD' } });
  check(!canCommand(wild), '暴れ馬は操作できない');
  const b = withKings(empty());
  b[4][4] = wild;
  b[3][4] = mk('gote', 'enemy');
  const to = chooseWildMove(b, [4, 4], [[3, 3], [3, 4], [3, 5], [5, 4]]);
  check(!!to && to[0] === 3 && to[1] === 4, '暴れ馬は取れる敵がいれば取りにいく');
  const b2 = withKings(empty());
  b2[4][4] = wild;
  b2[1][4] = mk('gote', 'far');
  const to2 = chooseWildMove(b2, [4, 4], [[3, 4], [5, 4], [4, 3]]);
  check(!!to2 && to2[0] === 3, '取れる敵がいなければ、一番近い敵へ近づく');
}

{
  const fickle = mk('sente', 'fickle', { trait: { kind: 'FICKLE' } });
  const b = withKings(empty());
  b[4][4] = fickle;
  const moves: [number, number][] = [[3, 4], [3, 3], [5, 5]];
  check(fickleTarget(fickle, [3, 4], moves, b, () => 0.9)[0] === 3 && fickleTarget(fickle, [3, 4], moves, b, () => 0.9)[1] === 4, '気まぐれでも、だいたいは指示どおり');
  const other = fickleTarget(fickle, [3, 4], moves, b, () => 0.1);
  check(other[0] !== 3 || other[1] !== 4, '気まぐれは、ときどき別のマスへ行く', `→ ${other}`);
}

{
  let b = withKings(empty());
  b[4][4] = mk('sente', 'slow', { trait: { kind: 'SLOW' } });
  b = markMoved(b, [4, 4]);
  check(!canCommand(b[4][4]), '鈍足は動いた直後は休み');
  b = endOfTurnTraits(b, 'sente').board;
  check(!canCommand(b[4][4]), '次の自分の手番も休み');
  b = endOfTurnTraits(b, 'sente').board;
  check(canCommand(b[4][4]), 'その次の手番には動ける');
}

{
  let b = withKings(empty());
  b[4][4] = mk('sente', 'life', { trait: { kind: 'LIFESPAN', value: 3 } });
  for (let i = 0; i < 2; i++) b = endOfTurnTraits(b, 'sente').board;
  check(!!b[4][4], '寿命の手番が残っているうちは盤上にいる', `残り${b[4][4]?.traitLife}`);
  b = endOfTurnTraits(b, 'sente').board;
  check(!b[4][4], '寿命が尽きると消える');
}

{
  const b = withKings(empty());
  b[4][4] = mk('sente', 'warp', { trait: { kind: 'WARP' } });
  const after = endOfTurnTraits(b, 'sente', () => 0.5).board;
  check(!after[4][4] && after.flat().some(p => p?.id === 'warp'), 'ワープ癖は手番の終わりに勝手に移動する');
}

{
  const b = withKings(empty());
  b[4][4] = mk('gote', 'coward', { trait: { kind: 'COWARD' } });
  b[5][4] = mk('sente', 'scary');
  const after = endOfTurnTraits(b, 'sente').board;
  const pos = after.flatMap((row, y) => row.map((p, x) => (p?.id === 'coward' ? [y, x] : null))).find(Boolean) as number[];
  check(!after[4][4] && Math.max(Math.abs(pos[0] - 5), Math.abs(pos[1] - 4)) > 1, '臆病は敵が隣に来ると、離れたマスへ逃げる', `→ ${pos}`);
}

{
  const b = withKings(empty());
  b[4][4] = mk('sente', 'attacker');
  b[3][4] = mk('gote', 'undying', { trait: { kind: 'UNDYING' } });
  const res = executeMove(b, [4, 4], [3, 4], 'sente', false);
  const revived = res.board.flat().find(p => p?.id === 'undying');
  check(!!revived && revived.owner === 'gote' && revived.traitUsed === true && !res.capturedPiece, '不死身は取られても自陣によみがえり、持ち駒にならない');
  const b2 = res.board.map(r => [...r]);
  const pos = b2.flatMap((row, y) => row.map((p, x) => (p?.id === 'undying' ? [y, x] : null))).find(Boolean) as [number, number];
  b2[pos[0] + (pos[0] < 8 ? 1 : -1)][pos[1]] = mk('sente', 'hunter');
  const res2 = executeMove(b2, [pos[0] + (pos[0] < 8 ? 1 : -1), pos[1]], pos, 'sente', false);
  check(!!res2.capturedPiece && res2.capturedPiece.id === 'undying', '不死身は1回だけ（2回目は取られる）');
}

{
  const b = withKings(empty());
  b[4][4] = mk('sente', 'grow', { trait: { kind: 'GROWTH' }, range_geometry: { normal_grid: '0000000100002000000000000' } });
  b[3][4] = mk('gote', 'food');
  const res = executeMove(b, [4, 4], [3, 4], 'sente', false);
  const grown = res.board[3][4]!;
  const cells = (grown.range_geometry?.normal_grid ?? '').split('').filter(c => c === '1').length;
  check(grown.traitLevel === 1 && cells >= 8, '成長は敵を取ると移動範囲が広がる', `動けるマス ${cells}`);
}

console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
