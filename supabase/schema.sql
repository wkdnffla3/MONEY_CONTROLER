-- 가계부 DB 스키마 — Supabase 대시보드 → SQL Editor 에 붙여넣고 Run

-- 1) 내역 테이블
create table if not exists public.transactions (
  id          text primary key check (char_length(id) between 1 and 64),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type        text not null check (type in ('expense', 'income')),
  amount      bigint not null check (amount between 1 and 9999999999),
  category    text not null check (char_length(category) between 1 and 20),
  memo        text default '' check (char_length(memo) <= 100),
  date        date not null,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date);

-- 2) 사용자별 설정(월 예산)
create table if not exists public.settings (
  user_id  uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  budget   bigint not null default 0 check (budget between 0 and 9999999999)
);

-- 3) 행 단위 보안: 로그인한 본인 데이터만 읽고 쓸 수 있게
alter table public.transactions enable row level security;
alter table public.settings     enable row level security;

drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 4) 실시간 동기화(다른 기기에서 바꾼 내용 즉시 반영)
alter publication supabase_realtime add table public.transactions;
alter publication supabase_realtime add table public.settings;
