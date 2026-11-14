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
  tags        jsonb not null default '[]'::jsonb
              check (jsonb_typeof(tags) = 'array' and jsonb_array_length(tags) <= 5 and pg_column_size(tags) <= 512),
  card_id     text check (card_id is null or char_length(card_id) between 1 and 64),
  inst_months smallint not null default 1 check (inst_months between 1 and 36),
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
           check (jsonb_typeof(cat_budgets) = 'object' and pg_column_size(cat_budgets) <= 8192),
  cards    jsonb not null default '[]'::jsonb
           check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) <= 10 and pg_column_size(cards) <= 4096)
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
  tags        jsonb not null default '[]'::jsonb
              check (jsonb_typeof(tags) = 'array' and jsonb_array_length(tags) <= 5 and pg_column_size(tags) <= 512),
  card_id     text check (card_id is null or char_length(card_id) between 1 and 64),
  inst_months smallint not null default 1 check (inst_months between 1 and 36),
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

-- ===== 007: 알림 (supabase/007_notifications.sql 과 같은 내용) =====
alter table public.transactions   add column if not exists device_id text;
alter table public.shopping_items add column if not exists device_id text;
alter table public.transactions   drop constraint if exists transactions_device_id_len;
alter table public.transactions   add  constraint transactions_device_id_len   check (device_id is null or char_length(device_id) <= 64);
alter table public.shopping_items drop constraint if exists shopping_items_device_id_len;
alter table public.shopping_items add  constraint shopping_items_device_id_len check (device_id is null or char_length(device_id) <= 64);
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
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== 008: 가계부 공유 · 즐겨찾기 (supabase/008_sharing_favorites.sql 과 같은 내용) =====
-- ===== 1. 즐겨찾기 (최대 20개) =====
alter table public.settings add column if not exists favorites jsonb not null default '[]'::jsonb;
alter table public.settings drop constraint if exists settings_favorites_valid;
alter table public.settings add  constraint settings_favorites_valid
  check (jsonb_typeof(favorites) = 'array' and jsonb_array_length(favorites) <= 20 and pg_column_size(favorites) <= 8192);

-- ===== 2. 참여자 · 초대 =====
create table if not exists public.ledger_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,  -- 참여한 계정 (한 계정은 한 가계부에만)
  ledger_id  uuid not null references auth.users (id) on delete cascade,     -- 참여한 가계부 (= 만든 사람 계정)
  person_id  text check (person_id is null or char_length(person_id) <= 64), -- 가계부의 "사람" 목록 중 누구인지
  joined_at  timestamptz not null default now(),
  check (user_id <> ledger_id)
);
create index if not exists ledger_members_ledger_idx on public.ledger_members (ledger_id);
alter table public.ledger_members enable row level security;
-- 직접 읽기·쓰기 금지 (아래 함수로만). 정책이 없으면 RLS가 모두 막음

create table if not exists public.ledger_invites (
  code        text primary key check (code ~ '^[A-Z2-9]{10}$'),
  ledger_id   uuid not null references auth.users (id) on delete cascade,
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '48 hours',
  used_by     uuid references auth.users (id) on delete set null,
  used_at     timestamptz
);
create index if not exists ledger_invites_ledger_idx on public.ledger_invites (ledger_id);
alter table public.ledger_invites enable row level security;

-- 지금 로그인한 계정이 보는 가계부: 참여 중이면 그 가계부, 아니면 내 가계부
create or replace function public.current_ledger() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select m.ledger_id from public.ledger_members m where m.user_id = auth.uid()), auth.uid());
$$;

-- ===== 3. 보안 규칙: 내 계정 → 내가 보는 가계부 =====
-- (select ...) 로 감싸면 줄마다가 아니라 요청마다 한 번만 계산됨
drop policy if exists "own transactions" on public.transactions;
drop policy if exists "ledger transactions" on public.transactions;
create policy "ledger transactions" on public.transactions for all
  using (user_id = (select public.current_ledger())) with check (user_id = (select public.current_ledger()));

drop policy if exists "own settings" on public.settings;
drop policy if exists "ledger settings" on public.settings;
create policy "ledger settings" on public.settings for all
  using (user_id = (select public.current_ledger())) with check (user_id = (select public.current_ledger()));

