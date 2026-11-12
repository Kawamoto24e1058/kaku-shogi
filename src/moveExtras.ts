// 移動の特徴（shared/moveStyles.ts の MOVE_EXTRAS）で増える行き先。getValidMoves から呼ぶ。
// ここでは gameLogic を読み込まない（gameLogic から呼ばれるので、循環しないように）
import type { Board, Piece } from './types';
import { MOVE_EXTRA_SPECS } from '../shared/moveStyles';

const SIZE = 9;
const inBounds = (y: number, x: number) => y >= 0 && y < SIZE && x >= 0 && x < SIZE;
const blocks = (p: Piece | null) => !!p && (p.isObstacle === true || p.type === 'wall' || p.type === 'hazard');

/** 駒ごとの乱数の種。駒が動くたびに executeMove で進める（オンラインの両端末・CPU・先読みで同じ行き先になる） */
export function initialMoveSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
export const nextMoveSeed = (seed: number) => (Math.imul(seed, 1103515245) + 12345) >>> 0;

/** 滑る: 方向ごとに最大 range マス。味方の駒の手前・敵の駒（取れる）で止まる */
function slide(board: Board, y: number, x: number, piece: Piece, dirs: [number, number][], range: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [dy, dx] of dirs) {
    for (let step = 1; step <= range; step++) {
      const ny = y + dy * step;
      const nx = x + dx * step;
      if (!inBounds(ny, nx)) break;
      const t = board[ny][nx];
      if (t) {
        if (t.owner !== piece.owner && !blocks(t)) out.push([ny, nx]);
        break;
      }
      out.push([ny, nx]);
    }
  }
  return out;
}

/**
 * 移動の特徴で増える行き先（マス目の行き先とは別に足す）。
 * grid は今使っている 5x5 のマス目（成っていれば成った後のもの。端から端へで使う）
 */
export function extraMoves(board: Board, y: number, x: number, piece: Piece, grid: string | undefined): [number, number][] {
  const extra = piece.move_extra;
  if (!extra) return [];
  const spec = MOVE_EXTRA_SPECS[extra.kind];
  // 封印中は移動の特徴も使えない（能力と同じく「特別な力」として封じられる）
  if (piece.isSilenced) return [];
  // 成ると、滑る動きは1マス伸びる（その特徴の最大値まで）。
  const base = extra.range ?? spec.range?.[2] ?? 1;
  const isSlide = extra.kind === 'SLIDE_DIAGONAL' || extra.kind === 'SLIDE_ORTHOGONAL' || extra.kind === 'SLIDE_FORWARD';
  // 「移動が広がる」成り方（指定がない駒も）のときだけ
  const grows = !piece.promotion || piece.promotion.kind === 'GROW_MOVE';
  const range = piece.isPromoted && grows && isSlide && spec.range ? Math.min(spec.range[1], base + 1) : base;
  const forward = piece.owner === 'sente' ? -1 : 1;
  switch (extra.kind) {
    case 'SLIDE_DIAGONAL':
      return slide(board, y, x, piece, [[-1, -1], [-1, 1], [1, -1], [1, 1]], range);
    case 'SLIDE_ORTHOGONAL':
      return slide(board, y, x, piece, [[-1, 0], [1, 0], [0, -1], [0, 1]], range);
    case 'SLIDE_FORWARD':
      return slide(board, y, x, piece, [[forward, 0]], range);
    case 'RANDOM_WARP': {
      // 周囲 range マス以内の空きマスから、乱数の種で2か所（玉を取る手にはならないよう空きマスだけ）
      const cells: [number, number][] = [];
      for (let dy = -range; dy <= range; dy++) for (let dx = -range; dx <= range; dx++) {
        const ny = y + dy; const nx = x + dx;
        if ((dy || dx) && inBounds(ny, nx) && !board[ny][nx]) cells.push([ny, nx]);
      }
      let seed = piece.moveSeed ?? initialMoveSeed(piece.id);
      const picked: [number, number][] = [];
      for (let k = 0; k < 2 && cells.length; k++) {
        seed = nextMoveSeed(seed);
        picked.push(cells.splice(seed % cells.length, 1)[0]);
      }
      return picked;
    }
    case 'EDGE_WRAP': {
      // マス目の行き先のうち、左右の端からはみ出すものを反対側へ回す
      const g = (grid ?? '').replace(/\//g, '');
      if (g.length !== 25) return [];
      const out: [number, number][] = [];
      const isSente = piece.owner === 'sente';
      for (let i = 0; i < 25; i++) {
        if (g[i] !== '1') continue;
        const r = Math.floor(i / 5); const c = i % 5;
        const ny = y + (isSente ? r - 2 : 2 - r);
        const rawX = x + (isSente ? c - 2 : 2 - c);
        if (ny < 0 || ny >= SIZE || (rawX >= 0 && rawX < SIZE)) continue;
        const nx = (rawX + SIZE) % SIZE;
        const t = board[ny][nx];
        if (!t || (t.owner !== piece.owner && !blocks(t))) out.push([ny, nx]);
      }
      return out;
    }
    case 'ALLY_HOP': {
      // range マス以内にいる味方（自分と玉以外）の隣の空きマス
      const out: [number, number][] = [];
      const seen = new Set<string>();
      for (let ay = y - range; ay <= y + range; ay++) for (let ax = x - range; ax <= x + range; ax++) {
        if (!inBounds(ay, ax) || (ay === y && ax === x)) continue;
        const ally = board[ay][ax];
        if (!ally || ally.owner !== piece.owner || ally.isKing || blocks(ally)) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ny = ay + dy; const nx = ax + dx;
          const key = `${ny},${nx}`;
          if ((dy || dx) && inBounds(ny, nx) && !board[ny][nx] && !seen.has(key)) { seen.add(key); out.push([ny, nx]); }
        }
      }
      return out;
    }
    default:
      return [];
  }
}
