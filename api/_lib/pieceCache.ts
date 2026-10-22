// 共有キャッシュ（Firestore）まわり。API とバックフィルスクリプトで共用する。
//   custom_pieces/{wordKey}     … AI生成済みの駒
//   meta/word_index             … キャッシュ済みキーの一覧（近い単語の検索用。読み取り1回で済ませるため1文書にまとめる）
//   generation_queue/{wordKey}  … AI生成できなかった単語（バックフィル待ち）
import type { Firestore } from 'firebase-admin/firestore';
import type { Json } from './generator.js';

const PIECES = 'custom_pieces';
const INDEX_REF = ['meta', 'word_index'] as const;
const QUEUE = 'generation_queue';

export async function getCachedPiece(db: Firestore, key: string): Promise<Json | null> {
  const snap = await db.collection(PIECES).doc(key).get();
  return snap.exists ? (snap.data() as Json) : null;
}

export async function saveCachedPiece(db: Firestore, key: string, piece: Json, meta: Json): Promise<void> {
  const { FieldValue } = await import('firebase-admin/firestore');
  const batch = db.batch();
  batch.set(db.collection(PIECES).doc(key), { ...piece, ...meta, createdAt: Date.now() });
  batch.set(db.collection(INDEX_REF[0]).doc(INDEX_REF[1]), { keys: FieldValue.arrayUnion(key) }, { merge: true });
  batch.delete(db.collection(QUEUE).doc(key));
  await batch.commit();
}

/** AI生成できなかった単語を待ち行列に積む（何度も要求された単語ほど優先してバックフィルされる） */
export async function enqueueWord(db: Firestore, key: string, word: string): Promise<void> {
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.collection(QUEUE).doc(key).set(
    { word, requests: FieldValue.increment(1), lastRequestedAt: Date.now() },
    { merge: true },
  );
}

/**
 * 近い単語のキャッシュ済みキーを探す。
 * 入力に含まれるキャッシュ語（例: 「黒猫」→「猫」）を最優先し、長い一致ほど近いとみなす。
 * 次に、入力を含むキャッシュ語（例: 「猫」→「招き猫」）のうち短いものを選ぶ。
 */
export function pickSimilarKey(key: string, cachedKeys: string[]): string | null {
  let best: string | null = null;
  for (const k of cachedKeys) {
    if (k && k !== key && key.includes(k) && (!best || k.length > best.length)) best = k;
  }
  if (best) return best;
  for (const k of cachedKeys) {
    if (k && k !== key && key.length >= 2 && k.includes(key) && (!best || k.length < best.length)) best = k;
  }
  return best;
}

/** 近い単語のAI駒を、入力された単語用に作り替えて返す */
export async function findSimilarPiece(db: Firestore, key: string, word: string): Promise<Json | null> {
  const index = await db.collection(INDEX_REF[0]).doc(INDEX_REF[1]).get();
  const keys = (index.get('keys') as string[] | undefined) ?? [];
  const similarKey = pickSimilarKey(key, keys);
  if (!similarKey) return null;
  const base = await getCachedPiece(db, similarKey);
  if (!base) return null;
  const baseWord = typeof base.word === 'string' ? base.word : similarKey;
  const replaceWord = (v: unknown) => (typeof v === 'string' ? v.split(baseWord).join(word) : v);
  return {
    ...base,
    word,
    description: replaceWord(base.description),
    deep_search_analysis: `「${word}」に近い「${baseWord}」のAI駒をもとにしています（AI生成の順番待ち中）。`,
    similarTo: baseWord,
  };
}
