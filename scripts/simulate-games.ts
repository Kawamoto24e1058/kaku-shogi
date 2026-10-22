// CPU同士の対局を大量に自動で回し、エラー・固まり・強すぎる駒（バランス崩壊）を探すスクリプト
// 実行: npm run simulate -- [対局数=400] [乱数の種=1]
// App.tsx の手番処理（手番開始の能力 → 指し手 → 移動・駒取り・取られた時の能力 → 地形 → 手番終了の状態異常の経過）を
// 簡略化して再現している。画面の演出や、手動で対象を選ぶ能力の操作は含まない。
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import type { Board, Piece, Player, TileState } from '../src/types';
import { normalizeAbilityPrograms, describeAbilities, abilityPower } from '../shared/abilityProgram';

const {
  initializeBoard, executeMove, executeDrop, applyAutomatedEffect, isTriggerMatching, drainTilePlacements,
  applyTileEffects, createEmptyTileBoard, BOARD_SIZE,
} = await import('../src/gameLogic');
const { chooseCpuMove } = await import('../src/cpuAi');
const { tickAbilityCooldowns } = await import('../src/abilityEngine');
const { sanitizePieceData } = await import('../src/aiGenerator');
const { OFFLINE_ARCHETYPES, buildOfflinePiece } = await import('../src/offlineGenerator');

