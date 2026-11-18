-- 015: 반복 내역 최대 50개 → 100개
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전, 011 이후)
-- 실행 전에도 앱은 동작해요. 51번째부터는 이 기기에 보관됐다가, 실행하면 자동으로 올라가요.

-- 반복 내역 최대 100개 (가계부 하나당, 공유 가계부는 참여자 모두 합쳐서)
-- 설치마다 제약 이름이 다를 수 있어서, 반복 내역을 검사하는 제약을 정의로 찾아 지운 뒤 새로 만듦
do $$
declare r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid = 'public.settings'::regclass
       and (pg_get_constraintdef(c.oid) like '%jsonb_array_length(recurring)%'
         or pg_get_constraintdef(c.oid) like '%pg_column_size(recurring)%')
  loop
    execute format('alter table public.settings drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.settings drop constraint if exists settings_recurring_valid;
alter table public.settings add  constraint settings_recurring_valid
  check (jsonb_typeof(recurring) = 'array' and jsonb_array_length(recurring) <= 100 and pg_column_size(recurring) <= 65536);

notify pgrst, 'reload schema';
