// 能力プログラム（v2）の動作確認スクリプト
// 実行: npm run verify:programs
// 1. すべての効果の部品が、ゲームエンジン上で実際に盤面・持ち駒を変えるか
// 2. 条件・充填手番・防護・取られたときの発動・強さの自動調整が想定どおりか
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { initializeBoard, applyAutomatedEffect, drainTilePlacements, isTriggerMatching, BOARD_SIZE, applyTileEffects, createEmptyTileBoard, getValidMoves, executeMove } from '../src/gameLogic';
import { tickAbilityCooldowns } from '../src/abilityEngine';
import { PROGRAM_OPS, normalizeAbilityPrograms, describeAbilities, type AbilityProgram, type ProgramOp } from '../shared/abilityProgram';
import type { Board, Piece } from '../src/types';
import { normalizeFusionWord, dailyWords, dailyKey } from '../shared/challenge';
import { judgeGame, endgameNotice, JUDGE_PLY } from '../shared/endgame';
import { MOVE_STYLE_SPECS, describeMoveExtra } from '../shared/moveStyles';
import { pieceStrength, fitToBudget, BUDGET_LIMIT, BUDGET_FLOOR } from '../shared/pieceBudget';
import { sanitizePieceData } from '../src/aiGenerator';

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
  check(huge.target.pick === 'NEAREST' && huge.target.count === 2 && huge.cooldown >= 3,
    '盤上全体を消すような能力は「近い2体まで」に絞られ、充填手番が付く', describeAbilities([huge]));
  const [frozenAll] = normalizeAbilityPrograms([{ trigger: 'TURN_START', target: { area: 'ALL', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'FREEZE', value: 3 }] }])!;
  check(frozenAll.cooldown === 99, '盤上全体を凍らせるような強い能力は1ゲーム1回になる');
  const [hit] = normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'RANDOM', count: 5 }, effects: [{ op: 'CAPTURE' }] }])!;
  check(hit.target.count === 2 && hit.target.pick === 'RANDOM', '取り除く・奪う能力は1回2体まで（選び方は保つ）');
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
  // 取られたときに自分が動く効果は使えない（実際の AI 出力で見つかった不発）
  const escape = normalizeAbilityPrograms([{ trigger: 'ON_TAKEN', target: { area: 'ADJACENT', who: 'EMPTY' }, effects: [{ op: 'TELEPORT' }] }]);
  check(!!escape && escape[0].trigger === 'ON_MOVE' && escape[0].effects[0].op === 'TELEPORT', '「取られたら逃げる」だけの能力は「動いた後に逃げる」に読み替える');
  const mixed = normalizeAbilityPrograms([{ trigger: 'ON_TAKEN', target: { area: 'ATTACKER', who: 'ENEMY' }, effects: [{ op: 'TELEPORT' }, { op: 'FREEZE', value: 1 }] }]);
  check(!!mixed && mixed[0].trigger === 'ON_TAKEN' && mixed[0].effects.map(e => e.op).join() === 'FREEZE', '取られたときの瞬間移動などは、他の効果があれば取り除く');
}

{
  // 能力は1つ。勝手に発動するタイミングは「動いた後」に読み替える。ランダム型だけ複数持てる
  const weak = { trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY' }, effects: [{ op: 'STUN', value: 1 }] };
  const strong = { trigger: 'TURN_START', target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'DESTROY' }] };
  const single = normalizeAbilityPrograms([weak, strong]);
  check(!!single && single.length === 1 && single[0].effects[0].op === 'DESTROY' && single[0].trigger === 'ON_MOVE',
    '能力は1つだけ残す（いちばん強いもの）。手番の開始時は「動いた後」に読み替える');
  for (const trigger of ['TURN_START', 'EVERY_N_TURNS', 'ON_APPROACH']) {
    check(normalizeAbilityPrograms([{ ...weak, trigger }])![0].trigger === 'ON_MOVE', `${trigger} は「動いた後」に読み替える`);
  }
  const random = normalizeAbilityPrograms([{ ...weak, name: '甲' }, { ...strong, name: '乙', trigger: 'ON_MOVE' }, { name: '丙', trigger: 'ON_CAPTURE', target: { area: 'ADJACENT', who: 'ENEMY' }, effects: [{ op: 'PUSH', value: 1 }] }], 'RANDOM');
  check(!!random && random.length === 3 && random.every(a => a.trigger === 'ON_MOVE'), 'ランダム型は複数の能力を持ち、発動タイミングをそろえる');
  // ランダム型は1回の発動で1つだけ実行される
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const board = setup(random!);
    board[4][4] = { ...board[4][4]!, ability_mode: 'RANDOM' };
    const res = applyAutomatedEffect(board, [4, 4], 'ON_MOVE', 'sente', [], [5, 4]);
    const names = new Set((res.logs ?? []).map(l => ['甲', '乙', '丙'].find(n => l.message.includes(n))).filter(Boolean) as string[]);
    if (names.size !== 1) { check(false, 'ランダム型は1回に1つだけ発動する', [...names].join(',')); break; }
    seen.add([...names][0]);
  }
  check(seen.size >= 2, 'ランダム型は1回に1つだけ発動し、発動するたびに選ばれる能力が変わる', [...seen].join(','));
}