const GAMES = Number(process.argv[2] || 400);
let seed = Number(process.argv[3] || 1);
const rand = () => {
  // 再現できるように固定の乱数（mulberry32）
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Math.random = rand;
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

// ===== 駒の候補 =====
interface PoolEntry { name: string; data: Record<string, unknown>; kind: 'offline' | 'ai-like' | 'random' }
const pool: PoolEntry[] = [];
for (const archetype of OFFLINE_ARCHETYPES) {
  pool.push({ name: `簡易:${archetype.key}`, data: buildOfflinePiece(`簡易${archetype.key}`, archetype) as unknown as Record<string, unknown>, kind: 'offline' });
}
// 実際の AI 出力で見た形の能力（今回の試作で出たもの）
const AI_LIKE: Record<string, unknown[]> = {
  新幹線: [{ name: '轢断', trigger: 'ON_MOVE', target: { area: 'FRONT_LINE', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'PUSH', value: 3 }, { op: 'STUN', value: 1 }], cooldown: 2 }],
  ロキ: [{ name: '幻惑', trigger: 'ON_MOVE', effects: [{ op: 'STEALTH' }], cooldown: 3 },
    { name: '変装', trigger: 'ON_TAKEN', condition: 'CHANCE', condition_value: 50, target: { area: 'ATTACKER', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'TRANSFORM_PAWN' }] }],
  ゴールドシップ: [{ name: '大回転', trigger: 'ON_APPROACH', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'STUN', value: 2 }], cooldown: 3 },
    { name: '黄金旋風', trigger: 'ON_PROMOTE', target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'PUSH', value: 2 }, { op: 'STUN', value: 1 }], cooldown: 99 }],
  回転寿司: [{ name: '流転', trigger: 'EVERY_N_TURNS', every: 3, target: { area: 'ROW', who: 'ANY', pick: 'ALL' }, effects: [{ op: 'PUSH', value: 1 }] },
    { name: '配膳', trigger: 'ON_CAPTURE', target: { area: 'ADJACENT', who: 'EMPTY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'SPAWN', value: 1 }], cooldown: 4 }],
  線香花火: [{ name: '火の粉', trigger: 'ON_MOVE', target: { area: 'SELF' }, effects: [{ op: 'TILE', tile: 'FIRE', value: 2 }], cooldown: 1 },
    { name: '終焉', trigger: 'ON_TAKEN', target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'DESTROY' }], cooldown: 99 }],
  'コーヒー×神': [{ name: '覚醒', trigger: 'TURN_START', target: { area: 'RADIUS_2', who: 'ALLY', pick: 'ALL' }, effects: [{ op: 'CLEANSE' }], cooldown: 3 },
    { name: '忘却', trigger: 'ON_APPROACH', target: { area: 'ADJACENT', who: 'ENEMY', pick: 'NEAREST', count: 1 }, effects: [{ op: 'SILENCE', value: 2 }, { op: 'DOOM', value: 3 }], cooldown: 4 }],
};
const baseRange = { normal_grid: '00000/01110/01210/01110/00000', promoted_grid: '01110/01110/01210/01110/01110' };
for (const [word, abilities] of Object.entries(AI_LIKE)) {
  pool.push({ name: `AI風:${word}`, kind: 'ai-like', data: { word, effect_name: word, range_geometry: baseRange, abilities, description: word, promoted_effect: { effect_name: `${word}・醒`, description: '' }, logic_code: 'normal' } });
}
// 部品をでたらめに組み合わせた能力（AI がおかしな組み合わせを出した場合の確認用）
const TRIGGERS = ['ON_MOVE', 'TURN_START', 'EVERY_N_TURNS', 'ON_CAPTURE', 'ON_TAKEN', 'ON_APPROACH', 'ON_PROMOTE'];
const AREAS = ['SELF', 'ADJACENT', 'RADIUS_2', 'FRONT_LINE', 'LINES_8', 'DIAGONALS', 'CROSS', 'ROW', 'COLUMN', 'ALL', 'ENEMY_KING_AROUND', 'ATTACKER', '01110/00000/00200/00000/00000'];
const OPS = ['DESTROY', 'CAPTURE', 'PUSH', 'PULL', 'SWAP', 'TELEPORT', 'FREEZE', 'STUN', 'SILENCE', 'CONTROL', 'DOOM', 'TRANSFORM_PAWN', 'SHIELD', 'GUARD', 'STEALTH', 'CLEANSE', 'EXTRA_ACTION', 'SPAWN', 'WALL', 'TILE', 'STEAL_HAND'];
const CONDITIONS = ['NONE', 'NONE', 'NONE', 'IN_ENEMY_CAMP', 'ENEMIES_NEAR_AT_LEAST', 'CHANCE', 'PROMOTED', 'MY_HAND_AT_LEAST'];
for (let i = 0; i < 40; i++) {
  const abilities = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({
    name: `乱${i}`, trigger: pick(TRIGGERS), every: 2 + Math.floor(rand() * 3), condition: pick(CONDITIONS), condition_value: 1 + Math.floor(rand() * 60),
    target: { area: pick(AREAS), who: pick(['ENEMY', 'ALLY', 'ANY', 'EMPTY']), pick: pick(['ALL', 'NEAREST', 'STRONGEST', 'RANDOM']), count: 1 + Math.floor(rand() * 3) },
    effects: Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({ op: pick(OPS), value: 1 + Math.floor(rand() * 8), tile: pick(['FIRE', 'POISON', 'ICE', 'BOMB', 'TRAP']) })),
    cooldown: Math.floor(rand() * 3),
  }));
  pool.push({ name: `乱数${i}`, kind: 'random', data: { word: `乱数${i}`, effect_name: `乱${i}`, range_geometry: baseRange, abilities, description: '', promoted_effect: { effect_name: '醒', description: '' }, logic_code: 'normal' } });
}

