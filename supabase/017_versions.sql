-- 017: 여러 기기·여러 사람이 같은 것을 거의 동시에 고칠 때 덮어쓰기 방지 (버전 확인)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전, 016 이후)
-- 실행 전에도 앱은 지금처럼 동작해요 (나중에 저장한 쪽이 남음). 실행하면 그때부터 충돌을 알려줘요.
--
-- 원리
--  - 내역·장보기 물품: 줄마다 version (서버가 고칠 때마다 +1, 앱이 직접 못 바꿈)
--  - 설정(예산·카테고리·카드·즐겨찾기 등): 칸마다 버전을 ver 에 {"budget": 3, "cards": 1, ...} 로
--  - 앱은 "내가 본 버전"을 함께 보내고, 그사이 다른 기기가 고쳤으면 저장하지 않고 알려줌
--    (내역·물품은 앱이 version 조건을 붙여 UPDATE/DELETE, 설정은 아래 save_setting 함수)

-- 1. 버전 칸
alter table public.transactions   add column if not exists version bigint not null default 1;
alter table public.shopping_items add column if not exists version bigint not null default 1;
alter table public.settings       add column if not exists ver jsonb not null default '{}'::jsonb;
alter table public.settings drop constraint if exists settings_ver_valid;
alter table public.settings add  constraint settings_ver_valid
  check (jsonb_typeof(ver) = 'object' and pg_column_size(ver) <= 1024);

-- 2. 내역·물품 버전 올리기 (내용이 바뀔 때만)
--    - 같은 내용 다시 저장(재전송)은 그대로
--    - 카테고리 이름 일괄 변경(rename_category 안)으로 카테고리만 바뀐 줄도 그대로
--      → 이름 변경과 같이 보낸, 아직 못 올린 수정이 "다른 기기가 고침"으로 잘못 걸리지 않게
create or replace function public.bump_version() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.version := 1; return new; end if;
  if (to_jsonb(new) - 'version' - 'device_id') = (to_jsonb(old) - 'version' - 'device_id') then
    new.version := old.version; return new;
  end if;
  if tg_table_name = 'transactions' and current_setting('ledger.skip_log', true) = 'on'
     and (to_jsonb(new) - 'version' - 'device_id' - 'category') = (to_jsonb(old) - 'version' - 'device_id' - 'category') then
    new.version := old.version; return new;
  end if;
  new.version := old.version + 1;
  return new;
end $$;
revoke all on function public.bump_version() from public, anon, authenticated;
drop trigger if exists version_transactions on public.transactions;
create trigger version_transactions before insert or update on public.transactions
  for each row execute function public.bump_version();
drop trigger if exists version_shopping_items on public.shopping_items;
create trigger version_shopping_items before insert or update on public.shopping_items
  for each row execute function public.bump_version();

-- 3. 설정 칸별 버전 올리기 (바뀐 칸만, ver 는 앱이 직접 못 바꿈)
create or replace function public.bump_settings_ver() returns trigger
language plpgsql set search_path = public as $$
declare
  c text;
  v jsonb := case when tg_op = 'UPDATE' then coalesce(old.ver, '{}'::jsonb) else '{}'::jsonb end;
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  n jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' then
    foreach c in array array['budget', 'members', 'recurring', 'categories', 'cat_budgets', 'cards', 'favorites', 'dismissed_subs'] loop
      if (n -> c) is distinct from (o -> c) then
        v := jsonb_set(v, array[c], to_jsonb(coalesce((v ->> c)::bigint, 0) + 1));
      end if;
    end loop;
  end if;
  new.ver := v;
  return new;
end $$;
revoke all on function public.bump_settings_ver() from public, anon, authenticated;
drop trigger if exists version_settings on public.settings;
create trigger version_settings before insert or update on public.settings
  for each row execute function public.bump_settings_ver();

-- 4. 설정 한 칸 저장 (버전 확인). p_base = 앱이 본 버전 (null 이면 확인 없이 저장)
--    다른 기기가 먼저 고쳤으면 오류 version_conflict (코드 LV409). 성공하면 새 버전을 돌려줌.
--    호출한 사람 권한(security invoker) → RLS 그대로, 지금 내 가계부(공유 중이면 공유 가계부)만
create or replace function public.save_setting(p_col text, p_value jsonb, p_base bigint default null) returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  lid uuid := public.current_ledger();
  cur bigint;
begin
  if auth.uid() is null or lid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_col is null or p_col not in ('budget', 'members', 'recurring', 'categories', 'cat_budgets', 'cards', 'favorites', 'dismissed_subs') then
    raise exception 'bad_column' using errcode = '22023';
  end if;
  insert into public.settings (user_id) values (lid) on conflict (user_id) do nothing;
  select coalesce((ver ->> p_col)::bigint, 0) into cur from public.settings where user_id = lid for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_base is not null and cur <> p_base then
    raise exception 'version_conflict' using errcode = 'LV409', detail = cur::text;
  end if;
  execute format(
    'update public.settings set %1$I = (jsonb_populate_record(null::public.settings, jsonb_build_object(%1$L, $1))).%1$I where user_id = $2',
    p_col) using p_value, lid;
  select coalesce((ver ->> p_col)::bigint, 0) into cur from public.settings where user_id = lid;
  return cur;
end $$;
revoke all on function public.save_setting(text, jsonb, bigint) from public, anon;
grant execute on function public.save_setting(text, jsonb, bigint) to authenticated;

-- 5. 변경 기록: 버전 숫자는 기록하지 않음 (014 와 같고 'version' 만 뺌)
create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'device_id' - 'user_id' - 'version' else null end;
  a jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'device_id' - 'user_id' - 'version' else null end;
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

notify pgrst, 'reload schema';
