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
           check (jsonb_typeof(recurring) = 'array' and jsonb_array_length(recurring) <= 100 and pg_column_size(recurring) <= 65536),
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

-- ===== 010: 변경 기록 · 댓글 · 구독 무시 목록 (supabase/010_history_comments.sql 과 같은 내용) =====
-- ===== 1. 변경 기록 =====
-- 내역·장보기 물품이 추가·수정·삭제될 때마다 DB가 자동으로 기록 (앱이 빠뜨리거나 조작할 수 없음)
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade, -- 어느 가계부
  actor       uuid references auth.users (id) on delete set null,         -- 누가 (계정)
  table_name  text not null check (table_name in ('transactions', 'shopping_items')),
  row_id      text not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists activity_log_ledger_idx on public.activity_log (user_id, id desc);
alter table public.activity_log enable row level security;
drop policy if exists "ledger activity read" on public.activity_log;
create policy "ledger activity read" on public.activity_log for select
  using (user_id = (select public.current_ledger()));
-- 쓰기 정책 없음 → 앱에서 직접 추가·수정·삭제 불가 (아래 트리거만 기록)

create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'device_id' - 'user_id' else null end;
  a jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'device_id' - 'user_id' else null end;
  lid uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  -- 같은 내용 다시 저장(재전송 등)은 기록하지 않음
  if tg_op = 'UPDATE' and b = a then return null; end if;
  -- 계정 삭제로 가계부가 통째로 지워지는 중이면 기록하지 않음 (기록도 함께 지워짐)
  if not exists (select 1 from auth.users where id = lid) then return null; end if;
  insert into public.activity_log (user_id, actor, table_name, row_id, action, before, after)
  values (lid, auth.uid(), tg_table_name, coalesce(new.id, old.id), lower(tg_op), b, a);
  -- 가끔 90일 지난 기록 정리
  if random() < 0.02 then
    delete from public.activity_log where user_id = lid and created_at < now() - interval '90 days';
  end if;
  return null;
end $$;
revoke all on function public.log_activity() from public, anon, authenticated;

drop trigger if exists log_transactions on public.transactions;
create trigger log_transactions after insert or update or delete on public.transactions
  for each row execute function public.log_activity();
drop trigger if exists log_shopping_items on public.shopping_items;
create trigger log_shopping_items after insert or update or delete on public.shopping_items
  for each row execute function public.log_activity();

-- ===== 2. 내역 댓글 =====
create table if not exists public.tx_comments (
  id           text primary key check (char_length(id) between 1 and 64),
  user_id      uuid not null references auth.users (id) on delete cascade,  -- 어느 가계부
  tx_id        text not null check (char_length(tx_id) between 1 and 64),
  author       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name  text not null check (char_length(author_name) between 1 and 20),
  body         text not null check (char_length(btrim(body)) between 1 and 300),
  created_at   timestamptz not null default now()
);
create index if not exists tx_comments_ledger_idx on public.tx_comments (user_id, created_at);
alter table public.tx_comments enable row level security;
drop policy if exists "ledger comments read" on public.tx_comments;
create policy "ledger comments read" on public.tx_comments for select
  using (user_id = (select public.current_ledger()));
drop policy if exists "ledger comments write" on public.tx_comments;
create policy "ledger comments write" on public.tx_comments for insert
  with check (user_id = (select public.current_ledger()) and author = auth.uid());
drop policy if exists "own comments delete" on public.tx_comments;
create policy "own comments delete" on public.tx_comments for delete
  using (author = auth.uid() and user_id = (select public.current_ledger()));
-- 수정 정책 없음 (댓글은 지우고 다시 쓰기)

do $$ begin
  alter publication supabase_realtime add table public.tx_comments;
exception when duplicate_object then null; end $$;

-- ===== 3. 구독 자동 발견: "무시"한 항목 (최대 100개) =====
alter table public.settings add column if not exists dismissed_subs jsonb not null default '[]'::jsonb;
alter table public.settings drop constraint if exists settings_dismissed_subs_valid;
alter table public.settings add  constraint settings_dismissed_subs_valid
  check (jsonb_typeof(dismissed_subs) = 'array' and jsonb_array_length(dismissed_subs) <= 100 and pg_column_size(dismissed_subs) <= 8192);

