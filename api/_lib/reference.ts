// 単語の「元ネタ」を調べる（日本語版 Wikipedia の要約API。無料・キー不要）。
// 駒生成のAI（Gemma 4）は知識が少なく、競走馬・作品・人物などの固有名詞を字面どおりに読んでしまう
// （例: 「ゴールドシップ」を金の船と解釈する）。要約を参考情報としてプロンプトに添えると、元ネタに沿った駒になる。
// 調べられなかったときは参考情報なしで生成する（生成は止めない）。
const SUMMARY_URL = 'https://ja.wikipedia.org/api/rest_v1/page/summary/';
const TIMEOUT_MS = 1_500;
const MAX_CHARS = 220;
// Wikipedia の利用ルールに従い、どのサイトからの問い合わせかを名乗る
const USER_AGENT = 'kaku-shogi/1.0 (https://kaku-shogi.momotech.workers.dev)';

async function summary(title: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SUMMARY_URL + encodeURIComponent(title), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as { type?: string; extract?: string };
    const text = (data.extract || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    // 曖昧さ回避ページは「◯◯は次のものを指す」だけなので、意味の候補として短く渡す
    return [...text].slice(0, MAX_CHARS).join('');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 単語ごとの参考情報（words と同じ順。無ければ null）。
 * 合体駒「A×B」は A と B をそれぞれ調べる。
 */
export async function lookupReferences(words: string[]): Promise<(string | null)[]> {
  return Promise.all(words.map(async word => {
    const parts = word.split('×').map(p => p.trim()).filter(Boolean);
    const found = await Promise.all(parts.map(async part => {
      const text = await summary(part);
      return text ? (parts.length > 1 ? `${part}: ${text}` : text) : null;
    }));
    const joined = found.filter(Boolean).join(' / ');
    return joined || null;
  }));
}
