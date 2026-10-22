// 能力プログラム（v2）の動作確認スクリプト
// 実行: npm run verify:programs
// 1. すべての効果の部品が、ゲームエンジン上で実際に盤面・持ち駒を変えるか
// 2. 条件・充填手番・防護・取られたときの発動・強さの自動調整が想定どおりか
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { initializeBoard, applyAutomatedEffect, drainTilePlacements, isTriggerMatching, BOARD_SIZE } from '../src/gameLogic';
import { tickAbilityCooldowns } from '../src/abilityEngine';
import { PROGRAM_OPS, normalizeAbilityPrograms, describeAbilities, type AbilityProgram, type ProgramOp } from '../shared/abilityProgram';
import type { Board, Piece } from '../src/types';
import { normalizeFusionWord, dailyWords, dailyKey } from '../shared/challenge';

const template = initializeBoard();
const pawn = template[6][0]!;
const emptyBoard = (): Board => Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
const mk = (owner: 'sente' | 'gote', id: string, extra: Partial<Piece> = {}): Piece =>
  ({ ...pawn, owner, id, isPawn: false, word: `駒${id}`, ...extra }) as Piece;

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` … ${detail}` : ''}`);
  if (!ok) failed++;
};

function program(raw: Record<string, unknown>): AbilityProgram[] {
  const list = normalizeAbilityPrograms([{ name: '試験', trigger: 'ON_MOVE', ...raw }]);
  if (!list) throw new Error('normalize failed');
  // 強さの自動調整はここでは見ない（別に確認する）
  return list.map(a => ({ ...a, cooldown: 0 }));
}

function setup(abilities: AbilityProgram[]) {
  const me = mk('sente', 'me', { word: '試験駒', effect_name: '試験', abilities });
  const board = emptyBoard();
  board[8][0] = { ...template[8][4]!, id: 'sk' };
  board[0][8] = { ...template[0][4]!, id: 'gk' };
  board[4][4] = me;
  for (const [y, x] of [[3, 3], [3, 4], [3, 5], [4, 5], [2, 4]]) board[y][x] = mk('gote', `e${y}${x}`);
  board[5][4] = mk('sente', 'ally');
  return board;
}

const state = (b: Board) => JSON.stringify(b.map(r => r.map(p => p && [
  p.id, p.owner, p.isPawn, p.isFrozen, p.frozenDuration, p.stunTurnsRemaining, p.isSilenced, p.isMindControlled,
  p.deathCountdown, p.hasShield, p.hasAbsoluteGuard, p.isStealth, p.duration,
])));

// ===== 1. 部品ごと =====
const CASES: Record<ProgramOp, Record<string, unknown>> = {
  DESTROY: { target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'DESTROY' }] },
  CAPTURE: { target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'CAPTURE' }] },
  PUSH: { target: { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'PUSH', value: 2 }] },
  PULL: { target: { area: 'FRONT_LINE', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'PULL', value: 1 }] },
  SWAP: { target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'FARTHEST', count: 1 }, effects: [{ op: 'SWAP' }] },
  TELEPORT: { target: { area: 'RADIUS_2', who: 'EMPTY', pick: 'RANDOM', count: 1 }, effects: [{ op: 'TELEPORT' }] },
  FREEZE: { target: { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'FREEZE', value: 2 }] },
  STUN: { target: { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'STUN', value: 1 }] },
  SILENCE: { target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'STRONGEST', count: 2 }, effects: [{ op: 'SILENCE', value: 2 }] },
  CONTROL: { target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'CONTROL', value: 1 }] },
  DOOM: { target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'RANDOM', count: 1 }, effects: [{ op: 'DOOM', value: 3 }] },
  TRANSFORM_PAWN: { target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'TRANSFORM_PAWN' }] },
  SHIELD: { target: { area: 'ADJACENT', who: 'ALLY', pick: 'ALL' }, effects: [{ op: 'SHIELD' }] },
  GUARD: { target: { area: 'ADJACENT', who: 'ALLY', pick: 'ALL' }, effects: [{ op: 'GUARD', value: 1 }] },
  STEALTH: { effects: [{ op: 'STEALTH' }] },
  CLEANSE: { target: { area: 'ADJACENT', who: 'ALLY', pick: 'ALL' }, effects: [{ op: 'CLEANSE' }] },
  EXTRA_ACTION: { effects: [{ op: 'EXTRA_ACTION' }] },
  SPAWN: { target: { area: '00000/00000/01210/00000/00000', who: 'EMPTY', pick: 'ALL' }, effects: [{ op: 'SPAWN', value: 1 }] },
  WALL: { target: { area: 'ROW', who: 'EMPTY', pick: 'NEAREST', count: 2 }, effects: [{ op: 'WALL', value: 2 }] },
  TILE: { target: { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'TILE', tile: 'POISON', value: 2 }] },
  STEAL_HAND: { effects: [{ op: 'STEAL_HAND', value: 1 }] },
};

for (const op of PROGRAM_OPS) {
  const abilities = program(CASES[op]);
  const board = setup(abilities);
  // CLEANSE は治す相手が必要
  if (op === 'CLEANSE') board[5][4] = { ...board[5][4]!, isFrozen: true, frozenDuration: 2 };
  // PULL は離れた敵が必要（隣の敵はそれ以上近づけない）
  if (op === 'PULL') board[3][4] = null;
  const before = state(board);
  const hand = [mk('gote', 'hand1')];
  drainTilePlacements();
  const res = applyAutomatedEffect(board, [4, 4], 'ON_MOVE', 'sente', [], [5, 4], undefined, [], [], undefined, undefined, hand);
  const tiles = drainTilePlacements();
  const changed = state(res.board) !== before || res.capturedPieces.length > 0 || (res.graveyard?.length ?? 0) > 0
    || tiles.length > 0 || res.reAction || (res.opponentCapturedPieces?.length ?? 1) !== 1;
  check(res.triggered && changed, `${op}`, describeAbilities(abilities));
}

// ===== 2. ルールまわり =====
{
  // 充填手番: 発動後は反応しなくなり、手番開始のたびに減って戻る
  const [a] = normalizeAbilityPrograms([{ name: '一掃', trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'DESTROY' }] }])!;
  check(a.cooldown > 0, '強い能力には自動で充填手番が付く', `周囲の敵を全消滅 → 充填${a.cooldown}手番`);
  const board = setup([a]);
  const res = applyAutomatedEffect(board, [4, 4], 'ON_MOVE', 'sente', [], [5, 4]);
  let me = res.board[4][4]!;
  check(!isTriggerMatching(me, 'ON_MOVE'), '発動後は充填中で反応しない');
  for (let i = 0; i < a.cooldown; i++) me = tickAbilityCooldowns(me);
  check(isTriggerMatching(me, 'ON_MOVE'), `${a.cooldown}手番後に再び使える`);

  const [weak] = normalizeAbilityPrograms([{ name: '小突き', trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'PUSH', value: 1 }] }])!;
  check(weak.cooldown === 0, '弱い能力は毎回使える');
  const [huge] = normalizeAbilityPrograms([{ name: '終末', trigger: 'TURN_START', target: { area: 'ALL', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'DESTROY' }] }])!;
  check(huge.cooldown === 99, '盤上全体を消すような能力は1ゲーム1回になる');
}
{
  // 条件: 敵陣にいるときだけ
  const abilities = program({ condition: 'IN_ENEMY_CAMP', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'FREEZE', value: 1 }] });
  const res = applyAutomatedEffect(setup(abilities), [4, 4], 'ON_MOVE', 'sente', [], [5, 4]);
  check(!res.triggered, '条件を満たさないと発動しない（自陣外・敵陣外）');
}
{
  // 防護中の敵には効かない
  const abilities = program({ target: { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'DESTROY' }] });
  const board = setup(abilities);
  for (const [y, x] of [[3, 3], [3, 4], [3, 5], [4, 5]]) board[y][x] = { ...board[y][x]!, hasAbsoluteGuard: true, guardDuration: 2 };
  const res = applyAutomatedEffect(board, [4, 4], 'ON_MOVE', 'sente', [], [5, 4]);
  check(!res.triggered && res.board[3][4]?.id === 'e34', '防護中の駒は能力で消されない');
}
{
  // 玉将は消されない
  const abilities = program({ target: { area: 'ALL', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'DESTROY' }] });
  const res = applyAutomatedEffect(setup(abilities), [4, 4], 'ON_MOVE', 'sente', [], [5, 4]);
  check(res.board[0][8]?.isKing === true, '玉将は能力で消されない');
}
{
  // 取られたとき: 取った駒（同じマス）に反撃
  const abilities = program({ trigger: 'ON_TAKEN', target: { area: 'ATTACKER', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'DESTROY' }] });
  const trap = mk('sente', 'me', { word: '罠駒', effect_name: '道連れ', abilities });
  const board = setup(abilities);
  board[4][4] = mk('gote', 'attacker');
  check(isTriggerMatching(trap, 'ON_TAKEN'), '取られたときの能力として認識される');
  const res = applyAutomatedEffect(board, [4, 4], 'ON_TAKEN', 'sente', [], undefined, undefined, [], [], undefined, trap);
  check(res.triggered && res.board[4][4] === null, '取った駒に反撃して消滅させる');
}
{
  // 敵駒を取ったときの能力
  const abilities = program({ trigger: 'ON_CAPTURE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'STUN', value: 1 }] });
  const me = mk('sente', 'me', { abilities });
  check(isTriggerMatching(me, 'ON_CAPTURE') && !isTriggerMatching(me, 'ON_MOVE'), '「敵駒を取ったとき」は取ったときだけ反応する');
}
{
  // 複数の効果: 押し出した駒にも続けて凍結が効く（駒を追いかける）
  const abilities = program({ target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'PUSH', value: 2 }, { op: 'FREEZE', value: 1 }] });
  const res = applyAutomatedEffect(setup(abilities), [4, 4], 'ON_MOVE', 'sente', [], [5, 4]);
  const moved = res.board.flat().find(p => p?.id === 'e33');
  check(!!moved?.isFrozen && res.board[3][3] === null, '押し出した後の駒に続けて凍結が効く');
}
{
  // 自分の足元に地形を残す（実際のAI出力で見つかった不発）
  const abilities = program({ target: { area: 'SELF', who: 'ALLY', pick: 'ALL' }, effects: [{ op: 'TILE', tile: 'FIRE', value: 2 }] });
  drainTilePlacements();
  const res = applyAutomatedEffect(setup(abilities), [4, 4], 'ON_MOVE', 'sente', [], [5, 4]);
  const tiles = drainTilePlacements();
  check(res.triggered && tiles.some(t => t.y === 4 && t.x === 4), '自分のマスに地形を置ける', describeAbilities(abilities));
}
{
  // 不正な出力の補正
  const fixed = normalizeAbilityPrograms([{ trigger: 'WHENEVER', target: { area: 'zzz' }, effects: [{ op: 'NUKE' }, { op: 'freeze', value: 99 }] }]);
  check(!!fixed && fixed[0].trigger === 'ON_MOVE' && fixed[0].effects.length === 1 && fixed[0].effects[0].value === 3,
    '未知の値は既定値・範囲内に直し、未知の効果は捨てる');
  check(normalizeAbilityPrograms([{ effects: [{ op: 'NUKE' }] }]) === null, '使える効果が無ければ null（従来の能力にフォールバック）');
}

{
  // 取られたときに自分が動く効果は捨てる（実際の AI 出力で見つかった不発）
  const fixed = normalizeAbilityPrograms([{ trigger: 'ON_TAKEN', target: { area: 'ADJACENT', who: 'EMPTY' }, effects: [{ op: 'TELEPORT' }] },
    { trigger: 'ON_TAKEN', target: { area: 'ATTACKER', who: 'ENEMY' }, effects: [{ op: 'TELEPORT' }, { op: 'FREEZE', value: 1 }] }]);
  check(!!fixed && fixed.length === 1 && fixed[0].effects.map(e => e.op).join() === 'FREEZE', '取られたときの瞬間移動などは取り除く');
}

// ===== 3. 合体駒・今日のお題 =====
{
  const cases: [string, string][] = [
    ['猫+新幹線', '猫×新幹線'], ['猫 ＋ 新幹線', '猫×新幹線'], ['猫x新幹線', '猫×新幹線'], ['猫×新幹線', '猫×新幹線'],
    ['box', 'box'], ['Max', 'Max'], ['猫', '猫'], ['a+b+c', 'a+b+c'], ['+猫', '+猫'],
  ];
  const bad = cases.filter(([input, want]) => normalizeFusionWord(input) !== want);
  check(bad.length === 0, '合体駒の表記をそろえる（英単語の x は区切りにしない）', bad.map(([i]) => `${i}→${normalizeFusionWord(i)}`).join(', '));
  const a = dailyWords('2026-10-22');
  const b = dailyWords('2026-10-22');
  const c = dailyWords('2026-10-23');
  check(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c) && a.length === 3 && a[2].includes('×') && new Set(a).size === 3,
    '今日のお題は日付で決まり、毎日変わる（3枚目は合体駒）', `${a.join(' / ')} → 翌日 ${c.join(' / ')}`);
  check(dailyKey(new Date('2026-10-22T15:30:00Z')) === '2026-10-23', '今日のお題は日本時間の0時で切り替わる');
}

console.log(failed === 0 ? '\nすべて成功' : `\n${failed} 件失敗`);
process.exit(failed === 0 ? 0 : 1);