{
  // 引き寄せは隣の駒を選ばない（実際の AI 出力で「周囲1マスの最も近い敵を引き寄せる」が不発だった）
  const fixed = normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'PULL', value: 1 }] }]);
  check(!!fixed && fixed[0].target.area === 'RADIUS_2', '「周囲1マスを引き寄せる」は周囲2マスに広げる');
  const abilities = program({ trigger: 'ON_MOVE', target: { area: 'CROSS', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'PULL', value: 1 }] });
  const board = setup(abilities);
  // 縦横の隣（4,5）に敵、上に2つ離れて（1,4）に敵。隣の敵は動かせないので、離れた敵を引き寄せる
  board[3][4] = null;
  board[2][4] = null;
  board[1][4] = mk('gote', 'far-enemy');
  const res = applyAutomatedEffect(board, [4, 4], 'ON_MOVE', 'sente', [], [5, 4]);
  check(res.triggered && res.board[2][4]?.id === 'far-enemy', '隣の駒ではなく、引き寄せられる駒を選ぶ');
}

{
  // 敵玉の周りには壁を置けない（自動対局で玉を閉じ込める組み合わせが勝率93%だった）
  const abilities = program({ trigger: 'ON_MOVE', target: { area: 'ENEMY_KING_AROUND', who: 'EMPTY', pick: 'ALL' }, effects: [{ op: 'WALL', value: 3 }] });
  const board = setup(abilities);
  const res = applyAutomatedEffect(board, [4, 4], 'ON_MOVE', 'sente', [], [5, 4]);
  const wallsNearKing = [[0, 7], [1, 7], [1, 8]].filter(([y, x]) => res.board[y][x]?.type === 'wall').length;
  check(!res.triggered && wallsNearKing === 0, '敵玉の周りには壁を置けない');
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
  check(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c) && a.length === 3 && !a.some(w => w.includes('×')) && new Set(a).size === 3,
    '今日のお題は日付で決まり、毎日変わる（3語とも普通の単語）', `${a.join(' / ')} → 翌日 ${c.join(' / ')}`);
  check(dailyKey(new Date('2026-10-22T15:30:00Z')) === '2026-10-23', '今日のお題は日本時間の0時で切り替わる');
}

// ===== 打ったとき・仇討ち =====
{
  const tpl = initializeBoard();
  const base = tpl[6][0]!;
  const mkp = (owner: 'sente' | 'gote', id: string, abilities?: AbilityProgram[]): Piece => ({ ...base, id, owner, isPawn: false, word: id, effect_name: id, abilities, range_geometry: { normal_grid: '0000001110012100111000000' }, logic_code: 'normal' } as Piece);
  const prog = (trigger: string) => normalizeAbilityPrograms([{ trigger, target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'FREEZE', value: 1 }], cooldown: 2 }])!;
  const fresh = () => { const b: Board = Array.from({ length: 9 }, () => Array(9).fill(null)); b[8][0] = { ...tpl[8][4]!, id: 'sk' }; b[0][8] = { ...tpl[0][4]!, id: 'gk' }; return b; };
  const drop = mkp('sente', 'dropper', prog('ON_DROP'));
  check(drop.abilities?.[0].trigger === 'ON_DROP', '「打ったとき」はそのまま残る（動いた後に読み替えない）');
  check(isTriggerMatching(drop, 'ON_DROP') && !isTriggerMatching(drop, 'ON_MOVE'), '「打ったとき」の能力は、動いただけでは発動しない');
  const b = fresh(); b[4][4] = drop; b[3][4] = mkp('gote', 'e');
  check(!!applyAutomatedEffect(b, [4, 4], 'ON_DROP', 'sente', []).board[3][4]?.isFrozen, '「打ったとき」で隣の敵を凍らせる');
  const avenger = mkp('sente', 'avenger', prog('ON_ALLY_TAKEN'));
  check(isTriggerMatching(avenger, 'ON_ALLY_TAKEN') && !isTriggerMatching(avenger, 'ON_TAKEN') && !isTriggerMatching(avenger, 'ON_MOVE'), '「仇討ち」は味方が取られたときだけ（自分が取られた・動いたでは発動しない）');
  const b2 = fresh(); b2[4][4] = avenger; b2[3][4] = mkp('gote', 'killer');
  check(!!applyAutomatedEffect(b2, [4, 4], 'ON_ALLY_TAKEN', 'sente', []).board[3][4]?.isFrozen, '「仇討ち」で近くの敵を凍らせる');
  check(describeAbilities(prog('ON_ALLY_TAKEN')).includes('味方の駒が取られたとき'), '説明文に「味方の駒が取られたとき」と出る');
}

