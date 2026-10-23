-- 公開前の安全対策（何度実行しても同じ状態になる）。supabase/schema.sql の適用後に、SQL Editor で実行する。
-- 1. 対戦データの大きさ・同時に存在できる対局数に上限を付け、無料枠（500MB）を荒らしで埋められないようにする
-- 2. 放置された対局を早めに消す
-- 3. 不適切な駒の報告。別々の3人から報告された駒は共有キャッシュから消える（次に誰かが入力するとAIが作り直す）
-- 4. AI生成の回数制限を全サーバー共通で数える（IP・端末ID・サイト全体の1日の上限）

-- 上限値（変えたいときはこの表の値を書き換える）
insert into private.config (name, value) values
  ('max_active_matches', '3000'),
  ('report_threshold', '3'),
  ('reports_per_day', '20')
on conflict (name) do nothing;

create or replace function private.config_int(p_name text, p_default integer)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select value::integer from private.config where name = p_name), p_default)
$$;

-- ===== 対戦データの上限 =====
-- 作成時のデータは盤面と名前程度（実測で数KB）なので 64KB、対局中は駒データ・ログ込みで 256KB まで
create or replace function public.create_match(p_code text, p_secret text, p_data jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_code !~ '^[0-9]{6}$' or char_length(coalesce(p_secret, '')) < 16 then raise exception 'invalid request'; end if;
  if pg_column_size(p_data) > 65536 then raise exception 'match data too large'; end if;
  if (select count(*) from public.matches) >= private.config_int('max_active_matches', 3000) then
    raise exception 'server busy: too many active matches';
  end if;
  insert into public.matches (code, data) values (p_code, p_data) on conflict (code) do nothing;
  if not found then return false; end if;
  insert into private.match_secrets (code, sente_hash) values (p_code, private.sha256_hex(p_secret));
  return true;
end $$;

create or replace function private.apply_match_patch(p_code text, p_patch jsonb, p_logs jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  merged jsonb;
begin
  select m.data || coalesce(p_patch, '{}'::jsonb) into merged from public.matches m where m.code = p_code for update;
  if p_logs is not null and jsonb_typeof(p_logs) = 'array' then
    merged := jsonb_set(merged, '{logs}',
      case when jsonb_typeof(merged -> 'logs') = 'array' then (merged -> 'logs') || p_logs else p_logs end);
  end if;
  if pg_column_size(merged) > 262144 then raise exception 'match data too large'; end if;
  update public.matches set data = merged, updated_at = now() where code = p_code;
end $$;

-- ===== 不適切な駒の報告 =====
create table if not exists public.piece_reports (
  key text not null,
  reporter_hash text not null,
  created_at timestamptz not null default now(),
  primary key (key, reporter_hash)
);
alter table public.piece_reports enable row level security;
revoke all on public.piece_reports from anon, authenticated;

-- 報告の件数を返す。別々の人からの報告が上限に達したら、その駒を共有キャッシュから消す
create or replace function public.report_piece(p_key text, p_secret text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  h text := private.sha256_hex(coalesce(p_secret, ''));
  total integer;
begin
  if char_length(coalesce(p_secret, '')) < 16 or char_length(coalesce(p_key, '')) not between 1 and 64 then
    raise exception 'invalid request';
  end if;
  -- 1人が大量に報告して他の人の駒を消せないように、1日の報告数を絞る
  if (select count(*) from public.piece_reports where reporter_hash = h and created_at > now() - interval '1 day')
     >= private.config_int('reports_per_day', 20) then
    raise exception 'too many reports';
  end if;
  insert into public.piece_reports (key, reporter_hash) values (p_key, h) on conflict do nothing;
  select count(*) into total from public.piece_reports where key = p_key;
  if total >= private.config_int('report_threshold', 3) then
    delete from public.pieces where key = p_key;
  end if;
  return total;
end $$;

revoke execute on function private.config_int(text, integer) from public, anon, authenticated;
revoke execute on function public.report_piece(text, text) from public;
grant execute on function public.report_piece(text, text) to anon, authenticated;

-- ===== AI生成の回数制限（全サーバー共通で1日の回数を数える） =====
-- バケツ名の例: ip:<IPのハッシュ>:2026-10-22 / dev:<端末IDのハッシュ>:2026-10-22 / global:2026-10-22
create table if not exists private.rate_limits (
  bucket text primary key,
  count integer not null default 0,
  expires_at timestamptz not null
);

-- すべてのバケツが上限未満なら全部に1足して 0 を返す。上限に達したバケツがあれば、その番号（1始まり）を返して何も足さない
create or replace function public.server_consume_quota(p_token text, p_buckets text[], p_limits integer[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  i integer;
  current_count integer;
begin
  if not private.is_server(p_token) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(array_length(p_buckets, 1), 0) = 0 or array_length(p_buckets, 1) <> array_length(p_limits, 1) or array_length(p_buckets, 1) > 5 then
    raise exception 'invalid request';
  end if;
  -- 同じバケツへの同時アクセスで数え漏れが出ないよう、行を作ってからロックして数える
  for i in 1 .. array_length(p_buckets, 1) loop
    insert into private.rate_limits (bucket, count, expires_at) values (p_buckets[i], 0, now() + interval '2 days')
    on conflict (bucket) do nothing;
  end loop;
  for i in 1 .. array_length(p_buckets, 1) loop
    select count into current_count from private.rate_limits where bucket = p_buckets[i] for update;
    if current_count >= p_limits[i] then return i; end if;
  end loop;
  update private.rate_limits set count = count + 1 where bucket = any (p_buckets);
  return 0;
end $$;

revoke execute on function public.server_consume_quota(text, text[], integer[]) from public;
grant execute on function public.server_consume_quota(text, text[], integer[]) to anon, authenticated;

-- ===== 古いデータの掃除（毎時17分） =====
-- 相手待ち・接続中・終わった対局は1時間、対局中でも1日動きがなければ消す。古い報告・回数記録も消す
select cron.schedule('kaku-shogi-cleanup', '17 * * * *', $c$
  delete from public.matches
  where updated_at < now() - interval '1 day'
     or (data->>'status' in ('waiting', 'connecting', 'finished') and updated_at < now() - interval '1 hour');
  delete from public.matchmaking_queue where created_at < now() - interval '15 minutes';
  delete from public.piece_reports where created_at < now() - interval '30 days';
  delete from private.rate_limits where expires_at < now();
$c$);
