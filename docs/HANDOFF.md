# 公開準備の引き継ぎ（現在の状態と残りの手順）

作業ブランチは `claude/tender-brahmagupta-m6gutz`。背景と設計は `README.md` を参照。

## 守ること
- **秘密の値（APIトークンなど）をチャットに表示しない・貼らせない**。ダッシュボードの入力欄か、ファイル（`.env.local`）で受け渡す。
- 課金を有効にしない（Supabase は Free、Vercel は Hobby、Cloudflare は Workers Free のまま）。

## 済んでいること（2026-10-22 時点）
- Supabase プロジェクト `ahwfldxicjvrosgvryxn`（東京、Free）を作成。テーブル・RLS・対戦用 RPC を適用し、
  anon ロールで権限を確認済み（部屋を作った人と最初の入室者だけが書き換えられる。他人の書き換え・直接書き込み・秘密の読み取りは拒否）。
- サーバー用トークンを発行し、そのハッシュを `private.config` に登録済み。
- Vercel プロジェクト `kaku-shogi` に `VITE_SUPABASE_URL`・`VITE_SUPABASE_PUBLISHABLE_KEY`・
  `SUPABASE_SERVER_TOKEN`（Sensitive）・`CRON_SECRET`（Sensitive）を登録済み。
- Cloudflare Workers AI での生成を確認済み（10語すべて「エンジンで実行可能・盤面で効果あり」）。

## 残りの手順
1. **Supabase の SQL Editor で `supabase/schema.sql` を実行する（利用者）**
   削除処理を含む関数・自動掃除・権限の絞り込みが未適用。コネクタからの適用は確認待ちで止まるため、ダッシュボードで実行する。
   何度実行しても同じ状態になる。実行後、Advisors → Security に警告が出ていないか確認する。
2. **Vercel に `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` を登録する（利用者）**
   Settings → Environment Variables。トークンは Sensitive にする。未登録だと駒は簡易生成になる。
3. **問い合わせ先と運営者名を決めて `VITE_CONTACT_URL` / `VITE_OPERATOR_NAME` を登録する（利用者）**
4. 作業ブランチから main へのプルリクエストを作り、Preview デプロイで確認 → 利用者の承認を得てマージ。
5. 本番で確認: 駒生成（AI）・CPU対戦・2つのブラウザでオンライン対戦（部屋コード／ランダム）・
   `/terms.html`・`/privacy.html`・Xに投稿したときのカード表示。
   Vercel → Cron Jobs から `/api/backfill` を手動実行し、駒が `public.pieces` に増えることを確認。

## 利用者に依頼すること（自動化できない）
- 古い Gemini APIキーの無効化（Google AI Studio。旧コードの git 履歴に残っているため）
- 利用規約・プライバシーポリシーの文面確認
- 使用量の確認先: Supabase → Usage、Cloudflare → Workers AI、Vercel → Usage
