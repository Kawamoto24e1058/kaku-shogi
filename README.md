# 架空将棋

好きな単語を入力すると、生成AIがその言葉の性質を持つ「能力駒」を生成し、CPU・友達・ランダムな相手と対局できる Web 将棋ゲームです。

## 構成（すべて無料枠で運用・非商用）

```
ブラウザ (React + Vite, 静的配信 / Vercel)
  ├─ GET  /api/generate-piece?k=… ─► CDN キャッシュ（生成済みの駒。関数も DB も使わない）
  ├─ POST /api/generate-piece ─────► Vercel Function ─► Cloudflare Workers AI（Gemma 4）
  │                                         └─► Firestore（共有キャッシュ, Admin SDK）
  ├─ GET  /api/status ─────────────► 緊急スイッチ（AI生成・オンライン対戦の停止、お知らせ）
  └─ Firestore（オンライン対戦, 匿名認証 + セキュリティルール）
```

| 役割 | サービス | 無料枠を超えたとき |
| --- | --- | --- |
| ホスティング・API | Vercel Hobby（**非商用のみ**。広告・寄付・決済を入れる場合は Pro か Cloudflare へ） | 課金されず、上限到達で一時停止 |
| 駒生成 AI | Cloudflare Workers AI（無料で1日1万neuron＝約190駒） | 課金されずエラー → 近い単語の流用・簡易生成に切り替わる |
| DB・認証 | Firebase Spark | 課金されず、当日分がエラー → オンライン対戦に案内を表示 |

> **Gemini API を既定で使わない理由**：Gemini API の利用規約（2026年3月23日発効版）には
> 「18歳未満が利用する可能性が高いウェブサイトやアプリでの利用禁止」の条項があり、誰でも遊べる公開ゲームでは抵触するおそれがあるため。
> コードは残してあり、`ENABLE_GEMINI=true` で有効になる（自分だけで試す開発用）。

### バズったときの安全装置
- **生成済みの駒は CDN から返す**：同じ単語への2回目以降は Vercel の CDN が応答し、関数も Firestore も使わない
- **回数制限はメモリで数える**（既定）：Firestore の読み書きを消費しない（`RATE_LIMIT_STORE=firestore` で厳密化も可）
- **緊急スイッチ**：Vercel の環境変数を変えて再デプロイすると反映
  - `FEATURE_AI_GENERATION=off` … AI生成を止める（キャッシュ・近い単語・簡易生成で動き続ける）
  - `FEATURE_ONLINE_MATCH=off` … オンライン対戦の新規開始を止め、トップに案内を出す
  - `SITE_NOTICE=…` … トップ画面にお知らせを出す
- **上限到達時の案内**：Firestore の無料枠切れなどは、エラーではなく「本日の利用枠に達しました」と表示
- **NGワードフィルター**（`shared/moderation.ts`）：入力した単語と生成結果の両方を検査し、差別・性的・暴力的な語を含むものは駒にしない／キャッシュしない。追加は `NG_WORDS`
- **利用規約・プライバシーポリシー**（`terms.html` / `privacy.html`）：問い合わせ先は `VITE_CONTACT_URL`、運営者名は `VITE_OPERATOR_NAME` で設定。**公開前に内容を確認すること**

### 不特定多数が遊んでも止まらないための多段構成

駒の生成は上から順に試し、どこかで失敗しても次に進むので、ゲーム自体は止まりません。

1. **共有キャッシュ**（誰かが一度生成した単語・事前生成した単語）… 即時・高品質。
   「ネコ/ねこ」「ＡＩ/ai」や空白・記号の違いは同じ単語として扱う（`shared/wordKey.ts`）
2. **Workers AI**（`WORKERS_AI_MODEL`、既定 Gemma 4 26B）
3. **Workers AI の予備モデル**（任意。`WORKERS_AI_FALLBACK_MODEL`）
4. **予備の LLM**（任意。OpenAI 互換 API。`FALLBACK_LLM_*`）
5. **近い単語の AI 駒を流用**（例:「黒猫」→「猫」の AI 駒）。単語は待ち行列に入り、後で AI 版が登録される
6. **簡易生成**（`src/offlineGenerator.ts`）… ブラウザ内で必ず動く。17 種の能力型から単語に合うものを選ぶ。
   全能力型がエンジン上で実際に効果を発揮することを `npm run verify:abilities` で確認できる。

AI 呼び出しを節約する工夫:
- プロンプトはエンジンが解釈する項目だけに絞って約 2,200 トークン
- 同じ単語への同時リクエストは 1 回の生成を共有する
- バックフィルは 1 回の呼び出しで 5 語をまとめて生成する

AI で生成できなかった単語は `generation_queue` に積まれ、GitHub Actions（`.github/workflows/backfill.yml`, 毎日 日本時間 8:30）が
その日に余った無料枠で AI 生成して共有キャッシュに登録します。次にその単語を入れた人からは AI 版になります。
初回デプロイ後は `shared/seedWords.ts` の単語も少しずつ事前生成されます。

GitHub Actions を使うには、リポジトリの Settings → Secrets and variables → Actions に
`CLOUDFLARE_ACCOUNT_ID`・`CLOUDFLARE_API_TOKEN`・`FIREBASE_SERVICE_ACCOUNT` を登録してください。
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

### 2. Cloudflare Workers AI（駒生成 AI）

1. [Cloudflare](https://dash.cloudflare.com/) に無料登録（Workers Free プランのまま）。
2. ダッシュボード → AI → Workers AI →「REST API を使用」から **Account ID** を確認し、**Workers AI 権限の API トークン**を作成。
3. `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` に設定（`VITE_` を付けない＝ブラウザに配信されない）。
4. 公開前に 10〜20 語ほど生成して、駒の品質を確認する。

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

AI のキー（`CLOUDFLARE_*`）が未設定でも、駒は簡易生成で作られるので一通り遊べます。

## X（旧 Twitter）共有

- 駒カード・対局結果・部屋待機画面に「𝕏 シェア」ボタンがあります（Web Intent のため X API は不要）。
- 部屋の招待リンクは `https://<ドメイン>/?room=123456` 形式で、開くと入室画面にコードが入った状態で始まります。
- `public/og.png` が X のカード画像として表示されます。

## 主要ファイル

| パス | 内容 |
| --- | --- |
| `api/generate-piece.ts` | 駒生成 API（CDN キャッシュ参照・レート制限・AI 呼び出し・NG チェック） |
| `api/_lib/prompt.ts`, `api/_lib/pieceSchema.ts` | 生成プロンプトと構造化出力スキーマ |
| `shared/abilityCatalog.ts` | エンジンが実行できる能力アクションの一覧（クライアント・サーバー共通） |
| `src/aiGenerator.ts` | 生成結果の補正（サニタイズ）・キャッシュ・オフライン生成 |
| `api/_lib/generator.ts` | LLM プロバイダの切り替え（Workers AI → 予備 → Gemini は任意） |
| `api/_lib/flags.ts`, `api/status.ts` | 緊急スイッチ |
| `shared/moderation.ts` | NG ワードフィルター |
| `terms.html`, `privacy.html` | 利用規約・プライバシーポリシー |
| `src/offlineGenerator.ts` | AI が使えないときの簡易生成（能力型ライブラリ） |
| `scripts/backfill.ts` | 待ち行列・事前生成単語の AI 生成（GitHub Actions から実行） |
| `src/cpuAi.ts` | CPU 対戦相手の指し手選択 |
| `src/gameLogic.ts` | 盤面・移動・能力の実行エンジン |
| `firestore.rules` | Firestore セキュリティルール |
