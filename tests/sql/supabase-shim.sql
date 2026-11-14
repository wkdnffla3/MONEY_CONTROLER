-- 실제 Supabase 대신 로컬 Postgres 에서 쓰는 흉내: 역할(anon·authenticated·service_role), auth.uid(), 테스트 계정 4개
-- Supabase 흉내: 역할, auth 스키마, publication
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create publication supabase_realtime;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','owner@gmail.com'),
 ('00000000-0000-0000-0000-00000000000b','bob@naver.com'),
 ('00000000-0000-0000-0000-00000000000c','carol@x.com'),
 ('00000000-0000-0000-0000-00000000000d','dave@x.com');
-- Vault·pg_cron·pg_net 흉내 (009 예약 리포트용). 실제 HTTP 호출 대신 net.calls 에 기록
create schema if not exists vault; create table if not exists vault.secrets(id serial, name text unique, secret text);
create or replace function vault.create_secret(s text, n text) returns int language sql as $$ insert into vault.secrets(name,secret) values (n,s) returning id $$;
create or replace view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
create schema if not exists cron; create table if not exists cron.job(jobname text primary key, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job values (n,s,c) on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command returning 1 $$;
create schema if not exists net; create table if not exists net.calls(url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ insert into net.calls values (url, headers, body) returning 1 $$;
