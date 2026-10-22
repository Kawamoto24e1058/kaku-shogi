// サーバー専用の Firestore 接続（Firebase Admin SDK）
// FIREBASE_SERVICE_ACCOUNT にサービスアカウントJSONを1行の文字列で設定する。
// 未設定の場合は null を返し、呼び出し側はキャッシュ無し・メモリ内レート制限で動作する。
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let cached: Firestore | null | undefined;

export function getAdminDb(): Firestore | null {
  if (cached !== undefined) return cached;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    cached = null;
    return cached;
  }
  try {
    const credentials = JSON.parse(raw);
    const app = getApps()[0] ?? initializeApp({ credential: cert(credentials) });
    cached = getFirestore(app);
  } catch (err) {
    console.error('[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT is invalid:', (err as Error).message);
    cached = null;
  }
  return cached;
}
