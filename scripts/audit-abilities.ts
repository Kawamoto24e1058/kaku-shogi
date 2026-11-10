// 能力が「変に発動しないか」を大量の駒で調べる監査スクリプト。実行: npm run audit:abilities [-- 駒データのJSONファイル]
// 能力プログラム（v2）の駒を、ランダムに作ったもの・AIが実際に作ったもの（JSON を渡した場合）の両方で、
// ブラウザと同じ補正（sanitizePieceData）を通してから、次を確かめる:
//   1. 持っていない発動タイミングでは何も起きない（例: 「取ったとき」だけの駒が、ただ動いただけで発動しない）
//   2. 廃止した発動タイミング（手番の開始時・敵が隣に来たとき・常時）は、能力プログラムの駒では一切起きない
//   3. 動けるマスは、AIが決めた移動範囲（5x5 のマス目）どおり（古い仕組みの移動ロジックが混ざらない）
//   4. 発動しても、盤の外・駒の重複・玉の消失などの壊れた盤面にならない
//   5. 勝手に動く（操作できない）のは性質「暴れ馬」の駒だけ（説明文の「暴走」「気まぐれ」などの言葉では決まらない）
//   6. 充填（クールダウン）のある能力は、発動した直後にもう一度は発動しない
import { readFileSync } from 'node:fs';
import type { Board, Piece } from '../src/types';
import { OP_SPECS, PROGRAM_TRIGGERS, PROGRAM_CONDITIONS, NAMED_AREAS, TARGET_WHO, TARGET_PICKS, TRAIT_KINDS } from '../shared/abilityProgram';

(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { sanitizePieceData } = await import('../src/aiGenerator');
const { initializeBoard, applyAutomatedEffect, isTriggerMatching, getValidMoves, drainTilePlacements, isAutonomousPiece } = await import('../src/gameLogic');

let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
Math.random = rand;
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

const OPS = Object.keys(OP_SPECS);
// 古い仕組みが説明文の言葉で動きを変えていたので、引っかかりやすい言葉を混ぜる
const RISKY_TEXT = ['試験', '暴走して勝手に動く', '気まぐれな暴れ馬', 'ワープで瞬間移動する', '狙撃で貫通するビーム', '猪突猛進', '操作不能の爆破', '罠を仕掛けて潜伏する', '分身を召喚する', '指示を聞かない'];
const GRIDS = ['00000/01110/01210/01110/00000', '00100/01110/01210/00100/00000', '01010/00100/01210/00000/00000', '10001/01010/00200/01010/10001', '00000/00100/01210/00100/00000'];

function randomRawPiece(i: number): Record<string, unknown> {
  const abilities = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, k) => ({
    name: `試${k}`,
    trigger: pick(PROGRAM_TRIGGERS),
    condition: rand() < 0.6 ? 'NONE' : pick(PROGRAM_CONDITIONS),
    condition_value: 1 + Math.floor(rand() * 60),
    target: { area: pick(NAMED_AREAS), who: pick(TARGET_WHO), pick: pick(TARGET_PICKS), count: 1 + Math.floor(rand() * 3) },
    effects: Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({ op: pick(OPS), value: 1 + Math.floor(rand() * 3), tile: 'FIRE' })),
    cooldown: Math.floor(rand() * 4),
  }));
  return {
    word: `乱${i}`, effect_name: `乱${i}`, ability_genre: '試験', description: pick(RISKY_TEXT),
    range_geometry: { normal_grid: pick(GRIDS), promoted_grid: '00000/11111/11211/11111/00000' },
    abilities, ability_mode: rand() < 0.15 ? 'RANDOM' : 'SINGLE',
    trait: rand() < 0.3 ? { kind: pick(TRAIT_KINDS) } : null,
    // AI が書かない・変な値を書くことがある項目も混ぜる
    logic_code: pick(['normal', '', undefined, 'linear_charge', 'leap_move', 'move_like_gold']),
    mechanics_type: pick(['FORCE_CRUSH', 'STEALTH_GHOST', 'AUTOMATIC_DRIVE', undefined]),
    isAutonomous: rand() < 0.1,
  };
}

