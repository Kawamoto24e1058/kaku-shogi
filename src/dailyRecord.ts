// 「今日のお題」の自己ベスト（この端末の localStorage にだけ保存する）

interface DailyRecord {
  /** 勝ったときの最少手数 */
  best: number | null;
  /** 最後に記録した対局（同じ対局を何度記録しても結果が変わらないように） */
  lastGameId?: string;
  lastWasNewBest?: boolean;
}

const storageKey = (key: string) => `kaku_daily_${key}`;

function read(key: string): DailyRecord {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? { best: null, ...JSON.parse(raw) } : { best: null };
  } catch {
    return { best: null };
  }
}

export function getDailyBest(key: string): number | null {
  return read(key).best;
}

/**
 * 対局結果を記録して、自己ベストと更新したかを返す。
 * 対局終了画面の表示中に何度呼ばれても、同じ gameId なら最初の結果を返す。
 */
export function recordDailyResult(key: string, gameId: string, won: boolean, moves: number): { best: number | null; isNewBest: boolean } {
  const record = read(key);
  if (record.lastGameId === gameId) return { best: record.best, isNewBest: !!record.lastWasNewBest };
  const isNewBest = won && moves > 0 && (record.best === null || moves < record.best);
  const next: DailyRecord = { best: isNewBest ? moves : record.best, lastGameId: gameId, lastWasNewBest: isNewBest };
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(next));
  } catch {
    // 保存できない環境（プライベートブラウズなど）では表示だけ
  }
  return { best: next.best, isNewBest };
}
