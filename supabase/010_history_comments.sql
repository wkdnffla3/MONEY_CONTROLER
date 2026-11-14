-- 변경 기록 + 내역 댓글 + 구독 자동 발견(무시 목록) 업데이트
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)
-- 008 을 먼저 실행하세요. (009 리포트 예약은 선택이라 순서 상관없음)

-- ===== 1. 변경 기록 =====
-- 내역·장보기 물품이 추가·수정·삭제될 때마다 DB가 자동으로 기록 (앱이 빠뜨리거나 조작할 수 없음)
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade, -- 어느 가계부
  actor       uuid references auth.users (id) on delete set null,         -- 누가 (계정)
  table_name  text not null check (table_name in ('transactions', 'shopping_items')),
  row_id      text not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists activity_log_ledger_idx on public.activity_log (user_id, id desc);
alter table public.activity_log enable row level security;
drop policy if exists "ledger activity read" on public.activity_log;
create policy "ledger activity read" on public.activity_log for select
  using (user_id = (select public.current_ledger()));
-- 쓰기 정책 없음 → 앱에서 직접 추가·수정·삭제 불가 (아래 트리거만 기록)

create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'device_id' - 'user_id' else null end;
  a jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'device_id' - 'user_id' else null end;
  lid uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  -- 같은 내용 다시 저장(재전송 등)은 기록하지 않음
  if tg_op = 'UPDATE' and b = a then return null; end if;
  -- 계정 삭제로 가계부가 통째로 지워지는 중이면 기록하지 않음 (기록도 함께 지워짐)
  if not exists (select 1 from auth.users where id = lid) then return null; end if;
  insert into public.activity_log (user_id, actor, table_name, row_id, action, before, after)
  values (lid, auth.uid(), tg_table_name, coalesce(new.id, old.id), lower(tg_op), b, a);
  -- 가끔 90일 지난 기록 정리
  if random() < 0.02 then
    delete from public.activity_log where user_id = lid and created_at < now() - interval '90 days';
  end if;
  return null;
end $$;
revoke all on function public.log_activity() from public, anon, authenticated;

drop trigger if exists log_transactions on public.transactions;
create trigger log_transactions after insert or update or delete on public.transactions
  for each row execute function public.log_activity();
drop trigger if exists log_shopping_items on public.shopping_items;
create trigger log_shopping_items after insert or update or delete on public.shopping_items
  for each row execute function public.log_activity();

-- ===== 2. 내역 댓글 =====
create table if not exists public.tx_comments (
  id           text primary key check (char_length(id) between 1 and 64),
  user_id      uuid not null references auth.users (id) on delete cascade,  -- 어느 가계부
  tx_id        text not null check (char_length(tx_id) between 1 and 64),
  author       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name  text not null check (char_length(author_name) between 1 and 20),
  body         text not null check (char_length(btrim(body)) between 1 and 300),
  created_at   timestamptz not null default now()
);
create index if not exists tx_comments_ledger_idx on public.tx_comments (user_id, created_at);
alter table public.tx_comments enable row level security;
drop policy if exists "ledger comments read" on public.tx_comments;
create policy "ledger comments read" on public.tx_comments for select
  using (user_id = (select public.current_ledger()));
drop policy if exists "ledger comments write" on public.tx_comments;
create policy "ledger comments write" on public.tx_comments for insert
  with check (user_id = (select public.current_ledger()) and author = auth.uid());
drop policy if exists "own comments delete" on public.tx_comments;
create policy "own comments delete" on public.tx_comments for delete
  using (author = auth.uid() and user_id = (select public.current_ledger()));
-- 수정 정책 없음 (댓글은 지우고 다시 쓰기)

do $$ begin
  alter publication supabase_realtime add table public.tx_comments;
exception when duplicate_object then null; end $$;

-- ===== 3. 구독 자동 발견: "무시"한 항목 (최대 100개) =====
alter table public.settings add column if not exists dismissed_subs jsonb not null default '[]'::jsonb;
alter table public.settings drop constraint if exists settings_dismissed_subs_valid;
alter table public.settings add  constraint settings_dismissed_subs_valid
  check (jsonb_typeof(dismissed_subs) = 'array' and jsonb_array_length(dismissed_subs) <= 100 and pg_column_size(dismissed_subs) <= 8192);

notify pgrst, 'reload schema';