const template = initializeBoard();
const pawn = template[6][0]!;
function setup(piece: Piece): Board {
  const board: Board = Array.from({ length: 9 }, () => Array(9).fill(null));
  board[8][0] = { ...template[8][4]!, id: 'sk' };
  board[0][8] = { ...template[0][4]!, id: 'gk' };
  board[4][4] = piece;
  for (const [y, x] of [[3, 3], [3, 5], [2, 4], [5, 3], [6, 6]]) board[y][x] = { ...pawn, id: `e${y}${x}`, owner: 'gote', isPawn: false };
  board[5][5] = { ...pawn, id: 'ally', owner: 'sente', isPawn: false };
  return board;
}

function boardProblems(board: Board): string[] {
  const problems: string[] = [];
  if (board.length !== 9 || board.some(r => r.length !== 9)) problems.push('盤の大きさが変わった');
  const ids = board.flat().filter(Boolean).map(p => p!.id);
  if (new Set(ids).size !== ids.length) problems.push('同じ駒が2つある');
  if (board.flat().filter(p => p?.isKing && p.owner === 'sente').length > 1 || board.flat().filter(p => p?.isKing && p.owner === 'gote').length > 1) problems.push('玉が増えた');
  if (board.flat().some(p => p && p.owner !== 'sente' && p.owner !== 'gote')) problems.push('持ち主のない駒がある');
  return problems;
}

