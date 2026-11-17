-- 014: 전체 백업 복원 (내역·장보기를 한 번에, 변경 기록·알림 폭주 없이)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전, 013 이후)
-- 실행 전에도 백업 파일 받기는 돼요. 복원만 이 파일이 필요해요.

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
