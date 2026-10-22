// 不適切な単語のフィルター（クライアント・サーバー共通）
// 入力された単語と、AIが生成した駒の文章の両方に適用する。生成結果はXでそのまま共有されるため、
// 差別語・性的な語・自傷やテロを想起させる語は駒にしない。
// 誤検知を避けるため、普通の言葉の一部になる語（シナ→シナモン、かたわ→かたわら、フェラ→フェラーリ 等）は入れない。追加はサーバーの環境変数 NG_WORDS（カンマ区切り）でも可能。
import { wordKey } from './wordKey.js';

const BASE_NG_WORDS = [
  // 差別・侮蔑
  'キチガイ', '気違い', 'ガイジ', '池沼', 'めくら', 'つんぼ', '穢多', '部落民', '支那人', 'ジャップ',
  'nigger', 'nigga', 'faggot', 'retard',
  // 性的
  'セックス', 'sex', 'レイプ', '強姦', 'ちんこ', 'ちんぽ', 'まんこ', 'ペニス', '中出し', 'av女優', 'エロ動画', 'porn', '痴漢', '児童ポルノ', 'ロリコン',
  // 暴力・自傷・テロ
  '死ね', 'ぶっ殺', '自殺', 'リスカ', '首吊り', 'テロリスト', '爆破予告', '殺害予告',
  // 歴史上の加害を想起させるもの
  'ヒトラー', 'ナチス', 'ハーケンクロイツ', 'isis', '地下鉄サリン', 'オウム真理教',
];

let extraWords: string[] = [];

/** サーバー側で環境変数から追加のNGワードを読み込む */
export function setExtraNgWords(words: string[]): void {
  extraWords = words.map(w => w.trim()).filter(Boolean);
}

function ngKeys(): string[] {
  return [...BASE_NG_WORDS, ...extraWords].map(wordKey).filter(k => k.length >= 2);
}

/** 文字列に不適切な語が含まれるか（表記ゆれは wordKey で吸収） */
export function containsNgWord(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false;
  const key = wordKey(text);
  return ngKeys().some(ng => key.includes(ng));
}

/** 生成された駒の、画面やXの共有に出る文章をまとめて検査する */
export function pieceHasNgText(piece: Record<string, unknown>): boolean {
  const promoted = (piece.promoted_effect || {}) as Record<string, unknown>;
  return [piece.word, piece.effect_name, piece.description, piece.ability_genre, piece.deep_search_analysis,
    promoted.effect_name, promoted.description].some(containsNgWord);
}
