# 公開準備の引き継ぎ手順（PC上の Claude Code 向け）

このファイルは、利用者のPC上で動く Claude Code セッションが上から順に実行するための手順書です。
作業ブランチは `claude/tender-brahmagupta-m6gutz`。背景と設計は `README.md` を参照。

## 守ること
- **秘密の値（APIトークン・サービスアカウントJSON）をチャットに表示しない・貼らせない**。
  ファイル（`.env.local`, 一時ファイル）か、CLI の対話入力で受け渡す。一時ファイルは使い終わったら削除する。
- ログイン（`firebase login` / `gcloud auth login` / `vercel login` / `gh auth login`）はブラウザが開くので、利用者に承認してもらう。
- 課金を有効にしない（Firebase は Spark プランのまま、Google Cloud に請求先アカウントをリンクしない）。
- うまくいかない手順は無理に回避せず、コンソールでの操作を利用者に案内する。

## 0. 準備
```bash
git fetch origin claude/tender-brahmagupta-m6gutz && git checkout claude/tender-brahmagupta-m6gutz
npm ci
# 必要なCLI: firebase-tools（npx で可）, gcloud, gh, vercel（npx で可）
```

## 1. Firebase（このアプリ専用プロジェクト）
```bash
npx firebase-tools login
PROJECT_ID=kaku-shogi-$(date +%y%m%d)   # 既に使われていたら別名にする
npx firebase-tools projects:create "$PROJECT_ID" --display-name "架空将棋"
npx firebase-tools firestore:databases:create "(default)" --location asia-northeast1 --project "$PROJECT_ID"
npx firebase-tools apps:create web kaku-shogi --project "$PROJECT_ID"
npx firebase-tools apps:sdkconfig web --project "$PROJECT_ID"   # → VITE_FIREBASE_* の値（公開前提の識別子）
```

### 匿名ログインの有効化
```bash
gcloud auth login
curl -sS -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "X-Goog-User-Project: $PROJECT_ID" -H "Content-Type: application/json" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT_ID/config?updateMask=signIn.anonymous.enabled" \
  -d '{"signIn":{"anonymous":{"enabled":true}}}'
```
失敗した場合（Authentication が未初期化など）は、Firebase コンソール → Authentication →「始める」→ ログイン方法 →「匿名」を有効化してもらう。

### サービスアカウント（サーバー・GitHub Actions 用）
```bash
SA=$(gcloud iam service-accounts list --project "$PROJECT_ID" --filter="email~firebase-adminsdk" --format="value(email)")
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="roles/firebaserules.admin"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="roles/datastore.indexAdmin"
KEY_FILE=$(mktemp) && gcloud iam service-accounts keys create "$KEY_FILE" --iam-account "$SA"
# 1行のJSONにして使う: python3 -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1]))))" "$KEY_FILE"
```

## 2. Cloudflare Workers AI
- 2026-10-22 時点: クラウドセッションで、利用者のトークン（Workers AI 権限付き）による生成を確認済み。
  10語の生成で、全語が「エンジンで実行可能・盤面で効果あり」（1語あたり約4〜8秒、5語まとめて約20〜40秒）。
- 利用者のダッシュボード → My Profile → API Tokens で、トークンに **Account → Workers AI → Read** の権限があることを確認してもらう（無ければ追加）。
- Account ID はダッシュボードのアカウントホームに表示される。
- 確認: `.env.local` に `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` を書き、
  `npm run try:generate -- 猫 新幹線 ラーメン 忍者 月曜日` で生成と品質を確認する（キャッシュには保存されない）。
  「⚠ 未対応アクション」が多い・日本語が不自然などの問題があれば `api/_lib/prompt.ts` を調整する。

## 3. GitHub Secrets
```bash
gh secret set FIREBASE_SERVICE_ACCOUNT < <(python3 -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1]))))" "$KEY_FILE")
gh secret set CLOUDFLARE_ACCOUNT_ID    # 対話入力（利用者がターミナルに貼る）
gh secret set CLOUDFLARE_API_TOKEN     # 対話入力
```

## 4. Vercel（既存プロジェクト kaku-shogi）
```bash
npx vercel login && npx vercel link --project kaku-shogi
# 秘密の値（Production / Preview）
python3 -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1]))))" "$KEY_FILE" | npx vercel env add FIREBASE_SERVICE_ACCOUNT production
npx vercel env add CLOUDFLARE_ACCOUNT_ID production     # 対話入力
npx vercel env add CLOUDFLARE_API_TOKEN production      # 対話入力
# 公開値: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
#         VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID（手順1の sdkconfig）
#         VITE_CONTACT_URL（問い合わせ先。利用者に確認）, VITE_OPERATOR_NAME（運営者名。利用者に確認）
rm -f "$KEY_FILE"
```
Preview 環境にも同じ値が必要なら `preview` でも追加する。

## 5. ルールのデプロイ・公開
1. 作業ブランチから main へのプルリクエストを作成し、CI（Firestore rules のテスト）が通ることを確認
2. 利用者の承認を得てマージ → Vercel の本番デプロイと、GitHub Actions「Firestore rules」のデプロイ成功を確認
   （権限エラーなら手順1のロール付与を確認）
3. Actions「Backfill AI pieces」を手動実行して事前生成が動くことを確認
4. 本番で確認: 駒生成（AI）・CPU対戦・2台でオンライン対戦・`/terms.html`・`/privacy.html`・Xに投稿したときのカード表示

## 6. 利用者に依頼すること（自動化できない）
- 古い Gemini APIキーの無効化（Google AI Studio。旧コードの git 履歴に残っているため）
- 利用規約・プライバシーポリシーの文面確認
- 使用量アラートの設定（Firebase / Cloudflare）
