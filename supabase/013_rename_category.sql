-- 013: 카테고리 이름 변경을 빠르게 (변경 기록에 내역마다 남기지 않음)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전, 010 이후)
-- 실행 전에도 앱은 동작해요. 이름 변경이 예전 방식(내역마다 기록)으로 처리되고, 상단에 업데이트 안내가 떠요.

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
