// 長引いた対局を終わらせるルール（対人・CPU・オンライン・自動対局で共通）
//   - 判定: JUDGE_PLY 手目で決着がついていなければ、盤上と持ち駒の点数が多い側の勝ち
// 自動対局で、能力のない駒どうしでも約1割の対局が300手で終わらなかったため（CPUの指し方による泥沼化）。
// 「150手目から能力の充填を2倍速にする（決戦）」も試したが、決着の数は変わらなかったので入れていない
// サーバー（api/）の型チェックにも含まれるので、src/ の型は読み込まず必要な形だけ書く
type Player = 'sente' | 'gote';
interface JudgePiece {
  owner: Player;
  isKing?: boolean;
  isPawn?: boolean;
  isHisha?: boolean;
  isKaku?: boolean;
  isPromoted?: boolean;
  isObstacle?: boolean;
  type?: string;
}
type Board = (JudgePiece | null)[][];
type Piece = JudgePiece;

/** 判定で決着する手数（先手・後手の手番を合わせた数） */
export const JUDGE_PLY = 250;
/** この手数から、判定までの残りを画面に出す */
const NOTICE_FROM = 200;

/** 判定に使う駒の点数（玉は数えない。成り駒は少し高い） */
export function judgeValue(p: Piece): number {
  if (p.isKing || p.isObstacle || p.type === 'wall' || p.type === 'hazard') return 0;
  const base = p.isHisha || p.isKaku ? 8 : p.isPawn ? 1 : 5;
  return base + (p.isPromoted ? 2 : 0);
}

export interface JudgeResult {
  winner: Player;
  sente: number;
  gote: number;
}

/** 盤上の駒と持ち駒の点数を比べる。同点なら後手の勝ち（先に指せる先手の有利を打ち消す） */
export function judgeGame(board: Board, hands: Record<Player, Piece[]>): JudgeResult {
  const score: Record<Player, number> = { sente: 0, gote: 0 };
  for (const row of board) for (const p of row) if (p) score[p.owner] += judgeValue(p);
  for (const side of ['sente', 'gote'] as const) for (const p of hands[side] ?? []) score[side] += judgeValue(p);
  return { winner: score.sente > score.gote ? 'sente' : 'gote', sente: score.sente, gote: score.gote };
}

/** 画面に出す案内（判定が近づいたら残り手数） */
export function endgameNotice(ply: number): string | null {
  if (ply < NOTICE_FROM) return null;
  return `あと${Math.max(0, JUDGE_PLY - ply)}手で判定（盤上と持ち駒の点数が多い方の勝ち）`;
}
