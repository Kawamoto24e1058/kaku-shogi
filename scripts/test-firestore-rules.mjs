// firestore.rules のテスト（Firestore エミュレータ上で実行）
// 実行: npx firebase-tools emulators:exec --only firestore --project demo-kaku "node scripts/test-firestore-rules.mjs"
// エミュレータが FIRESTORE_EMULATOR_HOST を設定するので、接続先の指定は不要。
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-kaku',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});
const alice = env.authenticatedContext('alice').firestore();
const bob = env.authenticatedContext('bob').firestore();
const carol = env.authenticatedContext('carol').firestore();
const anon = env.unauthenticatedContext().firestore();

let failed = 0;
const check = async (name, promise) => {
  try {
    await promise;
    console.log(`OK   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}: ${String(err.message).split('\n')[0]}`);
  }
};

// 共有キャッシュ・サーバー専用データ
await check('誰でも生成済みの駒を読める', assertSucceeds(getDoc(doc(anon, 'custom_pieces/猫'))));
await check('ブラウザから駒データを書き換えられない', assertFails(setDoc(doc(alice, 'custom_pieces/猫'), { x: 1 })));
await check('回数制限の記録は見えない', assertFails(getDoc(doc(alice, 'rate_limits/x'))));
await check('生成待ちの単語は見えない', assertFails(getDoc(doc(alice, 'generation_queue/x'))));
await check('キャッシュ索引は見えない', assertFails(getDoc(doc(alice, 'meta/word_index'))));
await check('想定外のコレクションは使えない', assertFails(setDoc(doc(alice, 'other/x'), { x: 1 })));

// 対局データ
await check('未ログインでは対局を読めない', assertFails(getDoc(doc(anon, 'matches/123456'))));
await check('自分を先手として部屋を作れる', assertSucceeds(setDoc(doc(alice, 'matches/123456'), { senteUid: 'alice', goteUid: null, status: 'waiting' })));
await check('他人になりすまして部屋を作れない', assertFails(setDoc(doc(alice, 'matches/223456'), { senteUid: 'bob', goteUid: null })));
await check('6桁以外の部屋コードは作れない', assertFails(setDoc(doc(alice, 'matches/abc'), { senteUid: 'alice', goteUid: null })));
await check('空席に後手として入室できる', assertSucceeds(updateDoc(doc(bob, 'matches/123456'), { goteUid: 'bob', status: 'setup' })));
await check('第三者は席を奪えない', assertFails(updateDoc(doc(carol, 'matches/123456'), { goteUid: 'carol' })));
await check('第三者は盤面を書き換えられない', assertFails(updateDoc(doc(carol, 'matches/123456'), { turn: 'gote' })));
await check('後手は盤面を更新できる', assertSucceeds(updateDoc(doc(bob, 'matches/123456'), { turn: 'sente' })));
await check('先手は盤面を更新できる', assertSucceeds(updateDoc(doc(alice, 'matches/123456'), { turn: 'gote' })));
await check('後手は部屋を削除できない', assertFails(deleteDoc(doc(bob, 'matches/123456'))));

// ランダムマッチ待機列
await check('自分の待機エントリを作れる', assertSucceeds(setDoc(doc(alice, 'matchmaking_queue/dev1'), { uid: 'alice', status: 'waiting' })));
await check('他人の待機エントリは作れない', assertFails(setDoc(doc(carol, 'matchmaking_queue/dev2'), { uid: 'alice' })));
await check('マッチした相手の待機エントリを削除できる', assertSucceeds(deleteDoc(doc(bob, 'matchmaking_queue/dev1'))));

await env.cleanup();
if (failed > 0) {
  console.error(`${failed} rule check(s) failed`);
  process.exit(1);
}
