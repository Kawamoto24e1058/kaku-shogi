// サーバー専用の Firestore 接続（Firebase Admin SDK）
// FIREBASE_SERVICE_ACCOUNT にサービスアカウントJSONを1行の文字列で設定する。
// 未設定の場合は null を返し、呼び出し側はキャッシュ無し・メモリ内レート制限で動作する。
// firebase-admin は読み込みが重いので、コールドスタート短縮のため初回利用時に動的 import する。
import type { Firestore } from 'firebase-admin/firestore';

let cached: Promise<Firestore | null> | undefined;

async function init(): Promise<Firestore | null> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const credentials = JSON.parse(raw);
    const [{ cert, getApps, initializeApp }, { getFirestore }] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore'),
    ]);
    const app = getApps()[0] ?? initializeApp({ credential: cert(credentials) });
    return getFirestore(app);
  } catch (err) {
    console.error('[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT is invalid:', (err as Error).message);
    return null;
  }
}

export function getAdminDb(): Promise<Firestore | null> {
  cached ??= init();
  return cached;
}
