# 架空将棋

好きな単語を入力すると、AI (Google Gemini) がその言葉の性質を持つ「能力駒」を生成し、CPU・友達・ランダムな相手と対局できる Web 将棋ゲームです。

## 構成（すべて無料枠で運用）

```
ブラウザ (React + Vite, 静的配信)
  ├─ /api/generate-piece ──► Vercel Function ──► Gemini API（キーはサーバーの環境変数のみ）
  │                               └─► Firestore（共有キャッシュ・レート制限, Admin SDK）
  └─ Firestore（オンライン対局, 匿名認証 + セキュリティルール）
```

| 役割 | サービス | 無料枠を超えたとき |
| --- | --- | --- |
| ホスティング・API | Vercel Hobby | 課金されず、上限到達で一時停止 |
| DB・認証 | Firebase Spark | 課金されず、当日分のリクエストがエラーになる |
| AI 生成 | Gemini API 無料枠 | 課金されず 429。アプリは簡易生成に自動で切り替わる |

- PHP も自前サーバーも使わない構成なので、PHP 本体の脆弱性やサーバーの OS 管理は対象外です（依存パッケージの更新は引き続き必要）。
- 駒は単語ごとに Firestore にキャッシュされ、2 回目以降は誰が入力しても AI を呼びません（無料枠の節約）。
- `RATE_LIMIT_PER_HOUR`（IP ごと）と `GLOBAL_DAILY_LIMIT`（全体）で AI の呼び出し回数を制限します。

### 不特定多数が遊んでも止まらないための多段構成

駒の生成は上から順に試し、どこかで失敗しても次に進むので、ゲーム自体は止まりません。

1. **共有キャッシュ**（誰かが一度生成した単語・事前生成した単語）… 即時・高品質
2. **Gemini**（`GEMINI_MODEL`）
3. **Gemini 軽量モデル**（`GEMINI_FALLBACK_MODEL`）
4. **予備の LLM**（任意。Groq / OpenRouter / Cloudflare Workers AI など OpenAI 互換 API。`FALLBACK_LLM_*`）
5. **簡易生成**（`src/offlineGenerator.ts`）… ブラウザ内で必ず動く。17 種の能力型から単語に合うものを選ぶ。
   全能力型がエンジン上で実際に効果を発揮することを `npm run verify:offline` で確認できる。

AI で生成できなかった単語は `generation_queue` に積まれ、GitHub Actions（`.github/workflows/backfill.yml`, 1 日 1 回）が
その日に余った無料枠で AI 生成して共有キャッシュに登録します。次にその単語を入れた人からは AI 版になります。
初回デプロイ後は `shared/seedWords.ts` の単語も少しずつ事前生成されます。

GitHub Actions を使うには、リポジトリの Settings → Secrets and variables → Actions に
`GEMINI_API_KEY` と `FIREBASE_SERVICE_ACCOUNT`（任意で `FALLBACK_LLM_*`）を登録してください。
手動実行は Actions タブの「Backfill AI pieces」→「Run workflow」から行えます。

## セットアップ

### 1. Firebase（このアプリ専用のプロジェクトを推奨）

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成（Spark プランのまま）。
2. Firestore Database を作成。
3. Authentication → ログイン方法 →「匿名」を有効化。
4. ウェブアプリを追加し、表示された設定値を `VITE_FIREBASE_*` に設定。
5. プロジェクトの設定 → サービスアカウント →「新しい秘密鍵を生成」で JSON をダウンロードし、**1 行にして** `FIREBASE_SERVICE_ACCOUNT` に設定（このファイルは絶対にコミットしない）。
6. ルールとインデックスをデプロイ（**匿名認証を有効化した後に**行うこと）:
   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules,firestore:indexes --project <プロジェクトID>
   ```
7. （任意）Firestore → TTL ポリシーで `rate_limits` コレクションの `expiresAt` を指定すると、古いカウンタが自動削除されます。

### 2. Gemini API キー

1. [Google AI Studio](https://aistudio.google.com/apikey) でキーを発行。
2. **課金（請求先アカウント）を有効にしていない Google Cloud プロジェクト**のキーにすること。課金が有効だと無料枠を超えた分が請求されます。
3. `GEMINI_API_KEY` に設定（`VITE_` を付けない＝ブラウザに配信されない）。

> 無料枠では、入力内容が Google のサービス改善に利用される場合があります。アプリ内でも「個人情報を入力しないで」と表示しています。

### 3. Vercel

1. このリポジトリを Vercel にインポート（Framework: Vite。`vercel.json` で設定済み）。
2. Settings → Environment Variables に `.env.example` の値を登録。
3. デプロイ。OGP 画像の URL は本番ドメインが自動で使われます（独自ドメインの場合は `VITE_SITE_URL` を設定）。

## 開発

```bash
cp .env.example .env.local   # 値を入力
npm ci
npm run dev                  # /api/* も Vite 開発サーバー上で動く
npm run build                # 型チェック (app / api) + 本番ビルド
```

`GEMINI_API_KEY` が未設定でも、駒はオフラインの簡易生成で作られるので一通り遊べます。

## X（旧 Twitter）共有

- 駒カード・対局結果・部屋待機画面に「𝕏 シェア」ボタンがあります（Web Intent のため X API は不要）。
- 部屋の招待リンクは `https://<ドメイン>/?room=123456` 形式で、開くと入室画面にコードが入った状態で始まります。
- `public/og.png` が X のカード画像として表示されます。

## 主要ファイル

| パス | 内容 |
| --- | --- |
| `api/generate-piece.ts` | 駒生成 API（キャッシュ・レート制限・Gemini 呼び出し） |
| `api/_lib/prompt.ts`, `api/_lib/pieceSchema.ts` | 生成プロンプトと構造化出力スキーマ |
| `shared/abilityCatalog.ts` | エンジンが実行できる能力アクションの一覧（クライアント・サーバー共通） |
| `src/aiGenerator.ts` | 生成結果の補正（サニタイズ）・キャッシュ・オフライン生成 |
| `api/_lib/generator.ts` | LLM プロバイダの切り替え（Gemini → 軽量 → 予備） |
| `src/offlineGenerator.ts` | AI が使えないときの簡易生成（能力型ライブラリ） |
| `scripts/backfill.ts` | 待ち行列・事前生成単語の AI 生成（GitHub Actions から実行） |
| `src/cpuAi.ts` | CPU 対戦相手の指し手選択 |
| `src/gameLogic.ts` | 盤面・移動・能力の実行エンジン |
| `firestore.rules` | Firestore セキュリティルール |
