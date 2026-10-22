// Firebase 設定
// .env ファイルに以下の変数を設定してください（.env.example 参照）:
//   VITE_FIREBASE_API_KEY=...
//   VITE_FIREBASE_AUTH_DOMAIN=...
//   VITE_FIREBASE_PROJECT_ID=...
//   VITE_FIREBASE_STORAGE_BUCKET=...
//   VITE_FIREBASE_MESSAGING_SENDER_ID=...
//   VITE_FIREBASE_APP_ID=...
// ※ Firebase の Web 設定値は公開前提の識別子で秘密情報ではない。
//    データの保護は firestore.rules（セキュリティルール）で行う。

import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Vite 以外（テストやスクリプト）から読み込まれても落ちないようにする
const env: Partial<ImportMetaEnv> = import.meta.env ?? {};

// 以前は未設定時に別アプリのプロジェクトへ接続していたため、その予備値は削除した。
// 未設定の間はオンライン対戦を「準備中」として無効化する（App.tsx の firebaseConfigured 参照）。
export const firebaseConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID);

const firebaseConfig = firebaseConfigured
  ? {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    }
  // 未設定時は通信しないダミー（オンライン機能は無効化されるので実際には使われない）
  : { apiKey: 'unconfigured', projectId: 'demo-unconfigured', appId: 'unconfigured' };

// 重複初期化を防ぐ
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getFirestore(app);
export const auth = getAuth(app);

let signInPromise: Promise<string | null> | null = null;

/**
 * 匿名ログインして uid を返す（1回だけ実行）。
 * セキュリティルールで「対局の参加者だけが盤面を書き換えられる」ようにするために使う。
 * Firebase コンソールで匿名認証が無効な場合は null を返し、従来どおり動作を続ける。
 */
export function ensureSignedIn(): Promise<string | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser.uid);
  if (!signInPromise) {
    signInPromise = signInAnonymously(auth)
      .then(cred => cred.user.uid)
      .catch(err => {
        console.warn('[auth] Anonymous sign-in failed. Enable it in Firebase Console > Authentication.', err);
        signInPromise = null;
        return null;
      });
  }
  return signInPromise;
}
