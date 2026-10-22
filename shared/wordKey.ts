// 単語のキャッシュキー（クライアント・サーバー共通）
// 表記ゆれ（全角/半角、カタカナ/ひらがな、大文字/小文字、空白や記号）を同じ単語として扱い、
// 共有キャッシュの的中率を上げて AI 呼び出し回数を節約する。表示用の単語は別に保持する。

const STRIP = /[\s!！?？。、，,.．・「」『』"'“”‘’]/g;

export function wordKey(word: string): string {
  return word
    .normalize('NFKC')
    .toLowerCase()
    .replace(STRIP, '')
    // カタカナ → ひらがな（長音「ー」はそのまま）
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
