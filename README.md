# 架空将棋

好きな単語を入力すると、生成AIがその言葉の性質を持つ「能力駒」を生成し、CPU・友達・ランダムな相手と対局できる Web 将棋ゲームです。

## 構成（すべて無料枠で運用・非商用）

```
ブラウザ (React + Vite, 静的配信 / Vercel)
  ├─ GET  /api/generate-piece?k=… ─► CDN キャッシュ（生成済みの駒。関数も DB も使わない）
  ├─ POST /api/generate-piece ─────► Vercel Function ─► Cloudflare Workers AI（Gemma 4）
  │                                         └─► Supabase（共有キャッシュ。サーバー用トークン付き RPC）
  ├─ GET  /api/status ─────────────► 緊急スイッチ（AI生成・オンライン対戦の停止、お知らせ）
  └─ Supabase（オンライン対戦。読み取り＋RPC のみ、Realtime で同期）
Vercel Cron（毎日）── GET /api/backfill ─► 待ち行列・事前生成単語を AI 生成して共有キャッシュへ
```

| 役割 | サービス | 無料枠を超えたとき |
| --- | --- | --- |
| ホスティング・API | Vercel Hobby（**非商用のみ**。広告・寄付・決済を入れる場合は Pro か Cloudflare へ） | 課金されず、上限到達で一時停止 |
| 駒生成 AI | Cloudflare Workers AI（無料で1日1万neuron＝約190駒） | 課金されずエラー → 近い単語の流用・簡易生成に切り替わる |
| DB・リアルタイム同期 | Supabase Free（500MB、転送 5GB/月、Realtime 同時接続 200） | 課金されず制限される → オンライン対戦に案内を表示。Realtime の上限時はポーリングに切り替え |

> **Gemini API を既定で使わない理由**：Gemini API の利用規約（2026年3月23日発効版）には
> 「18歳未満が利用する可能性が高いウェブサイトやアプリでの利用禁止」の条項があり、誰でも遊べる公開ゲームでは抵触するおそれがあるため。
> コードは残してあり、`ENABLE_GEMINI=true` で有効になる（自分だけで試す開発用）。

### バズったときの安全装置
- **生成済みの駒は CDN から返す**：同じ単語への2回目以降は Vercel の CDN が応答し、関数も DB も使わない
- **回数制限はメモリで数える**：DB を消費しない（インスタンスごとの目安。AI はすべて無料枠で、超えても課金されない）
- **対戦データを小さくする**：盤面・駒データは gzip して保存（約 1/4〜1/5）、ログは直近 150 件まで、2 日で自動削除（pg_cron）
- **緊急スイッチ**：Vercel の環境変数を変えて再デプロイすると反映
  - `FEATURE_AI_GENERATION=off` … AI生成を止める（キャッシュ・近い単語・簡易生成で動き続ける）
  - `FEATURE_ONLINE_MATCH=off` … オンライン対戦の新規開始を止め、トップに案内を出す
  - `SITE_NOTICE=…` … トップ画面にお知らせを出す
- **上限到達時の案内**：DB の無料枠超過などは、エラーではなく「混雑しています」と表示
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

AI で生成できなかった単語は `generation_queue` に積まれ、Vercel Cron（`vercel.json`、毎日 日本時間 8:30 頃に `/api/backfill`）が
その日に余った無料枠で AI 生成して共有キャッシュに登録します。次にその単語を入れた人からは AI 版になります。
初回デプロイ後は `shared/seedWords.ts` の単語も少しずつ事前生成されます。
`/api/backfill` は Vercel が付ける `CRON_SECRET` で保護されています。手元からは `npm run backfill` で実行できます。

## セットアップ

### 1. Supabase（DB とリアルタイム同期）

1. [Supabase](https://supabase.com/) で無料プロジェクトを作成（リージョンは Tokyo）。
2. SQL Editor に `supabase/schema.sql` の中身を貼り付けて Run（何度実行しても同じ状態になる）。
3. サーバー用トークンを作る: `openssl rand -hex 32` で作った値を `SUPABASE_SERVER_TOKEN` に設定し、
   その SHA-256 を `private.config` に登録（`schema.sql` 末尾のコメント参照）。トークン本体は DB に保存しない。
4. Project Settings → API の URL と Publishable key を `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` に設定（公開前提の値）。

セキュリティの考え方:
- ブラウザはテーブルを読むことしかできず、書き込みはすべて RPC（`create_match` など）経由。
- 匿名ログインは使わず、タブごとにランダムな秘密の文字列を作り、DB にはハッシュだけを保存する。
  部屋を作った人と最初に入室した人だけが、その対戦を書き換えられる。
- 駒キャッシュ・待ち行列への書き込みは `SUPABASE_SERVER_TOKEN` を持つサーバーだけ。
- 対戦データは部屋コードを知っていれば読める（観戦と同じ扱い）ので、個人情報は入れない。

### 2. Cloudflare Workers AI（駒生成 AI）

1. [Cloudflare](https://dash.cloudflare.com/) に無料登録（Workers Free プランのまま）。
2. ダッシュボード → AI → Workers AI →「REST API を使用」から **Account ID** を確認し、**Workers AI 権限の API トークン**を作成。
3. `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` に設定（`VITE_` を付けない＝ブラウザに配信されない）。
4. 公開前に 10〜20 語ほど生成して、駒の品質を確認する。

### 3. Vercel

1. このリポジトリを Vercel にインポート（Framework: Vite。`vercel.json` で設定済み）。
2. Settings → Environment Variables に `.env.example` の値を登録（`SUPABASE_SERVER_TOKEN` と `CRON_SECRET` は Sensitive にする）。
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
| `api/backfill.ts`, `api/_lib/backfill.ts` | 待ち行列・事前生成単語の AI 生成（Vercel Cron。手元では `scripts/backfill.ts`） |
| `api/_lib/pieceCache.ts` | 共有キャッシュ・待ち行列（Supabase の RPC を fetch で呼ぶ） |
| `src/onlineStore.ts` | オンライン対戦の保存・同期（圧縮、Realtime、ポーリング切り替え） |
| `src/cpuAi.ts` | CPU 対戦相手の指し手選択 |
| `src/gameLogic.ts` | 盤面・移動・能力の実行エンジン |
| `supabase/schema.sql` | DB のテーブル・権限・RPC・自動掃除 |
