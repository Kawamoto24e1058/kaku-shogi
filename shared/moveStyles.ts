// 移動の型（キャラに合った動き方）。AI は型の名前を選び、マス目はここで決める。
// 以前は AI がマス目を直接書いていて、「縦横1マス」「周囲1マス」の2つが4割を占め、キャラらしさが出ていなかった。
// 5x5 のマス目は上の行が敵陣側（前）。中央 2 = 自分、1 = 動ける。2マス先は飛び越えて動ける（強いので型ごとに2つまで）

export const MOVE_STYLES = ['BALANCED', 'CROSS', 'DIAGONAL', 'RUSHER', 'JUMPER', 'HEAVY', 'GUARDIAN', 'WIDE', 'LONG', 'FLYER'] as const;
export type MoveStyle = typeof MOVE_STYLES[number];

export interface MoveStyleSpec {
  label: string;
  /** どんなキャラに合うか（AI への説明） */
  fits: string;
  grid: string;
}

export const MOVE_STYLE_SPECS: Record<MoveStyle, MoveStyleSpec> = {
  BALANCED: { label: '周囲1マス', fits: '人・道具など、特徴が動きに出ないもの', grid: '0000001110012100111000000' },
  CROSS: { label: '縦横1マス', fits: '素朴・堅実・まじめ', grid: '0000000100012100010000000' },
  DIAGONAL: { label: '斜めと前', fits: '忍び・ずる賢い・すき間を抜ける', grid: '0000001110002000101000000' },
  RUSHER: { label: '前へ突進', fits: '速い・勢い・乗り物・突撃', grid: '0010001110012100000000000' },
  JUMPER: { label: '跳ねる（桂馬）', fits: '身軽・跳ぶ・動物・ばね', grid: '0101000000012100010000000' },
  HEAVY: { label: '前と横だけ', fits: '重い・遅い・大きい・眠い', grid: '0000000100012100000000000' },
  GUARDIAN: { label: '後ろが厚い', fits: '守り・慎重・母・壁・家', grid: '0000000100012100111000000' },
  WIDE: { label: '横に広い', fits: '群れ・波・風・広がる', grid: '0000001110112110000000000' },
  LONG: { label: '縦に長い', fits: '長い・まっすぐ・伸びる・槍', grid: '0010000100012100010000100' },
  FLYER: { label: '斜め前へ飛ぶ', fits: '鳥・空・飛ぶ・軽い', grid: '1000101110002000101000000' },
};

/** AI の出力（英語名・日本語のラベル）から型を読む。知らない値なら null */
export function normalizeMoveStyle(raw: unknown): MoveStyle | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if ((MOVE_STYLES as readonly string[]).includes(name.toUpperCase())) return name.toUpperCase() as MoveStyle;
  return MOVE_STYLES.find(s => MOVE_STYLE_SPECS[s].label === name) ?? null;
}

// ===== 移動の特徴（型のマス目に1つだけ足せる、将棋の飛び道具のような動き・遊び心のある動き） =====
export const MOVE_EXTRAS = ['SLIDE_DIAGONAL', 'SLIDE_ORTHOGONAL', 'SLIDE_FORWARD', 'RANDOM_WARP', 'EDGE_WRAP', 'ALLY_HOP'] as const;
export type MoveExtraKind = typeof MOVE_EXTRAS[number];
export interface MoveExtra {
  kind: MoveExtraKind;
  /** 滑る最大マス数・ワープの半径など */
  range?: number;
}
export interface MoveExtraSpec {
  label: string;
  /** 説明（{n} は range） */
  text: string;
  fits: string;
  /** range の [最小, 最大, 既定]。範囲を持たない特徴は undefined */
  range?: [number, number, number];
  /**
   * 総合力（shared/pieceBudget.ts）での点数（移動のマス1つ＝1点と同じ単位）。
   * 自動対局（scripts/calibrate-budget.ts make-move / fit-move、移動だけの駒180個・2400局）で測った勝率の上乗せから決めた。
   * 測定値（範囲の平均で）: 縦横に滑る +5.1点 / 斜めに滑る +4.4点 / 仲間のもとへ +3.3点 / 気まぐれワープ +1.8点 / 前へ滑る +0.8点 / 端から端へ ±0
   */
  score: (range: number) => number;
}
export const MOVE_EXTRA_SPECS: Record<MoveExtraKind, MoveExtraSpec> = {
  SLIDE_DIAGONAL: { label: '斜めに滑る', text: '斜め4方向へ最大{n}マスまで進める（駒があればそこで止まる）', fits: '忍び・すり抜ける・ずる賢い・角', range: [2, 4, 3], score: r => 2.2 * (r - 1) },
  SLIDE_ORTHOGONAL: { label: '縦横に滑る', text: '縦横4方向へ最大{n}マスまで進める（駒があればそこで止まる）', fits: '車・まっすぐ・力強い・飛車', range: [2, 4, 3], score: r => 3 * (r - 1) },
  SLIDE_FORWARD: { label: '前へ滑る', text: '前へ最大{n}マスまで進める（香車のように。駒があればそこで止まる）', fits: '新幹線・矢・弾丸・一直線', range: [2, 6, 4], score: r => 0.3 * (r - 1) },
  RANDOM_WARP: { label: '気まぐれワープ', text: '動くたびに変わる、周囲{n}マス以内の空きマス2か所へ飛べる', fits: '幽霊・猫・気まぐれ・神出鬼没', range: [2, 4, 3], score: r => 0.6 * r },
  EDGE_WRAP: { label: '端から端へ', text: '盤の左右の端を越えると、反対側の端に出られる', fits: '地球・ループ・異次元・回り込む', score: () => 0 },
  ALLY_HOP: { label: '仲間のもとへ', text: '{n}マス以内にいる味方の隣の空きマスへ駆けつけられる', fits: '犬・仲間思い・ヒーロー・群れ', range: [2, 4, 3], score: r => 1 + 0.8 * r },
};

const EXTRA_NAMES: Record<string, MoveExtraKind> = Object.fromEntries(MOVE_EXTRAS.map(k => [MOVE_EXTRA_SPECS[k].label, k]));

/** AI の出力（{kind, range} / 英語名 / 日本語の名前）から移動の特徴を読む。知らない値なら null */
export function normalizeMoveExtra(raw: unknown): MoveExtra | null {
  if (!raw) return null;
  const obj = (typeof raw === 'object' ? raw : { kind: raw }) as Record<string, unknown>;
  const name = String(obj.kind ?? obj.type ?? '').trim();
  const kind = (MOVE_EXTRAS as readonly string[]).includes(name.toUpperCase()) ? name.toUpperCase() as MoveExtraKind : EXTRA_NAMES[name];
  if (!kind) return null;
  const spec = MOVE_EXTRA_SPECS[kind];
  const extra: MoveExtra = { kind };
  if (spec.range) {
    const n = Number(obj.range ?? obj.value);
    extra.range = Number.isFinite(n) ? Math.min(spec.range[1], Math.max(spec.range[0], Math.round(n))) : spec.range[2];
  }
  return extra;
}

export function describeMoveExtra(e: MoveExtra): string {
  const spec = MOVE_EXTRA_SPECS[e.kind];
  return `【移動：${spec.label}】${spec.text.replace('{n}', String(e.range ?? spec.range?.[2] ?? ''))}`;
}

export function moveExtraScore(e: MoveExtra | null | undefined): number {
  if (!e) return 0;
  const spec = MOVE_EXTRA_SPECS[e.kind];
  return spec.score(e.range ?? spec.range?.[2] ?? 1);
}