// ルールが許す範囲で一番強い組み合わせ（強さの自動調整が効いているかの確認用）
const EXTREME: Record<string, unknown[]> = {
  全滅: [{ name: '全滅', trigger: 'TURN_START', target: { area: 'ALL', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'DESTROY' }] }],
  全捕獲: [{ name: '全捕獲', trigger: 'ON_MOVE', target: { area: 'ALL', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'CAPTURE' }] }],
  大寝返り: [{ name: '大寝返り', trigger: 'ON_MOVE', target: { area: 'RADIUS_2', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'CONTROL', value: 2 }] }],
  連続行動: [{ name: '連続行動', trigger: 'ON_MOVE', effects: [{ op: 'EXTRA_ACTION' }] }],
  毎手狙撃: [{ name: '毎手狙撃', trigger: 'TURN_START', target: { area: 'ALL', who: 'ENEMY', pick: 'STRONGEST', count: 1 }, effects: [{ op: 'DESTROY' }] }],
  玉封じ: [{ name: '玉封じ', trigger: 'TURN_START', target: { area: 'ENEMY_KING_AROUND', who: 'EMPTY', pick: 'ALL' }, effects: [{ op: 'WALL', value: 4 }] }],
  全凍結: [{ name: '全凍結', trigger: 'TURN_START', target: { area: 'ALL', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'FREEZE', value: 3 }] }],
  罠囲い: [{ name: '罠囲い', trigger: 'TURN_START', target: { area: 'ENEMY_KING_AROUND', who: 'EMPTY', pick: 'ALL' }, effects: [{ op: 'TILE', tile: 'TRAP', value: 5 }] }],
  毒囲い: [{ name: '毒囲い', trigger: 'TURN_START', target: { area: 'ENEMY_KING_AROUND', who: 'ANY', pick: 'ALL' }, effects: [{ op: 'TILE', tile: 'POISON', value: 5 }] }],
  分身囲い: [{ name: '分身囲い', trigger: 'TURN_START', target: { area: 'ENEMY_KING_AROUND', who: 'EMPTY', pick: 'ALL' }, effects: [{ op: 'SPAWN', value: 3 }] }],
  玉周り麻痺: [{ name: '玉周り麻痺', trigger: 'TURN_START', target: { area: 'ENEMY_KING_AROUND', who: 'ENEMY', pick: 'ALL' }, effects: [{ op: 'STUN', value: 3 }] }],
};
for (const [word, abilities] of Object.entries(EXTREME)) {
  pool.push({ name: `極端:${word}`, kind: 'random', data: { word, effect_name: word, range_geometry: baseRange, abilities, description: word, promoted_effect: { effect_name: `${word}・醒`, description: '' }, logic_code: 'normal' } });
}

let idCounter = 0;
const makePiece = (entry: PoolEntry, owner: Player): Piece => ({
  ...sanitizePieceData(structuredClone(entry.data), String(entry.data.word)),
  id: `p${idCounter++}`, owner, isKing: false, isPawn: false, originalPosition: null,
  coolDownTurnsRemaining: 0, isRevealed: true, isPromoted: false,
}) as Piece;

// ===== 1局 =====
interface GameResult {
  winner: Player | null; plies: number; error?: string; stall?: boolean; reason?: string;
  sentePool: string[]; gotePool: string[]; maxPieces: number; extraActionChain: number; abilityTriggers: number;
}

function place(board: Board, pieces: Piece[], rows: number[]) {
  const cells: [number, number][] = [];
  for (const y of rows) for (let x = 0; x < BOARD_SIZE; x++) if (!board[y][x]) cells.push([y, x]);
  cells.sort(() => rand() - 0.5);
  pieces.forEach((p, i) => { const c = cells[i]; if (c) board[c[0]][c[1]] = { ...p, originalPosition: c }; });
}

const kingAlive = (board: Board, p: Player) => board.some(row => row.some(c => c?.isKing && c.owner === p));
const countPieces = (board: Board) => board.flat().filter(Boolean).length;
const opp = (p: Player): Player => (p === 'sente' ? 'gote' : 'sente');