// ===== 設置型の地形（聖域・封印陣・跳ね床） =====
{
  const tpl = initializeBoard();
  const base = tpl[6][0]!;
  const mkp = (owner: 'sente' | 'gote', id: string): Piece => ({ ...base, id, owner, isPawn: false, word: id } as Piece);
  const fresh = () => { const b: Board = Array.from({ length: 9 }, () => Array(9).fill(null)); b[8][0] = { ...tpl[8][4]!, id: 'sk' }; b[0][8] = { ...tpl[0][4]!, id: 'gk' }; return b; };
  const tiles = createEmptyTileBoard();
  const b = fresh();
  b[5][2] = mkp('sente', 'ally'); tiles[5][2] = { effectType: 'SANCTUARY', ownerPlayer: 'sente', duration: 3 };
  b[4][4] = mkp('gote', 'sealed'); tiles[4][4] = { effectType: 'SEAL_ZONE', ownerPlayer: 'sente', duration: 3 };
  b[5][6] = mkp('gote', 'bounced'); tiles[5][6] = { effectType: 'SPRING_FLOOR', ownerPlayer: 'sente', duration: 3 };
  b[6][7] = mkp('gote', 'enemyOnHoly'); tiles[6][7] = { effectType: 'SANCTUARY', ownerPlayer: 'sente', duration: 3 };
  const r = applyTileEffects(b, tiles, 'sente', []);
  check(!!r.board[5][2]?.hasAbsoluteGuard, '聖域: 置いた側の駒は守られる');
  check(!r.board[6][7]?.hasAbsoluteGuard, '聖域: 相手の駒が乗っても守られない');
  check(!!r.board[4][4]?.isSilenced, '封印陣: 乗った敵の能力を封じる');
  check(!r.board[5][6] && r.board[3][6]?.id === 'bounced', '跳ね床: 乗った敵を自陣の方向へ2マス弾き飛ばす', `→ ${r.board.flat().findIndex(p => p?.id === 'bounced')}`);
  const b2 = fresh(); const t2 = createEmptyTileBoard();
  b2[5][6] = mkp('gote', 'blocked'); b2[4][6] = mkp('gote', 'wall'); t2[5][6] = { effectType: 'SPRING_FLOOR', ownerPlayer: 'sente', duration: 3 };
  check(applyTileEffects(b2, t2, 'sente', []).board[5][6]?.id === 'blocked', '跳ね床: すぐ後ろに駒がいれば動かない（駒を消したり重ねたりしない）');
  const holy = normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'SELF', who: 'ALLY', pick: 'ALL' }, effects: [{ op: 'TILE', tile: 'HOLY', value: 3 }], cooldown: 3 }])!;
  check(holy[0].effects[0].tile === 'HOLY' && describeAbilities(holy).includes('聖域'), '聖域を置く能力として読めて、説明文に「聖域」と出る', describeAbilities(holy));
  const aimedAtEnemy = normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'TILE', tile: 'HOLY', value: 3 }], cooldown: 3 }])!;
  check(aimedAtEnemy[0].target.who === 'ALLY', '敵に向けた聖域は、味方に向け直す');
}