notify pgrst, 'reload schema';

-- ===== 011: 메모 200자 (supabase/011_memo_200.sql 과 같은 내용) =====
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
  check (jsonb_typeof(recurring) = 'array' and jsonb_array_length(recurring) <= 100 and pg_column_size(recurring) <= 65536);
alter table public.settings drop constraint if exists settings_favorites_valid;
alter table public.settings add  constraint settings_favorites_valid
  check (jsonb_typeof(favorites) = 'array' and jsonb_array_length(favorites) <= 20 and pg_column_size(favorites) <= 16384);

notify pgrst, 'reload schema';

-- ===== 012: 웹 푸시 주소 제한 (supabase/012_push_endpoint_hosts.sql 과 같은 내용) =====
-- 푸시 주소는 실제 브라우저 푸시 서비스로만 (그 외 주소로 서버가 요청을 보내지 않게)
--   구글 FCM(크롬·삼성 인터넷·오페라 등), 모질라(파이어폭스), 마이크로소프트 WNS(엣지), 애플(사파리·아이폰)
--   목록 출처: https://github.com/pushpad/known-push-services
create or replace function public.is_push_endpoint(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p ~* '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)+notify\.windows\.com|([a-z0-9-]+\.)+push\.apple\.com)(:443)?/'
$$;
-- 이미 저장된 엉뚱한 주소는 지움 (정상 기기는 영향 없음)
delete from public.push_subscriptions where not public.is_push_endpoint(endpoint);
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_host;
alter table public.push_subscriptions add  constraint push_subscriptions_endpoint_host check (public.is_push_endpoint(endpoint));

notify pgrst, 'reload schema';

-- ===== 013: 카테고리 이름 일괄 변경 (supabase/013_rename_category.sql 과 같은 내용) =====
-- 1. 변경 기록 트리거: 카테고리 이름 일괄 변경(아래 함수)이 바꾸는 줄은 기록하지 않음.
--    함수 안에서만 켜지는 표시(ledger.skip_log)가 있고, 바뀐 칸이 카테고리 하나뿐일 때만 건너뜀
--    → 내역을 열어 카테고리를 바꾸는 한 건 수정은 지금처럼 기록됨
create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'device_id' - 'user_id' else null end;
  a jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'device_id' - 'user_id' else null end;
  lid uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  -- 같은 내용 다시 저장(재전송 등)은 기록하지 않음
  if tg_op = 'UPDATE' and b = a then return null; end if;
  -- 카테고리 이름 일괄 변경 (rename_category 안에서만)
  if tg_op = 'UPDATE' and tg_table_name = 'transactions'
     and current_setting('ledger.skip_log', true) = 'on'
     and (b - 'category') = (a - 'category') then
    return null;
  end if;
  -- 계정 삭제로 가계부가 통째로 지워지는 중이면 기록하지 않음 (기록도 함께 지워짐)
  if not exists (select 1 from auth.users where id = lid) then return null; end if;
  insert into public.activity_log (user_id, actor, table_name, row_id, action, before, after)
  values (lid, auth.uid(), tg_table_name, coalesce(new.id, old.id), lower(tg_op), b, a);
  -- 가끔 90일 지난 기록 정리
  if random() < 0.02 then
    delete from public.activity_log where user_id = lid and created_at < now() - interval '90 days';
  end if;
  return null;
end $$;
revoke all on function public.log_activity() from public, anon, authenticated;

-- 2. 카테고리 이름 일괄 변경: 이 가계부에서 그 이름을 쓰는 내역을 한 번에 바꾸고 바뀐 건수를 돌려줌.
--    호출한 사람 권한으로 실행(security invoker) → RLS 그대로, 내 가계부(공유 중이면 공유 가계부)만 바뀜.
--    다시 호출해도 이미 바뀐 뒤라 0건 (재전송에 안전)
create or replace function public.rename_category(p_type text, p_from text, p_to text) returns integer
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_type is null or p_type not in ('expense', 'income') then raise exception 'bad_type' using errcode = '22023'; end if;
  if p_from is null or p_to is null or p_from = p_to
     or char_length(p_from) not between 1 and 20 or char_length(p_to) not between 1 and 20 then
    raise exception 'bad_name' using errcode = '22023';
  end if;
  perform set_config('ledger.skip_log', 'on', true);
  update public.transactions set category = p_to
   where user_id = public.current_ledger() and type = p_type and category = p_from;
  get diagnostics n = row_count;
  perform set_config('ledger.skip_log', 'off', true);
  return n;
end $$;
revoke all on function public.rename_category(text, text, text) from public, anon;
grant execute on function public.rename_category(text, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ===== 014: 백업 복원 (supabase/014_restore_backup.sql 과 같은 내용) =====
-- 1. 변경 기록 트리거 (013 + 복원으로 새로 넣는 줄은 기록하지 않음)
create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'device_id' - 'user_id' else null end;
  a jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'device_id' - 'user_id' else null end;
  lid uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  -- 같은 내용 다시 저장(재전송 등)은 기록하지 않음
  if tg_op = 'UPDATE' and b = a then return null; end if;
  -- 백업 복원으로 새로 넣는 줄 (restore_backup 안에서만). 덮어쓰기(UPDATE)는 기록 → 되돌릴 수 있음
  if tg_op = 'INSERT' and current_setting('ledger.skip_log', true) = 'restore' then return null; end if;
  -- 카테고리 이름 일괄 변경 (rename_category 안에서만)
  if tg_op = 'UPDATE' and tg_table_name = 'transactions'
     and current_setting('ledger.skip_log', true) = 'on'
     and (b - 'category') = (a - 'category') then
    return null;
  end if;
  -- 계정 삭제로 가계부가 통째로 지워지는 중이면 기록하지 않음 (기록도 함께 지워짐)
  if not exists (select 1 from auth.users where id = lid) then return null; end if;
  insert into public.activity_log (user_id, actor, table_name, row_id, action, before, after)
  values (lid, auth.uid(), tg_table_name, coalesce(new.id, old.id), lower(tg_op), b, a);
  -- 가끔 90일 지난 기록 정리
  if random() < 0.02 then
    delete from public.activity_log where user_id = lid and created_at < now() - interval '90 days';
  end if;
  return null;
end $$;
revoke all on function public.log_activity() from public, anon, authenticated;

-- 2. 백업 복원: 내역·장보기 물품을 한 번에 넣음 (앱이 300건씩 나눠 호출).
--    호출한 사람 권한으로 실행(security invoker) → RLS 그대로, 가계부 ID는 항상 지금 내 가계부(공유 중이면 공유 가계부)로.
--    p_overwrite = false: 없는 것만 추가 (지금 내용은 그대로)
--    p_overwrite = true : 같은 ID가 있으면 백업 내용으로 되돌림 (이 수정은 변경 기록에 남아 되돌릴 수 있음)
--    다른 가계부에 같은 ID가 있으면 건너뜀(skipped). 다시 호출해도 결과가 같음(재전송에 안전)
create or replace function public.restore_backup(p_tx jsonb, p_items jsonb, p_overwrite boolean default false)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  lid uuid := public.current_ledger();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  tx_added int := 0; tx_updated int := 0; tx_skipped int := 0;
  it_added int := 0; it_updated int := 0; it_skipped int := 0;
begin
  if auth.uid() is null or lid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  p_tx := coalesce(p_tx, '[]'::jsonb); p_items := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(p_tx) <> 'array' or jsonb_typeof(p_items) <> 'array' then raise exception 'bad_payload' using errcode = '22023'; end if;
  if jsonb_array_length(p_tx) > 1000 or jsonb_array_length(p_items) > 1000 then raise exception 'too_many' using errcode = '22023'; end if;

  perform set_config('ledger.skip_log', 'restore', true);

  -- 내역
  create temp table if not exists _rb_tx (
    id text, type text, amount bigint, category text, memo text, date date, member_id text,
    tags jsonb, card_id text, inst_months smallint, created_at bigint
  ) on commit drop;
  truncate _rb_tx;
  insert into _rb_tx select distinct on (x.id) x.* from jsonb_to_recordset(p_tx) as x(
    id text, type text, amount bigint, category text, memo text, date date, member_id text,
    tags jsonb, card_id text, inst_months smallint, created_at bigint) where x.id is not null;

  with ins as (
    insert into transactions (id, user_id, type, amount, category, memo, date, member_id, tags, card_id, inst_months, created_at)
    select id, lid, type, amount, category, coalesce(memo, ''), date, member_id, coalesce(tags, '[]'::jsonb), card_id,
           coalesce(inst_months, 1), coalesce(created_at, now_ms)
      from _rb_tx
    on conflict (id) do nothing
    returning 1)
  select count(*) into tx_added from ins;

  if p_overwrite then
    with upd as (
      update transactions t set type = s.type, amount = s.amount, category = s.category, memo = coalesce(s.memo, ''),
             date = s.date, member_id = s.member_id, tags = coalesce(s.tags, '[]'::jsonb), card_id = s.card_id,
             inst_months = coalesce(s.inst_months, 1), created_at = coalesce(s.created_at, t.created_at)
        from _rb_tx s
       where t.id = s.id and t.user_id = lid
         and (t.type, t.amount, t.category, t.memo, t.date, t.member_id, t.tags, t.card_id, t.inst_months)
             is distinct from
             (s.type, s.amount, s.category, coalesce(s.memo, ''), s.date, s.member_id, coalesce(s.tags, '[]'::jsonb), s.card_id, coalesce(s.inst_months, 1))
      returning 1)
    select count(*) into tx_updated from upd;
  end if;
  select count(*) into tx_skipped from _rb_tx s
   where not exists (select 1 from transactions t where t.id = s.id and t.user_id = lid);

  -- 장보기 물품
  create temp table if not exists _rb_it (
    id text, name text, qty integer, price bigint, category text, member_id text, memo text,
    checked boolean, status text, paid bigint, tx_id text, bought_at date, created_at bigint
  ) on commit drop;
  truncate _rb_it;
  insert into _rb_it select distinct on (x.id) x.* from jsonb_to_recordset(p_items) as x(
    id text, name text, qty integer, price bigint, category text, member_id text, memo text,
    checked boolean, status text, paid bigint, tx_id text, bought_at date, created_at bigint) where x.id is not null;

  with ins as (
    insert into shopping_items (id, user_id, name, qty, price, category, member_id, memo, checked, status, paid, tx_id, bought_at, created_at)
    select id, lid, name, coalesce(qty, 1), coalesce(price, 0), category, member_id, coalesce(memo, ''), coalesce(checked, false),
           coalesce(status, 'todo'), paid, tx_id, bought_at, coalesce(created_at, now_ms)
      from _rb_it
    on conflict (id) do nothing
    returning 1)
  select count(*) into it_added from ins;

  if p_overwrite then
    with upd as (
      update shopping_items t set name = s.name, qty = coalesce(s.qty, 1), price = coalesce(s.price, 0), category = s.category,
             member_id = s.member_id, memo = coalesce(s.memo, ''), checked = coalesce(s.checked, false), status = coalesce(s.status, 'todo'),
             paid = s.paid, tx_id = s.tx_id, bought_at = s.bought_at, created_at = coalesce(s.created_at, t.created_at)
        from _rb_it s
       where t.id = s.id and t.user_id = lid
         and (t.name, t.qty, t.price, t.category, t.member_id, t.memo, t.checked, t.status, t.paid, t.tx_id, t.bought_at)
             is distinct from
             (s.name, coalesce(s.qty, 1), coalesce(s.price, 0), s.category, s.member_id, coalesce(s.memo, ''), coalesce(s.checked, false),
              coalesce(s.status, 'todo'), s.paid, s.tx_id, s.bought_at)
      returning 1)
    select count(*) into it_updated from upd;
  end if;
  select count(*) into it_skipped from _rb_it s
   where not exists (select 1 from shopping_items t where t.id = s.id and t.user_id = lid);

  perform set_config('ledger.skip_log', 'off', true);
  return jsonb_build_object(
    'tx_added', tx_added, 'tx_updated', tx_updated, 'tx_skipped', tx_skipped,
    'items_added', it_added, 'items_updated', it_updated, 'items_skipped', it_skipped);
end $$;
revoke all on function public.restore_backup(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.restore_backup(jsonb, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';

-- ===== 015: 반복 내역 최대 100개 (supabase/015_recurring_100.sql 과 같은 내용) =====
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
