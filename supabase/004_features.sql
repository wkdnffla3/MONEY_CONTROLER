-- 반복 내역 · 카테고리 편집 · 카테고리별 예산을 위한 업데이트
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)
-- 003_members.sql 을 먼저 실행하세요.

-- 반복 내역 규칙 (최대 50개)
alter table public.settings add column if not exists recurring jsonb not null default '[]'::jsonb;
alter table public.settings drop constraint if exists settings_recurring_valid;
alter table public.settings add  constraint settings_recurring_valid
  check (jsonb_typeof(recurring) = 'array' and jsonb_array_length(recurring) <= 50 and pg_column_size(recurring) <= 32768);

-- 사용자 카테고리 (null 이면 기본 카테고리)
alter table public.settings add column if not exists categories jsonb;
alter table public.settings drop constraint if exists settings_categories_valid;
alter table public.settings add  constraint settings_categories_valid
  check (categories is null or (jsonb_typeof(categories) = 'object' and pg_column_size(categories) <= 8192));

-- 카테고리별 예산 { "식비": 400000, ... }
alter table public.settings add column if not exists cat_budgets jsonb not null default '{}'::jsonb;
alter table public.settings drop constraint if exists settings_cat_budgets_valid;
alter table public.settings add  constraint settings_cat_budgets_valid
  check (jsonb_typeof(cat_budgets) = 'object' and pg_column_size(cat_budgets) <= 8192);

notify pgrst, 'reload schema';
