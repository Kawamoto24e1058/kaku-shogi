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

const firebaseConfig = {
  apiKey:            env.VITE_FIREBASE_API_KEY            || "AIzaSyDpxTkNODuBshHk6ltZwjuMwKhQ49r6J6U",
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN        || "bushitu-nyushitu.firebaseapp.com",
  projectId:         env.VITE_FIREBASE_PROJECT_ID         || "bushitu-nyushitu",
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET     || "bushitu-nyushitu.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "675447397511",
  appId:             env.VITE_FIREBASE_APP_ID             || "1:675447397511:web:3e59d24ff5c1ee69ac2c22",
};

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