/** 5x5 のマス目から、盤の真ん中にいる先手の駒が動けるはずのマス */
function gridMoves(grid: string): Set<string> {
  const g = grid.replace(/\//g, '');
  const cells = new Set<string>();
  for (let i = 0; i < 25; i++) if (g[i] === '1') cells.add(`${4 + Math.floor(i / 5) - 2},${4 + (i % 5) - 2}`);
  return cells;
}

const RETIRED = ['TURN_START', 'ON_APPROACH'] as const;
const EVENTS = ['ON_MOVE', 'ON_CAPTURE', 'ON_PROMOTE', 'ON_TAKEN', 'ON_DROP', 'ON_ALLY_TAKEN'] as const;

const issues = new Map<string, string[]>();
const note = (kind: string, detail: string) => { const list = issues.get(kind) ?? []; if (list.length < 5) list.push(detail); issues.set(kind, list); };
let checked = 0;

const extra = process.argv[2] ? (JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, unknown>[]) : [];
const raws = [...Array.from({ length: 400 }, (_, i) => randomRawPiece(i)), ...extra];

for (const raw of raws) {
  const word = String(raw.word ?? '?');
  let piece: Piece;
  try {
    piece = { ...sanitizePieceData(structuredClone(raw), word), id: 'me', owner: 'sente', isKing: false, isPawn: false, originalPosition: null, coolDownTurnsRemaining: 0, isRevealed: true, isPromoted: false } as Piece;
  } catch (err) {
    note('補正でエラー', `${word}: ${(err as Error).message}`);
    continue;
  }
  if (!piece.abilities?.length) continue;
  checked++;
  const triggers = new Set(piece.abilities.map(a => a.trigger));

  // 2. 廃止した発動タイミングは起きない
  for (const event of RETIRED) {
    if (isTriggerMatching(piece, event)) note(`廃止した発動（${event}）に反応する`, word);
    const res = applyAutomatedEffect(setup(piece), [4, 4], event, 'sente', [], [5, 4]);
    if (res.triggered) note(`廃止した発動（${event}）で能力が動いた`, word);
  }
  // 1. 持っていない発動タイミングでは何も起きない
  for (const event of EVENTS) {
    const has = triggers.has(event);
    if (isTriggerMatching(piece, event) !== has) note('発動の判定が能力とずれている', `${word}: ${event} 判定=${isTriggerMatching(piece, event)} 能力=${has}`);
    if (has || event === 'ON_TAKEN') continue;
    const board = setup(piece);
    const before = JSON.stringify(board);
    drainTilePlacements();
    const res = applyAutomatedEffect(board, [4, 4], event, 'sente', [], [5, 4]);
    if (res.triggered || JSON.stringify(res.board) !== before || drainTilePlacements().length) {
      note('持っていない発動タイミングで盤面が変わった', `${word}: ${event}（能力の発動: ${[...triggers].join(',')}）`);
    }
  }
  // 4. 発動しても盤面が壊れない
  for (const event of EVENTS) {
    if (!triggers.has(event)) continue;
    try {
      const board = setup(piece);
      if (event === 'ON_TAKEN') board[4][4] = { ...pawn, id: 'attacker', owner: 'gote', isPawn: false };
      const res = applyAutomatedEffect(board, [4, 4], event, 'sente', [], [5, 4], undefined, [], [], undefined, event === 'ON_TAKEN' ? piece : undefined, []);
      if (res.logs.some(l => l.message.startsWith('【能力エラー】'))) note('能力の実行でエラー', `${word}: ${event}`);
      for (const p of boardProblems(res.board)) note(`発動後の盤面: ${p}`, `${word}: ${event}`);
    } catch (err) {
      note('能力の実行で例外', `${word}: ${event}: ${(err as Error).message}`);
    }
  }
  // 5. 勝手に動くのは暴れ馬だけ
  if (isAutonomousPiece(piece) !== (piece.trait?.kind === 'WILD')) note('暴れ馬でないのに勝手に動く扱い（または逆）', `${word}: 性質=${piece.trait?.kind ?? 'なし'} 説明=${piece.description}`);
  // 6. 充填のある能力は、発動した直後にもう一度は発動しない
  for (const event of ['ON_MOVE', 'ON_CAPTURE', 'ON_PROMOTE', 'ON_DROP', 'ON_ALLY_TAKEN'] as const) {
    if (!triggers.has(event)) continue;
    const first = applyAutomatedEffect(setup(piece), [4, 4], event, 'sente', [], [5, 4]);
    if (!first.triggered) continue;
    let at: [number, number] | null = null;
    first.board.forEach((row, y) => row.forEach((p, x) => { if (p?.id === 'me') at = [y, x]; }));
    if (!at) continue;
    const after = first.board[at[0]][at[1]]!;
    // 充填なし（cooldown 0）の能力が同じタイミングにあれば、続けて発動してよい
    if ((after.abilities ?? []).some(a => a.trigger === event && !a.cooldown)) continue;
    const second = applyAutomatedEffect(first.board, at, event, 'sente', [], [5, 4]);
    if (second.triggered) note('充填中なのに続けて発動した', `${word}: ${event}`);
  }
  // 3. 動けるマスは移動範囲どおり（飛・角・香・砲などの遠くまで動く駒は 5x5 で表せないので対象外）
  if (piece.logic_code && piece.logic_code !== 'normal') {
    if (!/^move_like_(rook|bishop|lance|cannon|queen_limit_3)$|^queen_limit_3$/.test(piece.logic_code)) note('移動の種類が想定外', `${word}: logic=${piece.logic_code}`);
    continue;
  }
  const board = setup(piece);
  const expected = gridMoves(piece.range_geometry?.normal_grid ?? '');
  const actual = new Set(getValidMoves(4, 4, board).map(([y, x]) => `${y},${x}`));
  // 味方のいるマスには行けない。敵・空きマスは行ける
  for (const cell of expected) {
    const [y, x] = cell.split(',').map(Number);
    if (board[y][x]?.owner === 'sente') expected.delete(cell);
  }
  const extraMoves = [...actual].filter(c => !expected.has(c));
  const missing = [...expected].filter(c => !actual.has(c));
  if (extraMoves.length || missing.length) note('動けるマスが移動範囲と違う', `${word}: logic=${piece.logic_code} 余分${extraMoves.length} 不足${missing.length}`);
}

console.log(`能力プログラムの駒 ${checked} 個を調べました（ランダム ${Math.min(400, raws.length)} ＋ 実際の駒 ${extra.length}）\n`);
if (!issues.size) console.log('問題なし');
for (const [kind, list] of issues) console.log(`✗ ${kind}\n    ${list.join('\n    ')}`);
process.exit(issues.size ? 1 : 0);
