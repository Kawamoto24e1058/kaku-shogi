// Firebase 設定
// .env ファイルに以下の変数を設定してください:
//   VITE_FIREBASE_API_KEY=...
//   VITE_FIREBASE_AUTH_DOMAIN=...
//   VITE_FIREBASE_PROJECT_ID=...
//   VITE_FIREBASE_STORAGE_BUCKET=...
//   VITE_FIREBASE_MESSAGING_SENDER_ID=...
//   VITE_FIREBASE_APP_ID=...

import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || "AIzaSyDpxTkNODuBshHk6ltZwjuMwKhQ49r6J6U",
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || "bushitu-nyushitu.firebaseapp.com",
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || "bushitu-nyushitu",
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || "bushitu-nyushitu.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "675447397511",
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || "1:675447397511:web:3e59d24ff5c1ee69ac2c22",
};

// 重複初期化を防ぐ
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getFirestore(app);
