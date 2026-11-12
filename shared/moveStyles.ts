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
