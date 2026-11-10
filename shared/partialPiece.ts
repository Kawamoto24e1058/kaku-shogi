// AIが書いている途中の文章から、書き終わった項目だけを取り出す（生成中の駒を少しずつ見せるため）。
// JSON 全体はまだ閉じていないので、項目ごとに「値が閉じているか」を確かめてから読む。

export interface PartialPiece {
  /** AIが混雑していて、回復を待っている秒数（サーバーの wait 行。AIの出力ではない） */
  wait_seconds?: number;
  /** 読み解き（AIが最初に書く。元ネタ・一番の特徴・将棋でどう働くか） */
  deep_search_analysis?: string;
  effect_name?: string;
  ability_genre?: string;
  description?: string;
  appearance?: { color?: string; accent?: string; emblem?: string };
  range_geometry?: { normal_grid?: string };
}

/** start から始まる JSON の値（文字列・オブジェクト・配列）の終わりの位置。閉じていなければ -1 */
function valueEnd(text: string, start: number): number {
  const open = text[start];
  if (open === '"') {
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '\\') i++;
      else if (text[i] === '"') return i + 1;
    }
    return -1;
  }
  if (open !== '{' && open !== '[') return -1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function readField(text: string, key: string): unknown {
  const match = new RegExp(`"${key}"\\s*:\\s*`).exec(text);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const end = valueEnd(text, start);
  if (end < 0) return undefined;
  try {
    return JSON.parse(text.slice(start, end));
  } catch {
    return undefined;
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** 書き終わった項目だけを、表示に使える形で返す（1語ぶんの出力を想定） */
export function extractPartialPiece(text: string): PartialPiece {
  const partial: PartialPiece = {};
  const analysis = str(readField(text, 'deep_search_analysis'), 160);
  if (analysis) partial.deep_search_analysis = analysis;
  const effectName = str(readField(text, 'effect_name'), 20);
  if (effectName) partial.effect_name = effectName;
  const genre = str(readField(text, 'ability_genre'), 20);
  if (genre) partial.ability_genre = genre;
  const description = str(readField(text, 'description'), 200);
  if (description) partial.description = description;

  const appearance = readField(text, 'appearance') as Record<string, unknown> | undefined;
  if (appearance && typeof appearance === 'object') {
    const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined);
    partial.appearance = { color: hex(appearance.color), accent: hex(appearance.accent), emblem: str(appearance.emblem, 2) };
  }
  const range = readField(text, 'range_geometry') as Record<string, unknown> | undefined;
  const grid = range && typeof range === 'object' ? range.normal_grid : undefined;
  if (typeof grid === 'string' && /^[012]{5}(\/[012]{5}){4}$/.test(grid)) partial.range_geometry = { normal_grid: grid };
  return partial;
}
