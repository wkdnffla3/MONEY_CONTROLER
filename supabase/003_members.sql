-- 여러 명이 한 계정을 쓸 때 "누가 썼는지" 기록하기 위한 업데이트
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)

-- 1) 내역마다 쓴 사람 (비어 있으면 "공동")
alter table public.transactions add column if not exists member_id text;
alter table public.transactions drop constraint if exists transactions_member_id_len;
alter table public.transactions add  constraint transactions_member_id_len
  check (member_id is null or char_length(member_id) between 1 and 64);

-- 2) 함께 쓰는 사람 목록 (최대 10명) — [{ "id": "...", "name": "엄마", "color": 0 }, ...]
alter table public.settings add column if not exists members jsonb not null default '[]'::jsonb;
alter table public.settings drop constraint if exists settings_members_valid;
alter table public.settings add  constraint settings_members_valid
  check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) <= 10 and pg_column_size(members) <= 4096);

-- 3) 앱이 새 칸을 바로 인식하도록 API 스키마 새로고침
notify pgrst, 'reload schema';
