-- 태그 · 신용카드 결제일/할부를 위한 업데이트
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)
-- 003, 004, 005 를 먼저 실행하세요.

-- 내역 태그 (최대 5개) ["여행", "명절"]
alter table public.transactions add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.transactions drop constraint if exists transactions_tags_valid;
alter table public.transactions add  constraint transactions_tags_valid
  check (jsonb_typeof(tags) = 'array' and jsonb_array_length(tags) <= 5 and pg_column_size(tags) <= 512);

-- 결제한 카드 (비어 있으면 현금·체크카드 등)
alter table public.transactions add column if not exists card_id text;
alter table public.transactions drop constraint if exists transactions_card_id_len;
alter table public.transactions add  constraint transactions_card_id_len
  check (card_id is null or char_length(card_id) between 1 and 64);

-- 할부 개월 (1 = 일시불)
alter table public.transactions add column if not exists inst_months smallint not null default 1;
alter table public.transactions drop constraint if exists transactions_inst_months_range;
alter table public.transactions add  constraint transactions_inst_months_range check (inst_months between 1 and 36);

-- 등록한 카드 목록 (최대 10개) [{ "id", "name", "payDay", "closeDay", "color" }]
alter table public.settings add column if not exists cards jsonb not null default '[]'::jsonb;
alter table public.settings drop constraint if exists settings_cards_valid;
alter table public.settings add  constraint settings_cards_valid
  check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) <= 10 and pg_column_size(cards) <= 4096);

notify pgrst, 'reload schema';