drop policy if exists "own shopping items" on public.shopping_items;
drop policy if exists "ledger shopping items" on public.shopping_items;
create policy "ledger shopping items" on public.shopping_items for all
  using (user_id = (select public.current_ledger())) with check (user_id = (select public.current_ledger()));

-- 푸시 구독: user_id = 알림 받을 가계부, account_id = 기기 주인 계정 (자기 기기 줄만 관리)
alter table public.push_subscriptions add column if not exists account_id uuid references auth.users (id) on delete cascade;
update public.push_subscriptions set account_id = user_id where account_id is null;
alter table public.push_subscriptions alter column account_id set default auth.uid();
alter table public.push_subscriptions alter column account_id set not null;
create index if not exists push_subscriptions_account_idx on public.push_subscriptions (account_id);
drop policy if exists "own push subscriptions" on public.push_subscriptions;
drop policy if exists "own device push subscriptions" on public.push_subscriptions;
create policy "own device push subscriptions" on public.push_subscriptions for all
  using (account_id = auth.uid())
  with check (account_id = auth.uid() and user_id = (select public.current_ledger()));

-- ===== 4. 함수 (앱에서 supabase.rpc 로 호출) =====
-- 오류 문구는 앱이 한국어로 바꿔 보여줌: invalid_code / expired / used / own_ledger / already_joined / has_members / full / not_member / not_signed_in

-- 내 가계부 정보와 참여자 목록
create or replace function public.my_ledger() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  lid uuid;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  lid := public.current_ledger();
  return jsonb_build_object(
    'ledger_id', lid,
    'is_owner', lid = me,
    'person_id', (select person_id from public.ledger_members where user_id = me),
    'people', (
      select coalesce(jsonb_agg(p order by p->>'joined_at'), '[]'::jsonb) from (
        select jsonb_build_object('user_id', u.id, 'email', u.email, 'owner', true, 'person_id', null, 'joined_at', '0') as p
          from auth.users u where u.id = lid
        union all
        select jsonb_build_object('user_id', m.user_id, 'email', u.email, 'owner', false, 'person_id', m.person_id, 'joined_at', m.joined_at::text)
          from public.ledger_members m join auth.users u on u.id = m.user_id where m.ledger_id = lid
      ) s
    )
  );
end $$;

-- 초대 코드 만들기 (48시간, 한 번만 사용). 참여자 누구나 가능
create or replace function public.create_invite() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  lid uuid;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 헷갈리는 0·O·1·I 제외, 32글자
  b bytea;
  c text;
  inv public.ledger_invites;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  lid := public.current_ledger();
  if (select count(*) from public.ledger_members where ledger_id = lid) >= 9 then raise exception 'full'; end if;
  delete from public.ledger_invites where ledger_id = lid and (expires_at < now() or used_by is not null);
  -- 아직 안 쓴 초대는 최근 5개만 유지
  delete from public.ledger_invites where code in (
    select code from public.ledger_invites where ledger_id = lid order by created_at desc offset 4);
  loop
    -- gen_random_uuid 는 안전한 난수. 버전·변형 비트가 있는 6·8번째 바이트는 건너뜀
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    c := '';
    for i in 0..15 loop
      continue when i in (6, 8);
      exit when length(c) = 10;
      c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.ledger_invites where code = c);
  end loop;
  insert into public.ledger_invites (code, ledger_id, created_by) values (c, lid, me) returning * into inv;
  return jsonb_build_object('code', inv.code, 'expires_at', inv.expires_at);
end $$;

