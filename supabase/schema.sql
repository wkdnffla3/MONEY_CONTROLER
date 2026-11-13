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
  member_id   text check (member_id is null or char_length(member_id) between 1 and 64),
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date);

-- 2) 사용자별 설정(월 예산)
create table if not exists public.settings (
  user_id  uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  budget   bigint not null default 0 check (budget between 0 and 9999999999),
  members  jsonb not null default '[]'::jsonb
           check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) <= 10 and pg_column_size(members) <= 4096),
  recurring jsonb not null default '[]'::jsonb
           check (jsonb_typeof(recurring) = 'array' and jsonb_array_length(recurring) <= 50 and pg_column_size(recurring) <= 32768),
  categories jsonb
           check (categories is null or (jsonb_typeof(categories) = 'object' and pg_column_size(categories) <= 8192)),
  cat_budgets jsonb not null default '{}'::jsonb
           check (jsonb_typeof(cat_budgets) = 'object' and pg_column_size(cat_budgets) <= 8192)
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

-- 5) 장보기 목록
create table if not exists public.shopping_items (
  id          text primary key check (char_length(id) between 1 and 64),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  qty         integer not null default 1 check (qty between 1 and 999),
  price       bigint not null default 0 check (price between 0 and 9999999999),  -- 예상 단가 (0 = 미정)
  category    text not null check (char_length(category) between 1 and 20),
  member_id   text check (member_id is null or char_length(member_id) between 1 and 64),
  memo        text not null default '' check (char_length(memo) <= 100),
  checked     boolean not null default false,                                   -- 장바구니에 담음
  status      text not null default 'todo' check (status in ('todo', 'bought')),
  paid        bigint check (paid is null or paid between 1 and 9999999999),     -- 실제 결제 금액
  tx_id       text check (tx_id is null or char_length(tx_id) between 1 and 64), -- 연결된 가계부 내역
  bought_at   date,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists shopping_items_user_idx on public.shopping_items (user_id, status);

alter table public.shopping_items enable row level security;
drop policy if exists "own shopping items" on public.shopping_items;
create policy "own shopping items" on public.shopping_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 다른 기기에서 바꾼 목록을 실시간으로 반영 (이미 추가돼 있으면 건너뜀)
do $$ begin
  alter publication supabase_realtime add table public.shopping_items;
exception when duplicate_object then null; end $$;