// ===== 代償（反動・捨て身・代価・巻き添え） =====
{
  const tpl = initializeBoard();
  const base = tpl[6][0]!;
  const mkp = (owner: 'sente' | 'gote', id: string, abilities?: AbilityProgram[]): Piece => ({ ...base, id, owner, isPawn: false, word: id, effect_name: id, abilities } as Piece);
  const fresh = () => { const b: Board = Array.from({ length: 9 }, () => Array(9).fill(null)); b[8][0] = { ...tpl[8][4]!, id: 'sk' }; b[0][8] = { ...tpl[0][4]!, id: 'gk' }; return b; };
  const prog = (drawback: unknown, effects: unknown[] = [{ op: 'DESTROY' }], target: unknown = { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }) =>
    normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target, effects, cooldown: 0, drawback }])!;

  const recoil = prog({ kind: 'RECOIL', value: 2 });
  const b1 = fresh(); b1[4][4] = mkp('sente', 'me', recoil); b1[3][4] = mkp('gote', 'e');
  const r1 = applyAutomatedEffect(b1, [4, 4], 'ON_MOVE', 'sente', []);
  check(!r1.board[3][4] && (r1.board[4][4]?.stunTurnsRemaining ?? 0) === 3, '反動: 発動後、自分が2手番動けない（手番の終わりの分を足して3）');
  const b1b = fresh(); b1b[4][4] = mkp('sente', 'me', recoil);
  check(!applyAutomatedEffect(b1b, [4, 4], 'ON_MOVE', 'sente', []).board[4][4]?.stunTurnsRemaining, '反動: 不発なら代償も払わない');

  const sac = prog({ kind: 'SACRIFICE' });
  const b2 = fresh(); b2[4][4] = mkp('sente', 'me', sac); b2[3][4] = mkp('gote', 'e');
  const r2 = applyAutomatedEffect(b2, [4, 4], 'ON_MOVE', 'sente', []);
  check(!r2.board[3][4] && !r2.board[4][4] && r2.graveyard?.some(p => p.id === 'me') === true, '捨て身: 効果のあと自分も消えて墓所へ');
  check(sac[0].cooldown < prog(undefined)[0].cooldown || sac[0].cooldown === 0, '捨て身の能力は、代償なしより充填が短い', `捨て身${sac[0].cooldown} なし${prog(undefined)[0].cooldown}`);

  const cost = prog({ kind: 'HAND_COST', value: 2 });
  const b3 = fresh(); b3[4][4] = mkp('sente', 'me', cost); b3[3][4] = mkp('gote', 'e');
  check(!applyAutomatedEffect(b3, [4, 4], 'ON_MOVE', 'sente', [mkp('sente', 'h1')]).triggered, '代価: 持ち駒が足りなければ使えない');
  const r3 = applyAutomatedEffect(b3, [4, 4], 'ON_MOVE', 'sente', [mkp('sente', 'h1'), mkp('sente', 'h2'), mkp('sente', 'h3')]);
  check(r3.triggered && r3.capturedPieces.length === 1, '代価: 使うと持ち駒を2枚捨てる', `残り${r3.capturedPieces.length}`);

  const ff = prog({ kind: 'FRIENDLY_FIRE' });
  check(ff[0].target.who === 'ANY', '巻き添え: 範囲の味方にも効く対象になる');
  const b4 = fresh(); b4[4][4] = mkp('sente', 'me', ff); b4[3][4] = mkp('gote', 'e'); b4[5][4] = mkp('sente', 'ally');
  const r4 = applyAutomatedEffect(b4, [4, 4], 'ON_MOVE', 'sente', []);
  check(!r4.board[3][4] && !r4.board[5][4], '巻き添え: 隣の敵も味方も消える');
  check(prog({ kind: 'FRIENDLY_FIRE' }, [{ op: 'SHIELD' }], { area: 'ADJACENT', who: 'ALLY', pick: 'ALL' })[0].drawback === undefined, '巻き添えは、味方を強化する能力には付かない');
  check(normalizeAbilityPrograms([{ trigger: 'ON_TAKEN', target: { area: 'ATTACKER', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'DESTROY' }], drawback: { kind: 'SACRIFICE' } }])![0].drawback === undefined, '取られたときの能力に、捨て身・反動は付かない');

  const strong = normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'DESTROY' }] }])![0];
  check(strong.drawback?.kind === 'RECOIL', '代償の書かれていない強い能力には、自動で反動が付く', describeAbilities([strong]));
  const weak = normalizeAbilityPrograms([{ trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'PUSH', value: 1 }] }])![0];
  check(!weak.drawback, '弱い能力には代償は付かない');
  check(JSON.stringify(normalizeAbilityPrograms(structuredClone([strong]))![0]) === JSON.stringify(strong), '読み込み直しても代償・充填は変わらない');
  check(describeAbilities(recoil).includes('【代償】反動'), '説明文に代償が出る', describeAbilities(recoil));
}