function playGame(senteEntries: PoolEntry[], goteEntries: PoolEntry[]): GameResult {
  let board = initializeBoard();
  place(board, senteEntries.map(e => makePiece(e, 'sente')), [6, 7, 8]);
  place(board, goteEntries.map(e => makePiece(e, 'gote')), [0, 1, 2]);
  let tileBoard: (TileState | null)[][] = createEmptyTileBoard();
  const hands: Record<Player, Piece[]> = { sente: [], gote: [] };
  const graveyard: Piece[] = [];
  let turn: Player = 'sente';
  let maxPieces = countPieces(board);
  let extraActionChain = 0;
  let abilityTriggers = 0;
  const res0 = { sentePool: senteEntries.map(e => e.name), gotePool: goteEntries.map(e => e.name) };

  const runEffect = (pos: [number, number], trigger: Parameters<typeof applyAutomatedEffect>[2], owner: Player, from?: [number, number], dead?: Piece) => {
    const r = applyAutomatedEffect(board, pos, trigger, owner, hands[owner], from, undefined, [], graveyard, undefined, dead, hands[opp(owner)]);
    if (r.logs.some(l => l.message.startsWith('【能力エラー】'))) throw new Error(`ability crashed (${trigger}) ${dead?.word ?? board[pos[0]][pos[1]]?.word}`);
    if (r.triggered) abilityTriggers++;
    board = r.board;
    hands[owner] = r.capturedPieces;
    if (r.opponentCapturedPieces) hands[opp(owner)] = r.opponentCapturedPieces;
    return r;
  };

  for (let ply = 0; ply < 300; ply++) {
    // 手番開始の能力
    for (let y = 0; y < BOARD_SIZE; y++) for (let x = 0; x < BOARD_SIZE; x++) {
      const p = board[y][x];
      if (p && p.owner === turn && !p.isKing && (p.coolDownTurnsRemaining ?? 0) === 0 && isTriggerMatching(p, 'TURN_START')) runEffect([y, x], 'TURN_START', turn);
    }
    if (!kingAlive(board, turn)) return { winner: opp(turn), plies: ply, reason: 'king-gone-turnstart', maxPieces, extraActionChain, abilityTriggers, ...res0 };

    let actions = 0;
    let again = true;
    while (again) {
      again = false;
      actions++;
      if (actions > 6) return { winner: null, plies: ply, error: 'extra action loop (>6 actions in one turn)', maxPieces, extraActionChain, abilityTriggers, ...res0 };
      const move = chooseCpuMove(board, hands[turn], [], turn, rand);
      if (!move) break;
      if (move.type === 'move' && move.from) {
        const piece = board[move.from[0]][move.from[1]]!;
        const zone = turn === 'sente' ? move.to[0] <= 2 : move.to[0] >= 6;
        const promote = zone && !piece.isKing && !piece.isPromoted;
        const res = executeMove(board, move.from, move.to, turn, promote, undefined, true, false, hands);
        board = res.board;
        const captured = res.capturedPieces?.length ? res.capturedPieces : res.capturedPiece ? [res.capturedPiece] : [];
        for (const cap of captured) {
          if (cap.isKing) return { winner: turn, plies: ply, reason: 'king-captured', maxPieces, extraActionChain, abilityTriggers, ...res0 };
          if (!board.some(r => r.some(c => c?.id === cap.id))) hands[turn].push({ ...cap, owner: turn, isPromoted: false, coolDownTurnsRemaining: 0, isRevealed: true });
        }
        for (const ev of res.abilityEvents ?? []) {
          if (ev.triggerType === 'ON_TAKEN' || ev.triggerType === 'ON_DEATH') {
            runEffect(ev.position, ev.triggerType, ev.owner, undefined, ev.targetCellPiece);
            hands[turn] = hands[turn].filter(p => p.id !== ev.pieceId);
          } else if (ev.triggerType === 'ON_APPROACH' && board[ev.position[0]][ev.position[1]]) {
            runEffect(ev.position, 'ON_APPROACH', ev.owner);
          }
        }
        const landing = board[move.to[0]][move.to[1]];
        if (landing && landing.owner === turn && (landing.coolDownTurnsRemaining ?? 0) === 0) {
          let r: ReturnType<typeof runEffect> | null = null;
          if (isTriggerMatching(landing, 'ON_MOVE')) r = runEffect(move.to, 'ON_MOVE', turn, move.from);
          const again2 = board[move.to[0]][move.to[1]];
          if (captured.length && again2 && again2.id === landing.id && isTriggerMatching(again2, 'ON_CAPTURE')) r = runEffect(move.to, 'ON_CAPTURE', turn, move.from) ?? r;
          const again3 = board[move.to[0]][move.to[1]];
          if (promote && again3 && again3.id === landing.id && isTriggerMatching(again3, 'ON_PROMOTE')) r = runEffect(move.to, 'ON_PROMOTE', turn, move.from) ?? r;
          if (r?.reAction) { again = true; extraActionChain = Math.max(extraActionChain, actions); }
        }
      } else if (move.piece && move.index !== undefined) {
        board = executeDrop(board, move.piece, move.to, turn);
        hands[turn] = hands[turn].filter((_, i) => i !== move.index);
      }
      if (!kingAlive(board, opp(turn))) return { winner: turn, plies: ply, reason: 'king-gone', maxPieces, extraActionChain, abilityTriggers, ...res0 };
      if (!kingAlive(board, turn)) return { winner: opp(turn), plies: ply, reason: 'own-king-gone', maxPieces, extraActionChain, abilityTriggers, ...res0 };
    }

    // 地形と手番終了の処理
    for (const { y, x, tile } of drainTilePlacements()) tileBoard[y][x] = tile;
    const tr = applyTileEffects(board, tileBoard, turn, []);
    board = tr.board; tileBoard = tr.tileBoard;
    const next = opp(turn);
    board = board.map(row => row.map(p => {
      if (!p) return p;
      let u: Piece = { ...p };
      if (u.owner === next) {
        const cd = u.coolDownTurnsRemaining ?? 0;
        if (cd > 0 && cd !== 99) u.coolDownTurnsRemaining = cd - 1;
        u = { ...u, abilityCooldowns: tickAbilityCooldowns(u).abilityCooldowns };
      }
      if (u.owner === turn) {
        if (u.stunTurnsRemaining) u.stunTurnsRemaining -= 1;
        if (u.frozenDuration) { u.frozenDuration -= 1; if (u.frozenDuration === 0) u.isFrozen = false; }
        if (u.isSilenced && u.silenceDuration) { u.silenceDuration -= 1; if (u.silenceDuration === 0) u.isSilenced = false; }
        if (u.hasAbsoluteGuard && u.guardDuration) { u.guardDuration -= 1; if (u.guardDuration === 0) u.hasAbsoluteGuard = false; }
        if (u.isMindControlled && u.originalPlayer) {
          if ((u.controlDuration ?? 0) > 1) u.controlDuration = (u.controlDuration ?? 0) - 1;
          else { u.owner = u.originalPlayer; u.isMindControlled = false; u.originalPlayer = undefined; u.controlDuration = undefined; }
        }
        if (u.deathCountdown) { u.deathCountdown -= 1; if (u.deathCountdown === 0) return null; }
        if ((u.type === 'wall' || u.type === 'hazard') && u.duration) { u.duration -= 1; if (u.duration === 0) return null; }
      }
      return u;
    }));
    if (!kingAlive(board, 'sente') || !kingAlive(board, 'gote')) {
      return { winner: kingAlive(board, 'sente') ? 'sente' : kingAlive(board, 'gote') ? 'gote' : null, plies: ply, reason: 'king-gone-end', maxPieces, extraActionChain, abilityTriggers, ...res0 };
    }
    // 盤の整合性
    const ids = board.flat().filter(Boolean).map(p => p!.id);
    if (new Set(ids).size !== ids.length) return { winner: null, plies: ply, error: 'duplicate piece id on board', maxPieces, extraActionChain, abilityTriggers, ...res0 };
    maxPieces = Math.max(maxPieces, countPieces(board));
    turn = next;
  }
  return { winner: null, plies: 300, stall: true, maxPieces, extraActionChain, abilityTriggers, ...res0 };
}