-- 초대 코드 확인: 참여 전에 그 가계부의 "사람" 목록을 보여줘서 나를 고르게 함
create or replace function public.peek_invite(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  inv public.ledger_invites;
  owner_email text;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  select * into inv from public.ledger_invites where code = upper(trim(p_code));
  if not found then raise exception 'invalid_code'; end if;
  if inv.used_by is not null then raise exception 'used'; end if;
  if inv.expires_at < now() then raise exception 'expired'; end if;
  if inv.ledger_id = me then raise exception 'own_ledger'; end if;
  select email into owner_email from auth.users where id = inv.ledger_id;
  return jsonb_build_object(
    -- 이메일은 일부만 (예: wk***@gmail.com)
    'owner', regexp_replace(coalesce(owner_email, ''), '^(.{1,2})[^@]*', '\1***'),
    'members', coalesce((select s.members from public.settings s where s.user_id = inv.ledger_id), '[]'::jsonb),
    'count', 1 + (select count(*) from public.ledger_members where ledger_id = inv.ledger_id)
  );
end $$;

-- 참여: p_person = 기존 "사람" id (없으면 null), p_name = 새로 추가할 내 이름 (p_person 이 없을 때)
create or replace function public.join_ledger(p_code text, p_person text default null, p_name text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  inv public.ledger_invites;
  mem jsonb;
  pid text := null;
  nm text := nullif(trim(coalesce(p_name, '')), '');
begin
  if me is null then raise exception 'not_signed_in'; end if;
  select * into inv from public.ledger_invites where code = upper(trim(p_code)) for update;
  if not found then raise exception 'invalid_code'; end if;
  if inv.used_by is not null then raise exception 'used'; end if;
  if inv.expires_at < now() then raise exception 'expired'; end if;
  if inv.ledger_id = me then raise exception 'own_ledger'; end if;
  if exists (select 1 from public.ledger_members where user_id = me) then raise exception 'already_joined'; end if;
  if exists (select 1 from public.ledger_members where ledger_id = me) then raise exception 'has_members'; end if;
  if (select count(*) from public.ledger_members where ledger_id = inv.ledger_id) >= 9 then raise exception 'full'; end if;

  -- "사람" 연결: 기존 사람을 고르거나, 이름을 주면 사람 목록에 추가
  insert into public.settings (user_id) values (inv.ledger_id) on conflict (user_id) do nothing;
  select members into mem from public.settings where user_id = inv.ledger_id for update;
  mem := coalesce(mem, '[]'::jsonb);
  if p_person is not null and exists (select 1 from jsonb_array_elements(mem) e where e->>'id' = p_person) then
    pid := p_person;
  elsif nm is not null and char_length(nm) <= 12 and jsonb_array_length(mem) < 10 then
    pid := 'acct-' || replace(me::text, '-', '');
    pid := left(pid, 40);
    if not exists (select 1 from jsonb_array_elements(mem) e where e->>'id' = pid) then
      update public.settings
        set members = mem || jsonb_build_array(jsonb_build_object('id', pid, 'name', nm, 'color', jsonb_array_length(mem) % 10))
        where user_id = inv.ledger_id;
    end if;
  end if;

  insert into public.ledger_members (user_id, ledger_id, person_id) values (me, inv.ledger_id, pid);
  update public.ledger_invites set used_by = me, used_at = now() where code = inv.code;
  -- 이 계정 기기들의 푸시는 이제 공유 가계부 알림을 받음
  update public.push_subscriptions set user_id = inv.ledger_id where account_id = me;
  return jsonb_build_object('ledger_id', inv.ledger_id, 'person_id', pid);
end $$;

-- 참여자 내보내기 (자기 자신이면 나가기). 같은 가계부 참여자 누구나 가능, 만든 사람은 내보낼 수 없음
create or replace function public.remove_member(p_user uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  lid uuid;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  lid := public.current_ledger();
  if not exists (select 1 from public.ledger_members where user_id = p_user and ledger_id = lid) then
    raise exception 'not_member';
  end if;
  delete from public.ledger_members where user_id = p_user;
  -- 그 계정 기기들의 푸시는 다시 자기 가계부로
  update public.push_subscriptions set user_id = p_user where account_id = p_user;
end $$;

create or replace function public.leave_ledger() returns void
language sql volatile security definer set search_path = public as $$
  select public.remove_member(auth.uid());
$$;

-- 로그인한 사람만 호출 가능 (익명 차단)
revoke all on function public.current_ledger() from public, anon;
revoke all on function public.my_ledger() from public, anon;
revoke all on function public.create_invite() from public, anon;
revoke all on function public.peek_invite(text) from public, anon;
revoke all on function public.join_ledger(text, text, text) from public, anon;
revoke all on function public.remove_member(uuid) from public, anon;
revoke all on function public.leave_ledger() from public, anon;
grant execute on function public.current_ledger() to authenticated;
grant execute on function public.my_ledger() to authenticated;
grant execute on function public.create_invite() to authenticated;
grant execute on function public.peek_invite(text) to authenticated;
grant execute on function public.join_ledger(text, text, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.leave_ledger() to authenticated;

notify pgrst, 'reload schema';