// ===== 判定（長引いた対局の決着） =====
{
  const tpl = initializeBoard();
  const b: Board = Array.from({ length: 9 }, () => Array(9).fill(null));
  b[8][4] = { ...tpl[8][4]!, id: 'sk' }; b[0][4] = { ...tpl[0][4]!, id: 'gk' };
  b[6][0] = { ...tpl[6][0]!, id: 'sp' }; // 先手の歩 1点
  b[1][1] = { ...tpl[7][1]!, id: 'gb', owner: 'gote' }; // 後手の角 8点
  const r1 = judgeGame(b, { sente: [], gote: [] });
  check(r1.winner === 'gote' && r1.sente === 1 && r1.gote === 8, '判定: 点数の多い方が勝ち（玉は数えない）', `先手${r1.sente} 後手${r1.gote}`);
  const r2 = judgeGame(b, { sente: [{ ...tpl[7][7]!, id: 'h1' }, { ...tpl[6][1]!, id: 'h2' }], gote: [] });
  check(r2.winner === 'sente' && r2.sente === 10, '判定: 持ち駒も数える', `先手${r2.sente}`);
  const tie = judgeGame([[{ ...tpl[8][4]!, id: 'k' }]], { sente: [], gote: [] });
  check(tie.winner === 'gote', '判定: 同点なら後手の勝ち（先手の有利を打ち消す）');
  check(endgameNotice(199) === null && !!endgameNotice(200)?.includes(`${JUDGE_PLY - 200}手で判定`), '判定の案内は200手目から出る', String(endgameNotice(200)));
}

// ===== 移動の型・総合力 =====
{
  const raw = (extra: Record<string, unknown>) => ({ word: '試', effect_name: '試', description: '試', range_geometry: { normal_grid: '00000/01110/01210/01110/00000' }, ...extra });
  const rusher = sanitizePieceData(raw({ move_style: 'RUSHER' }), '試');
  check(rusher.range_geometry.normal_grid === MOVE_STYLE_SPECS.RUSHER.grid, '移動の型: 突進型のマス目になる', rusher.range_geometry.normal_grid);
  check(sanitizePieceData(raw({ move_style: '跳ねる（桂馬）' }), '試').range_geometry.normal_grid === MOVE_STYLE_SPECS.JUMPER.grid, '移動の型: 日本語の名前でも読める');
  check(sanitizePieceData(raw({ move_style: 'NOPE' }), '試').range_geometry.normal_grid === '0000001110012100111000000', '知らない型なら AI のマス目のまま');

  const strongTrait = sanitizePieceData(raw({ move_style: 'FLYER', trait: { kind: 'GROWTH' }, abilities: [{ trigger: 'ON_MOVE', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'DESTROY' }] }] }), '試');
  const st = pieceStrength(strongTrait);
  check(st.total <= BUDGET_LIMIT, '能力＋得な性質＋広い移動の駒は、総合力の上限以内に削られる', `移動${st.move} 能力${st.ability.toFixed(1)} 性質${st.trait} → ${st.total}`);
  const weak = sanitizePieceData(raw({ move_style: 'HEAVY', trait: { kind: 'LIFESPAN' } }), '試');
  check(pieceStrength(weak).total >= BUDGET_FLOOR, '弱点の性質＋狭い移動の駒は、下限まで移動が足される', `${weak.range_geometry.normal_grid} → ${pieceStrength(weak).total}`);
  const plain = { range_geometry: { normal_grid: MOVE_STYLE_SPECS.BALANCED.grid } };
  check(fitToBudget(plain) === plain, '上限と下限の間の駒は変えない');
}