// ===== 実行と集計 =====
// FOCUS=駒名 を付けると「先手だけがその駒＋簡易生成の駒2つ、後手は簡易生成の駒3つ」で回し、その駒の強さを比べる（FOCUS=none で比較の基準）
const FOCUS = process.env.FOCUS;
const offline = pool.filter(e => e.kind === 'offline');
const results: GameResult[] = [];
const started = Date.now();
for (let g = 0; g < GAMES; g++) {
  const focus = FOCUS && FOCUS !== 'none' ? pool.find(e => e.name === FOCUS) : null;
  if (FOCUS && FOCUS !== 'none' && !focus) throw new Error(`unknown FOCUS ${FOCUS}`);
  // 先手後手の有利不利を消すため、注目する駒は奇数局で後手に持たせる
  const flip = FOCUS ? g % 2 === 1 : false;
  const withFocus = FOCUS ? [focus ?? pick(offline), pick(offline), pick(offline)] : [pick(pool), pick(pool), pick(pool)];
  const other = FOCUS ? [pick(offline), pick(offline), pick(offline)] : [pick(pool), pick(pool), pick(pool)];
  const s = flip ? other : withFocus;
  const o = flip ? withFocus : other;
  try {
    results.push(playGame(s, o));
  } catch (err) {
    results.push({ winner: null, plies: -1, error: (err as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? String(err), maxPieces: 0, extraActionChain: 0, abilityTriggers: 0, sentePool: s.map(e => e.name), gotePool: o.map(e => e.name) });
  }
}

const errors = results.filter(r => r.error);
const stalls = results.filter(r => r.stall);
const finished = results.filter(r => r.winner);
const plies = finished.map(r => r.plies).sort((a, b) => a - b);
console.log(`対局 ${results.length}（${((Date.now() - started) / 1000).toFixed(0)}秒） 決着 ${finished.length} / 300手で終わらず ${stalls.length} / エラー ${errors.length}`);
if (FOCUS) {
  const focusWins = results.filter((r, g) => r.winner === (g % 2 === 1 ? 'gote' : 'sente')).length;
  console.log(`注目: ${FOCUS} を持った側の勝率 ${(focusWins / Math.max(1, finished.length) * 100).toFixed(1)}%（決着 ${finished.length}局）`);
}
console.log(`先手勝率 ${(finished.filter(r => r.winner === 'sente').length / Math.max(1, finished.length) * 100).toFixed(1)}% / 手数 中央値 ${plies[Math.floor(plies.length / 2)] ?? '-'}（最短 ${plies[0] ?? '-'}）`);
console.log(`1局の最大駒数 ${Math.max(...results.map(r => r.maxPieces))} / 1手番の最大連続行動 ${Math.max(...results.map(r => r.extraActionChain))} / 能力の発動 平均 ${(results.reduce((a, r) => a + r.abilityTriggers, 0) / results.length).toFixed(1)}回/局`);
const reasons = new Map<string, number>();
for (const r of finished) reasons.set(r.reason ?? '?', (reasons.get(r.reason ?? '?') ?? 0) + 1);
console.log('決着の仕方:', [...reasons].map(([k, v]) => `${k}=${v}`).join(' '));
const shortGames = finished.filter(r => r.plies < 10);
if (shortGames.length) console.log(`\n⚠ 10手未満で決着: ${shortGames.length}局`, shortGames.slice(0, 5).map(r => `${r.plies}手 ${r.reason} 勝者側=${(r.winner === 'sente' ? r.sentePool : r.gotePool).join('/')}`));

if (errors.length) {
  console.log('\n■ エラー');
  const grouped = new Map<string, GameResult[]>();
  for (const r of errors) grouped.set(r.error!, [...(grouped.get(r.error!) ?? []), r]);
  for (const [msg, list] of grouped) console.log(`  ${list.length}件: ${msg}\n    例: ${list[0].sentePool.join('/')} vs ${list[0].gotePool.join('/')}`);
}

// 駒ごとの勝率（その駒を持っていた側が勝った割合）
const stats = new Map<string, { games: number; wins: number }>();
for (const r of finished) {
  for (const [side, names] of [['sente', r.sentePool], ['gote', r.gotePool]] as const) {
    for (const name of new Set(names)) {
      const s = stats.get(name) ?? { games: 0, wins: 0 };
      s.games++; if (r.winner === side) s.wins++;
      stats.set(name, s);
    }
  }
}
const ranked = [...stats].filter(([, s]) => s.games >= 15).map(([name, s]) => ({ name, rate: s.wins / s.games, games: s.games })).sort((a, b) => b.rate - a.rate);
console.log('\n■ 勝率の高い駒（15局以上）');
for (const r of ranked.slice(0, 10)) {
  const entry = pool.find(e => e.name === r.name)!;
  const programs = normalizeAbilityPrograms(entry.data.abilities);
  const power = programs ? Math.max(...programs.map(abilityPower)) : null;
  console.log(`  ${(r.rate * 100).toFixed(0)}% (${r.games}局) ${r.name}${programs ? `  強さ見積もり${power}  ${describeAbilities(programs).replace(/\n/g, ' / ').slice(0, 140)}` : ''}`);
}
console.log('■ 勝率の低い駒');
for (const r of ranked.slice(-5)) console.log(`  ${(r.rate * 100).toFixed(0)}% (${r.games}局) ${r.name}`);
process.exit(errors.length ? 1 : 0);
