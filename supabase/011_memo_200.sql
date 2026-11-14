-- 메모 최대 200자 (링크도 들어가게) 업데이트
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)
-- 실행 전에도 앱은 동작해요. 100자가 넘는 메모만 이 기기에 보관됐다가 실행 후 자동으로 올라가요.

-- 1. 내역·장보기 메모: 이름이 무엇이든(예전 설치·새 설치마다 다름) 메모 길이 제한을 모두 지우고 200자로 다시
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid in ('public.transactions'::regclass, 'public.shopping_items'::regclass)
       and pg_get_constraintdef(c.oid) like '%char_length(memo)%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;
alter table public.transactions   add constraint transactions_memo_len   check (char_length(memo) <= 200);
alter table public.shopping_items add constraint shopping_items_memo_len check (char_length(memo) <= 200);

-- 2. 메모가 들어가는 설정(반복 내역 50개, 즐겨찾기 20개)의 크기 한도도 늘림
--    (설치 시기에 따라 같은 규칙이 이름만 다르게 두 개 있을 수 있어서, 정의로 찾아 모두 지운 뒤 다시 만듦)
do $$
declare r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid = 'public.settings'::regclass
       and (pg_get_constraintdef(c.oid) like '%pg_column_size(recurring)%'
         or pg_get_constraintdef(c.oid) like '%pg_column_size(favorites)%')
  loop
    execute format('alter table public.settings drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.settings drop constraint if exists settings_recurring_valid;
alter table public.settings add  constraint settings_recurring_valid
  check (jsonb_typeof(recurring) = 'array' and jsonb_array_length(recurring) <= 50 and pg_column_size(recurring) <= 65536);
alter table public.settings drop constraint if exists settings_favorites_valid;
alter table public.settings add  constraint settings_favorites_valid
  check (jsonb_typeof(favorites) = 'array' and jsonb_array_length(favorites) <= 20 and pg_column_size(favorites) <= 16384);

notify pgrst, 'reload schema';
