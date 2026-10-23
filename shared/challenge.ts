// 合体駒と「今日のお題」（クライアント・サーバー共通）
import { SEED_WORDS } from './seedWords.js';

// ===== 合体駒 =====
/** 合体駒の区切り。「猫×新幹線」のように2語をつなぐ */
export const FUSION_MARK = '×';
const FUSION_SPLIT = /\s*[×xX✕＊*+＋&＆]\s*/;

/**
 * 「猫+新幹線」「猫 x 新幹線」などを「猫×新幹線」にそろえる。
 * 2語に分かれない（1語だけ・3語以上・空の部分がある）ときはそのまま返す。
 * 英単語の中の x（例: box）を壊さないよう、区切りの前後どちらかが英字なら x は区切りとみなさない。
 */
export function normalizeFusionWord(word: string): string {
  const parts = splitFusion(word);
  return parts ? parts.join(FUSION_MARK) : word;
}

/** 合体駒なら2語を返す */
export function splitFusion(word: string): [string, string] | null {
  const parts = word.split(FUSION_SPLIT);
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return null;
  // 「box」「Max」など英字に挟まれた x / X は区切りではない
  const m = word.match(FUSION_SPLIT);
  if (m && /^[xX]$/.test(m[0].trim())) {
    const idx = m.index ?? 0;
    const before = word[idx - 1] ?? '';
    const after = word[idx + m[0].length] ?? '';
    if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) return null;
  }
  return [parts[0].trim(), parts[1].trim()];
}

// ===== 今日のお題 =====
/** 日本時間の日付キー（YYYY-MM-DD） */
export function dailyKey(date: Date = new Date()): string {
  const jst = new Date(date.getTime() + 9 * 3600_000);
  return jst.toISOString().slice(0, 10);
}

function hash(text: string): number {
  // FNV-1a（同じ日付なら誰の端末でも同じ結果になる）
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * その日のお題3語。事前生成リスト（shared/seedWords.ts）から選ぶので、
 * 共有キャッシュに入っていれば AI を呼ばずに即座に駒ができる。3語目は毎日1つの合体駒。
 */
export function dailyWords(key: string = dailyKey()): string[] {
  const picked: string[] = [];
  let seed = hash(`kaku-shogi:${key}`);
  while (picked.length < 4) {
    const word = SEED_WORDS[seed % SEED_WORDS.length];
    if (!picked.includes(word)) picked.push(word);
    seed = hash(`${seed}`);
  }
  return [picked[0], picked[1], `${picked[2]}${FUSION_MARK}${picked[3]}`];
}

/** 表示用の日付（10/22） */
export function dailyLabel(key: string = dailyKey()): string {
  const [, m, d] = key.split('-');
  return `${Number(m)}/${Number(d)}`;
}
