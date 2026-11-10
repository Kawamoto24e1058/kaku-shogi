// 性質（src/traits.ts）が盤面上で説明どおりに動くかを確かめる。実行: npm run verify:traits
import type { Board, Piece } from '../src/types';
import { normalizeTrait, applyTraitBalance, describeTrait, normalizeAbilityPrograms } from '../shared/abilityProgram';
import { canCommand, chooseWildMove, endOfTurnTraits, fickleTarget, markMoved } from '../src/traits';

(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { initializeBoard, executeMove, applyAutomatedEffect, applyTileEffects, createEmptyTileBoard, isStealthPiece } = await import('../src/gameLogic');

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

// ===== 追加の性質 =====
const program = (op: string, area = 'RADIUS_2', value = 2) => normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area, who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op, value }], cooldown: 2 }])!;
const caster = (op: string, area?: string, value?: number) => mk('sente', 'caster', { abilities: program(op, area, value) });

{
  const b = withKings(empty());
  b[4][4] = caster('FREEZE');
  b[3][4] = mk('gote', 'near');
  b[2][6] = mk('gote', 'taunt', { trait: { kind: 'TAUNT' } });
  const res = applyAutomatedEffect(b, [4, 4], 'ON_MOVE', 'sente', []);
  check(!!res.board[2][6]?.isFrozen && !res.board[3][4]?.isFrozen, '挑発: 近くの敵より先に、挑発の駒が狙われる');
}

{
  const b = withKings(empty());
  b[4][4] = caster('FREEZE');
  b[3][4] = mk('gote', 'mirror', { trait: { kind: 'REFLECT' } });
  const res = applyAutomatedEffect(b, [4, 4], 'ON_MOVE', 'sente', []);
  check(!res.board[3][4]?.isFrozen && !!res.board[4][4]?.isFrozen && res.board[3][4]?.traitUsed === true, '反射: 凍結を跳ね返し、使った駒が凍る');
  const b2 = res.board.map(r => [...r]);
  b2[4][4] = caster('FREEZE');
  const res2 = applyAutomatedEffect(b2, [4, 4], 'ON_MOVE', 'sente', []);
  check(!!res2.board[3][4]?.isFrozen, '反射は1回だけ（2回目は効く）');
  const b3 = withKings(empty());
  b3[4][4] = mk('sente', 'caster2', { abilities: normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'STUN', value: 1 }, { op: 'DESTROY' }], cooldown: 3 }])! });
  b3[3][4] = mk('gote', 'mirror', { trait: { kind: 'REFLECT' } });
  const res3 = applyAutomatedEffect(b3, [4, 4], 'ON_MOVE', 'sente', []);
  check(!!res3.board[3][4], '反射: 同じ発動の残りの効果（消滅）も受けない');
}

{
  const b = withKings(empty());
  b[4][4] = caster('PUSH', 'ADJACENT', 2);
  b[3][4] = mk('gote', 'heavy', { trait: { kind: 'HEAVY' } });
  const res = applyAutomatedEffect(b, [4, 4], 'ON_MOVE', 'sente', []);
  check(res.board[3][4]?.id === 'heavy', '重量: 押し出されない');
  const b2 = withKings(empty());
  b2[4][4] = caster('FREEZE', 'ADJACENT');
  b2[3][4] = mk('gote', 'heavy', { trait: { kind: 'HEAVY' } });
  check(!!applyAutomatedEffect(b2, [4, 4], 'ON_MOVE', 'sente', []).board[3][4]?.isFrozen, '重量でも、凍結などは普通に受ける');
}

{
  const b = withKings(empty());
  b[4][4] = mk('gote', 'bird', { trait: { kind: 'FLYING' } });
  b[4][6] = mk('gote', 'walker');
  const tiles = createEmptyTileBoard();
  tiles[4][4] = { effectType: 'FIRE_ZONE', ownerPlayer: 'sente', duration: 3 } as never;
  tiles[4][6] = { effectType: 'FIRE_ZONE', ownerPlayer: 'sente', duration: 3 } as never;
  const res = applyTileEffects(b, tiles, 'sente', []);
  check(!!res.board[4][4] && !res.board[4][6], '飛行: 炎上マスの上でも燃えない（飛行でない駒は燃える）');
}

{
  const b = withKings(empty());
  b[4][4] = mk('sente', 'attacker');
  b[3][4] = mk('gote', 'slime', { trait: { kind: 'SPLIT' } });
  const res = executeMove(b, [4, 4], [3, 4], 'sente', false);
  const clone = res.board.flat().find(p => p?.id === 'slime_split');
  check(!!res.capturedPiece && !!clone && clone.owner === 'gote' && clone.traitUsed === true, '分裂: 本体は取られ、隣に分身が残る');
  check(res.capturedPiece?.traitUsed === true, '分裂は1回だけ: 持ち駒になった本体も使用済み（打ち直しても再び分裂しない）');
  const b2 = withKings(empty());
  b2[4][4] = mk('sente', 'attacker2');
  b2[3][4] = mk('gote', 'slime', { trait: { kind: 'SPLIT' } });
  b2[6][6] = mk('gote', 'slime_split');
  const res2 = executeMove(b2, [4, 4], [3, 4], 'sente', false);
  const ids = res2.board.flat().filter(Boolean).map(p => p!.id);
  check(new Set(ids).size === ids.length, '分裂の分身の id は、盤上の駒と重ならない');
}

{
  let b = withKings(empty());
  b[4][4] = mk('sente', 'ghost', { trait: { kind: 'INVISIBLE' } });
  b = endOfTurnTraits(b, 'sente').board;
  check(!!b[4][4]?.isStealth && isStealthPiece(b[4][4]), '透明: 敵が隣にいなければ姿を消す');
  let b2 = withKings(empty());
  b2[4][4] = mk('sente', 'ghost', { trait: { kind: 'INVISIBLE' } });
  b2[3][4] = mk('gote', 'watcher');
  b2 = endOfTurnTraits(b2, 'sente').board;
  check(!b2[4][4]?.isStealth, '透明: 敵が隣にいると姿を消せない');
  check(!isStealthPiece(mk('sente', 'x', { description: '透明なステルス', abilities: program('FREEZE') })), '説明文に「透明」とあるだけの駒は隠れない');
}

console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
