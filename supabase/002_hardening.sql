-- 이미 schema.sql을 실행한 프로젝트용: 값 범위 제한 추가
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)

alter table public.transactions drop constraint if exists transactions_id_len;
alter table public.transactions add  constraint transactions_id_len       check (char_length(id) between 1 and 64);

alter table public.transactions drop constraint if exists transactions_amount_range;
alter table public.transactions add  constraint transactions_amount_range check (amount between 1 and 9999999999);

alter table public.transactions drop constraint if exists transactions_category_len;
alter table public.transactions add  constraint transactions_category_len check (char_length(category) between 1 and 20);

alter table public.transactions drop constraint if exists transactions_memo_len;
alter table public.transactions add  constraint transactions_memo_len     check (char_length(memo) <= 100);

alter table public.settings drop constraint if exists settings_budget_range;
alter table public.settings add  constraint settings_budget_range check (budget between 0 and 9999999999);
