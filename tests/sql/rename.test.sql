-- 013 카테고리 이름 일괄 변경: 한 번에 바뀌고, 변경 기록은 남기지 않고, 한 건 수정 기록은 그대로
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated, anon; grant usage on sequence out_n_seq to authenticated, anon;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;

-- A 가계부: 식비 지출 300건 + 식비 수입 1건, B는 A 가계부에 참여, C는 따로
insert into ledger_members(user_id, ledger_id) values (:'B', :'A');
insert into transactions(id,user_id,type,amount,category,memo,date,created_at)
  select 'a'||g, :'A', 'expense', 1000+g, '식비', '메모'||g, current_date, g from generate_series(1,300) g;
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values
  ('ai', :'A', 'income', 5000, '식비', '수입', current_date, 1),
  ('c1', :'C', 'expense', 7000, '식비', 'C것', current_date, 1);
delete from activity_log;

-- 공유 참여자 B가 이름 변경
select pg_temp.as_user(:'B');
select rename_category('expense', '식비', '밥값') as n \gset
reset role;
select pg_temp.chk('1. 300건이 한 번에 바뀜 (돌려준 건수 300)', :n = 300
  and (select count(*) from transactions where user_id = :'A' and type = 'expense' and category = '밥값') = 300, :n::text);
select pg_temp.chk('2. 메모·금액 등 다른 칸은 그대로', (select memo || '/' || amount from transactions where id = 'a7') = '메모7/1007');
select pg_temp.chk('3. 수입 식비·다른 가계부(C)는 그대로',
  (select category from transactions where id = 'ai') = '식비' and (select category from transactions where id = 'c1') = '식비');
select pg_temp.chk('4. 변경 기록에 아무것도 안 남음', (select count(*) from activity_log) = 0, (select count(*) from activity_log)::text);

-- 같은 요청 재전송, 같은 트랜잭션 안에서 이어지는 한 건 수정
select pg_temp.as_user(:'B');
begin;
select rename_category('expense', '식비', '밥값') as n2 \gset
update transactions set category = '교통' where id = 'a1';
commit;
reset role;
select pg_temp.chk('5. 다시 보내도 안전 (0건)', :n2 = 0);
select pg_temp.chk('6. 이름 변경 직후의 한 건 카테고리 수정은 기록됨',
  (select count(*) from activity_log where row_id = 'a1' and action = 'update' and after->>'category' = '교통') = 1);

-- 표시를 직접 켜도 카테고리 외의 수정은 숨길 수 없음
select pg_temp.as_user(:'A');
begin;
select set_config('ledger.skip_log', 'on', true);
update transactions set amount = 1, category = '쇼핑' where id = 'a2';
commit;
reset role;
select pg_temp.chk('7. 기록 생략은 카테고리만 바뀐 경우뿐 (금액 수정은 기록)',
  (select count(*) from activity_log where row_id = 'a2') = 1);

-- 다른 가계부 C는 A 가계부 이름을 못 바꿈
select pg_temp.as_user(:'C');
select rename_category('expense', '밥값', '해킹') as n3 \gset
reset role;
select pg_temp.chk('8. 다른 가계부 사람이 호출하면 자기 가계부만 (A 내역 0건 변경)',
  :n3 = 0 and (select count(*) from transactions where category = '해킹') = 0);

-- 잘못된 값·로그인 없이
select pg_temp.as_user(:'A');
do $$ begin
  begin perform rename_category('transfer', '밥값', 'x'); perform pg_temp.chk('9. 잘못된 종류 거절', false);
  exception when invalid_parameter_value then perform pg_temp.chk('9. 잘못된 종류 거절', true); end;
  begin perform rename_category('expense', '밥값', '밥값'); perform pg_temp.chk('10. 같은 이름·빈 이름·21자 거절', false);
  exception when invalid_parameter_value then
    begin perform rename_category('expense', '밥값', ''); perform pg_temp.chk('10. 같은 이름·빈 이름·21자 거절', false);
    exception when invalid_parameter_value then
      begin perform rename_category('expense', '밥값', repeat('가', 21)); perform pg_temp.chk('10. 같은 이름·빈 이름·21자 거절', false);
      exception when invalid_parameter_value then perform pg_temp.chk('10. 같은 이름·빈 이름·21자 거절', true); end;
    end;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false); set role anon;
do $$ begin begin perform rename_category('expense', '밥값', 'x'); perform pg_temp.chk('11. 로그인 없이 호출 불가', false);
  exception when insufficient_privilege then perform pg_temp.chk('11. 로그인 없이 호출 불가', true); end; end $$;
reset role;

select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,100) from out order by n;
select count(*) filter (where ok) || '/' || count(*) from out;
