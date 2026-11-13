-- 장보기 목록을 위한 업데이트
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)

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

notify pgrst, 'reload schema';