// ===== 移動の特徴（斜めに滑る・気まぐれワープ・端から端へ・仲間のもとへ） =====
{
  const tpl = initializeBoard();
  const pawnT = tpl[6][0]!;
  const fresh = () => { const b: Board = Array.from({ length: 9 }, () => Array(9).fill(null)); b[8][0] = { ...tpl[8][4]!, id: 'sk' }; b[0][8] = { ...tpl[0][4]!, id: 'gk' }; return b; };
  const mover = (move_extra: unknown, grid = MOVE_STYLE_SPECS.CROSS.grid): Piece => ({ ...pawnT, id: 'me', isPawn: false, word: 'me', logic_code: 'normal', range_geometry: { normal_grid: grid }, move_extra } as Piece);
  const has = (moves: [number, number][], y: number, x: number) => moves.some(([a, b]) => a === y && b === x);

  const b1 = fresh(); b1[4][4] = mover({ kind: 'SLIDE_DIAGONAL', range: 3 }); b1[2][2] = { ...pawnT, id: 'own' }; b1[6][6] = { ...pawnT, id: 'foe', owner: 'gote' };
  const m1 = getValidMoves(4, 4, b1);
  check(has(m1, 1, 7) && !has(m1, 0, 8) && has(m1, 3, 3) && !has(m1, 2, 2) && has(m1, 6, 6) && !has(m1, 7, 7), '斜めに滑る: 最大3マス・味方の手前で止まる・敵は取れてその先へは行けない');

  const b2 = fresh(); b2[6][4] = mover({ kind: 'SLIDE_FORWARD', range: 4 });
  const m2 = getValidMoves(6, 4, b2);
  check(has(m2, 2, 4) && !has(m2, 1, 4), '前へ滑る: 前へ最大4マス');

  const b3 = fresh(); b3[4][0] = mover({ kind: 'EDGE_WRAP' }, MOVE_STYLE_SPECS.CROSS.grid);
  check(has(getValidMoves(4, 0, b3), 4, 8), '端から端へ: 左の端の左は、右の端に出る');

  const b4 = fresh(); b4[6][4] = mover({ kind: 'ALLY_HOP', range: 3 }); b4[3][6] = { ...pawnT, id: 'friend' };
  const m4 = getValidMoves(6, 4, b4);
  check(has(m4, 2, 6) && has(m4, 3, 7), '仲間のもとへ: 3マス以内の味方の隣へ行ける');

  const b5 = fresh(); b5[4][4] = mover({ kind: 'RANDOM_WARP', range: 3 });
  const warp1 = getValidMoves(4, 4, b5).filter(([y, x]) => Math.max(Math.abs(y - 4), Math.abs(x - 4)) > 1);
  check(warp1.length === 2 && warp1.every(([y, x]) => !b5[y][x]), '気まぐれワープ: 周囲の空きマス2か所（マス目の外）', JSON.stringify(warp1));
  check(JSON.stringify(getValidMoves(4, 4, b5)) === JSON.stringify(getValidMoves(4, 4, b5)), '気まぐれワープ: 同じ盤面なら同じ行き先（オンラインの両端末でずれない）');
  const moved = executeMove(b5, [4, 4], [3, 4], 'sente', false);
  const back = executeMove(moved.board, [3, 4], [4, 4], 'sente', false);
  const warp2 = getValidMoves(4, 4, back.board).filter(([y, x]) => Math.max(Math.abs(y - 4), Math.abs(x - 4)) > 1);
  check(JSON.stringify(warp2) !== JSON.stringify(warp1), '気まぐれワープ: 動くたびに行き先が変わる', `${JSON.stringify(warp1)} → ${JSON.stringify(warp2)}`);

  const raw = (extra: Record<string, unknown>) => ({ word: '試', effect_name: '試', description: '試', move_style: 'CROSS', trait: { kind: 'INVISIBLE' }, ...extra });
  const legacyRook = sanitizePieceData(raw({ logic_code: 'move_like_rook' }), '試');
  check(legacyRook.move_extra?.kind === 'SLIDE_ORTHOGONAL' && legacyRook.logic_code === 'normal', '古い「飛車の動き」は、最大マス数のある「縦横に滑る」に読み替える');
  const strong = sanitizePieceData(raw({ move_style: 'BALANCED', trait: { kind: 'GROWTH' }, move_extra: { kind: 'SLIDE_ORTHOGONAL', range: 4 } }), '試');
  check((strong.move_extra?.range ?? 0) < 4 && pieceStrength(strong).total <= BUDGET_LIMIT, '強い移動の特徴＋得な性質は、滑る範囲が縮められる（強すぎれば特徴ごと外す）', `範囲${strong.move_extra?.range ?? 'なし'} 総合力${pieceStrength(strong).total}`);
  const ninja = sanitizePieceData(raw({ move_style: 'DIAGONAL', trait: { kind: 'INVISIBLE' }, move_extra: { kind: 'SLIDE_DIAGONAL', range: 3 } }), '試');
  check(ninja.move_extra?.kind === 'SLIDE_DIAGONAL' && String(ninja.rules_text).includes('【移動：斜めに滑る】'), '上限内なら特徴はそのまま残り、説明文に出る', describeMoveExtra(ninja.move_extra!));
}

console.log(failed === 0 ? '\nすべて成功' : `\n${failed} 件失敗`);
process.exit(failed === 0 ? 0 : 1);
