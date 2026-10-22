# 公開準備の引き継ぎ（現在の状態と残りの手順）

作業ブランチは `claude/tender-brahmagupta-m6gutz`。背景と設計は `README.md` を参照。

## 守ること
- **秘密の値（APIトークンなど）をチャットに表示しない・貼らせない**。ダッシュボードの入力欄か、ファイル（`.env.local`）で受け渡す。
- 課金を有効にしない（Supabase は Free、Vercel は Hobby、Cloudflare は Workers Free のまま）。

## 済んでいること（2026-10-22 時点）
- Supabase プロジェクト `ahwfldxicjvrosgvryxn`（東京、Free）に `supabase/schema.sql` を適用済み（自動掃除の pg_cron も登録済み）。
  anon ロールで権限を確認済み: 部屋を作った人と最初の入室者だけが書き換えられ、部屋の削除は作った人だけ。
  ランダムマッチの待ち行列は自分自身を取らず、1人は1回しか取り出されない。
  他人の書き換え・テーブルへの直接書き込み・待ち行列や秘密の読み取り・誤ったトークンでの駒保存は拒否。
- Security Advisor の警告「anon が SECURITY DEFINER 関数を実行できる」（12件）は設計どおり
  （書き込みはすべてこの RPC 経由で、各関数が秘密のハッシュかサーバー用トークンを照合する）。
  「RLS 有効・ポリシーなし」（待ち行列2表）も設計どおり（ブラウザからは読めない）。
- サーバー用トークンを発行し、そのハッシュを `private.config` に登録済み。
- Vercel プロジェクト `kaku-shogi` に `VITE_SUPABASE_URL`・`VITE_SUPABASE_PUBLISHABLE_KEY`・
  `SUPABASE_SERVER_TOKEN`（Sensitive）・`CRON_SECRET`（Sensitive）・
  `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`（Sensitive。Production と Preview）を登録済み。
- Cloudflare Workers AI での生成を確認済み（10語すべて「エンジンで実行可能・盤面で効果あり」）。

## 残りの手順
1. **問い合わせ先と運営者名を決めて `VITE_CONTACT_URL` / `VITE_OPERATOR_NAME` を登録する（利用者）**
2. 作業ブランチから main へのプルリクエストを作り、Preview デプロイで確認 → 利用者の承認を得てマージ。
3. 本番で確認: 駒生成（AI）・CPU対戦・2つのブラウザでオンライン対戦（部屋コード／ランダム）・
   `/terms.html`・`/privacy.html`・Xに投稿したときのカード表示。
   Vercel → Cron Jobs から `/api/backfill` を手動実行し、駒が `public.pieces` に増えることを確認。

## 利用者に依頼すること（自動化できない）
- 古い Gemini APIキーの無効化（Google AI Studio。旧コードの git 履歴に残っているため）
- 利用規約・プライバシーポリシーの文面確認
- 使用量の確認先: Supabase → Usage、Cloudflare → Workers AI、Vercel → Usage
