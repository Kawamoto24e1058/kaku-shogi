-- 架空将棋 の Supabase スキーマ（何度実行しても同じ状態になる）
-- 適用: Supabase ダッシュボード → SQL Editor にこのファイルの中身を貼り付けて Run。
--
-- 設計:
-- - ブラウザ（anon キー）はテーブルを「読む」ことしかできない。書き込みはすべて下の RPC 経由。
-- - 匿名ログインは使わず、プレイヤーは端末で作ったランダムな秘密の文字列（16文字以上）を持つ。
--   DB には SHA-256 だけを private スキーマに保存し、更新・削除のたびに照合する。
-- - 駒キャッシュ・生成待ち行列の書き込みはサーバー（Vercel Functions）専用。
--   サーバーは SUPABASE_SERVER_TOKEN を渡し、DB は private.config のハッシュと照合する。
-- - 対戦データ（public.matches）は対戦コードを知っていれば誰でも読める（観戦と同じ扱い）。
--   個人情報は入れない。

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ===== 共通 =====
create table if not exists private.config (
  name text primary key,
  value text not null
);

create or replace function private.sha256_hex(p text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function private.is_server(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.config
    where name = 'server_token_sha256' and value = private.sha256_hex(coalesce(p_token, ''))
  )
$$;

-- ===== 駒キャッシュと生成待ち行列 =====
create table if not exists public.pieces (
  key text primary key check (char_length(key) between 1 and 64),
  word text not null check (char_length(word) between 1 and 64),
  data jsonb not null,
  provider text,
  backfilled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.pieces enable row level security;
drop policy if exists "pieces are readable by everyone" on public.pieces;
create policy "pieces are readable by everyone" on public.pieces for select to anon, authenticated using (true);

create table if not exists public.generation_queue (
  key text primary key,
  word text not null,
  requests integer not null default 1,
  last_requested_at timestamptz not null default now()
);
alter table public.generation_queue enable row level security;

create or replace function public.server_save_piece(p_token text, p_key text, p_word text, p_data jsonb, p_provider text, p_backfilled boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_server(p_token) then raise exception 'forbidden' using errcode = '42501'; end if;
  if pg_column_size(p_data) > 64000 then raise exception 'piece data too large'; end if;
  insert into public.pieces (key, word, data, provider, backfilled) values (p_key, p_word, p_data, p_provider, p_backfilled)
  on conflict (key) do update set word = excluded.word, data = excluded.data, provider = excluded.provider,
    backfilled = excluded.backfilled, created_at = now();
  delete from public.generation_queue where key = p_key;
end $$;

create or replace function public.server_enqueue_word(p_token text, p_key text, p_word text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_server(p_token) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.generation_queue (key, word) values (p_key, p_word)
  on conflict (key) do update set requests = public.generation_queue.requests + 1, last_requested_at = now();
end $$;

create or replace function public.server_list_queue(p_token text, p_limit integer)
returns table (key text, word text, requests integer) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_server(p_token) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select q.key, q.word, q.requests from public.generation_queue q
    order by q.requests desc, q.last_requested_at asc limit least(greatest(p_limit, 1), 500);
end $$;

create or replace function public.server_delete_queue(p_token text, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_server(p_token) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.generation_queue where key = p_key;
end $$;

-- 未生成の単語の代わりに使う「近い単語」のキーを探す。
-- 入力に含まれるキャッシュ語（例: 「黒猫」→「猫」）を最優先し、長い一致ほど近いとみなす。
-- 次に、入力を含むキャッシュ語（例: 「猫」→「招き猫」）のうち短いものを選ぶ。
create or replace function public.find_similar_key(p_key text)
returns text language sql stable security definer set search_path = '' as $$
  select p.key from public.pieces p
  where p.key <> coalesce(p_key, '') and char_length(coalesce(p_key, '')) between 1 and 64
    and (strpos(p_key, p.key) > 0 or (char_length(p_key) >= 2 and strpos(p.key, p_key) > 0))
  order by (strpos(p_key, p.key) > 0) desc,
    case when strpos(p_key, p.key) > 0 then -char_length(p.key) else char_length(p.key) end
  limit 1
$$;

-- ===== オンライン対戦 =====
create table if not exists public.matches (
  code text primary key check (code ~ '^[0-9]{6}$'),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.matches enable row level security;
drop policy if exists "matches are readable" on public.matches;
create policy "matches are readable" on public.matches for select to anon, authenticated using (true);
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
    alter publication supabase_realtime add table public.matches;
  end if;
end $$;

create table if not exists private.match_secrets (
  code text primary key references public.matches (code) on delete cascade,
  sente_hash text not null,
  gote_hash text
);

-- data に patch を上書きマージし、logs は配列の末尾に追加する（双方の同時書き込みでログが消えないように）
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
  if pg_column_size(merged) > 900000 then raise exception 'match data too large'; end if;
  update public.matches set data = merged, updated_at = now() where code = p_code;
end $$;

create or replace function public.create_match(p_code text, p_secret text, p_data jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_code !~ '^[0-9]{6}$' or char_length(coalesce(p_secret, '')) < 16 then raise exception 'invalid request'; end if;
  if pg_column_size(p_data) > 900000 then raise exception 'match data too large'; end if;
  insert into public.matches (code, data) values (p_code, p_data) on conflict (code) do nothing;
  if not found then return false; end if;
  insert into private.match_secrets (code, sente_hash) values (p_code, private.sha256_hex(p_secret));
  return true;
end $$;

-- 後手として参加する（最初に参加した端末の秘密だけが後手として登録される）
create or replace function public.join_match(p_code text, p_secret text, p_patch jsonb, p_logs jsonb default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  s private.match_secrets%rowtype;
  h text := private.sha256_hex(coalesce(p_secret, ''));
begin
  if char_length(coalesce(p_secret, '')) < 16 then raise exception 'invalid request'; end if;
  select * into s from private.match_secrets where code = p_code for update;
  if not found or s.sente_hash = h then return false; end if;
  if s.gote_hash is null then
    update private.match_secrets set gote_hash = h where code = p_code;
  elsif s.gote_hash <> h then
    return false;
  end if;
  perform private.apply_match_patch(p_code, p_patch, p_logs);
  return true;
end $$;

create or replace function public.update_match(p_code text, p_secret text, p_patch jsonb, p_logs jsonb default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  h text := private.sha256_hex(coalesce(p_secret, ''));
begin
  if not exists (select 1 from private.match_secrets where code = p_code and (sente_hash = h or gote_hash = h)) then
    return false;
  end if;
  perform private.apply_match_patch(p_code, p_patch, p_logs);
  return true;
end $$;

-- 部屋を作った人（先手）だけが削除できる
create or replace function public.delete_match(p_code text, p_secret text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.matches m using private.match_secrets s
  where m.code = p_code and s.code = m.code and s.sente_hash = private.sha256_hex(coalesce(p_secret, ''));
  return found;
end $$;

-- ===== ランダムマッチの待ち行列 =====
create table if not exists public.matchmaking_queue (
  id text primary key check (char_length(id) between 4 and 64),
  room_code text not null check (room_code ~ '^[0-9]{6}$'),
  secret_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.matchmaking_queue enable row level security;

create or replace function public.enqueue_match(p_id text, p_secret text, p_room_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  h text := private.sha256_hex(coalesce(p_secret, ''));
begin
  if char_length(coalesce(p_secret, '')) < 16 then raise exception 'invalid request'; end if;
  insert into public.matchmaking_queue (id, room_code, secret_hash) values (p_id, p_room_code, h)
  on conflict (id) do update set room_code = excluded.room_code, created_at = now()
    where public.matchmaking_queue.secret_hash = h;
  return found;
end $$;

-- 待っている人を1人取り出して、その人の部屋コードを返す（同時に2人が同じ相手を取らないよう skip locked）
create or replace function public.take_waiting_match(p_exclude_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  taken text;
begin
  with c as (
    select q.id from public.matchmaking_queue q
    where q.id <> coalesce(p_exclude_id, '') and q.created_at > now() - interval '15 minutes'
    order by q.created_at asc limit 1 for update skip locked
  )
  delete from public.matchmaking_queue q using c where q.id = c.id returning q.room_code into taken;
  return taken;
end $$;

create or replace function public.dequeue_match(p_id text, p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.matchmaking_queue where id = p_id and secret_hash = private.sha256_hex(coalesce(p_secret, ''));
end $$;

-- ===== 古いデータの自動掃除（無料枠 500MB を超えないように。毎時17分） =====
select cron.schedule('kaku-shogi-cleanup', '17 * * * *', $c$
  delete from public.matches where updated_at < now() - interval '2 days';
  delete from public.matchmaking_queue where created_at < now() - interval '15 minutes';
$c$);

-- ===== 権限: ブラウザは読み取りと下の12個の RPC だけ =====
-- RLS は TRUNCATE を止めないため、テーブル権限そのものも絞る
revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
grant select on public.pieces, public.matches to anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant execute on function
  public.server_save_piece(text, text, text, jsonb, text, boolean),
  public.server_enqueue_word(text, text, text),
  public.server_list_queue(text, integer),
  public.server_delete_queue(text, text),
  public.find_similar_key(text),
  public.create_match(text, text, jsonb),
  public.join_match(text, text, jsonb, jsonb),
  public.update_match(text, text, jsonb, jsonb),
  public.delete_match(text, text),
  public.enqueue_match(text, text, text),
  public.take_waiting_match(text),
  public.dequeue_match(text, text)
to anon, authenticated;

-- サーバー用トークンのハッシュ（トークン本体は Vercel の環境変数 SUPABASE_SERVER_TOKEN にだけ置く）
-- 新しく作り直すとき:
--   insert into private.config (name, value) values ('server_token_sha256', '<sha256(トークン)>')
--   on conflict (name) do update set value = excluded.value;
