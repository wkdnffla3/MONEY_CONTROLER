-- 알림(앱 안 알림 + 웹 푸시)을 위한 업데이트
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)
-- 003 ~ 006 을 먼저 실행하세요.

-- 어느 기기에서 입력했는지 (내가 입력한 건 내 기기에 알리지 않기 위해)
alter table public.transactions   add column if not exists device_id text;
alter table public.shopping_items add column if not exists device_id text;
alter table public.transactions   drop constraint if exists transactions_device_id_len;
alter table public.transactions   add  constraint transactions_device_id_len   check (device_id is null or char_length(device_id) <= 64);
alter table public.shopping_items drop constraint if exists shopping_items_device_id_len;
alter table public.shopping_items add  constraint shopping_items_device_id_len check (device_id is null or char_length(device_id) <= 64);

-- 웹 푸시를 받을 기기 목록 (기기마다 한 줄)
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id   text not null check (char_length(device_id) <= 64),
  endpoint    text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 1024),
  p256dh      text not null check (char_length(p256dh) <= 256),
  auth        text not null check (char_length(auth) <= 64),
  prefs       jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) <= 1024),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- 자기 기기 줄만 보고·쓰고·지울 수 있음. 알림 보내는 Edge Function 은 service_role 로 읽음
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';
