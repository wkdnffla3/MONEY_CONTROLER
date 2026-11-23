-- 017 버전 확인: 내역·물품 version, 설정 칸별 ver, save_setting, 변경 기록·이름 변경·복원과 함께
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated, anon; grant usage on sequence out_n_seq to authenticated, anon;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;

insert into ledger_members(user_id, ledger_id) values (:'B', :'A');

-- 내역
select pg_temp.as_user(:'A');
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('t1', :'A', 'expense', 1000, '식비', '점심', current_date, 1);
reset role;
select pg_temp.chk('1. 새 내역은 version 1', (select version from transactions where id = 't1') = 1);

select pg_temp.as_user(:'B');
update transactions set amount = 2000 where id = 't1' and version = 1;
reset role;
select pg_temp.chk('2. 본 버전이 맞으면 수정되고 version 2', (select amount || '/' || version from transactions where id = 't1') = '2000/2');

select pg_temp.as_user(:'A');
with u as (update transactions set amount = 3000 where id = 't1' and version = 1 returning 1) select count(*) as n from u \gset
reset role;
select pg_temp.chk('3. 옛 버전(1)으로 고치면 0줄 (덮어쓰지 않음)', :n = 0 and (select amount from transactions where id = 't1') = 2000);

select pg_temp.as_user(:'A');
update transactions set amount = 2000, memo = '점심' where id = 't1';
update transactions set version = 99 where id = 't1';
reset role;
select pg_temp.chk('4. 같은 내용 다시 저장·version 직접 변경은 버전 그대로', (select version from transactions where id = 't1') = 2);

select pg_temp.as_user(:'A');
update transactions set memo = '저녁', version = 99 where id = 't1';
reset role;
select pg_temp.chk('5. 내용이 바뀌면 앱이 보낸 version 과 상관없이 +1', (select version from transactions where id = 't1') = 3);

-- upsert(예전 앱) 도 버전이 올라감
select pg_temp.as_user(:'A');
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('t1', :'A', 'expense', 4000, '식비', '저녁', current_date, 1)
  on conflict (id) do update set amount = excluded.amount;
reset role;
select pg_temp.chk('6. 예전 방식 저장(upsert)도 버전 +1', (select amount || '/' || version from transactions where id = 't1') = '4000/4');

select pg_temp.as_user(:'A');
with d as (delete from transactions where id = 't1' and version = 3 returning 1) select count(*) as n from d \gset
reset role;
select pg_temp.chk('7. 옛 버전으로 지우면 안 지워짐', :n = 0 and exists (select 1 from transactions where id = 't1'));

-- 이름 변경은 버전 그대로
select pg_temp.as_user(:'B');
select rename_category('expense', '식비', '밥값');
reset role;
select pg_temp.chk('8. 카테고리 이름 일괄 변경은 버전 그대로', (select category || '/' || version from transactions where id = 't1') = '밥값/4');

-- 변경 기록
select pg_temp.chk('9. 변경 기록에 version 이 안 남음',
  not exists (select 1 from activity_log where before ? 'version' or after ? 'version'));

-- 장보기 물품
select pg_temp.as_user(:'A');
insert into shopping_items(id,user_id,name,category,created_at) values ('i1', :'A', '우유', '식비', 1);
update shopping_items set checked = true where id = 'i1' and version = 1;
reset role;
select pg_temp.chk('10. 물품도 version (1 → 2)', (select version from shopping_items where id = 'i1') = 2);

-- 설정
select pg_temp.as_user(:'A');
select save_setting('budget', '500000'::jsonb, 0) as v1 \gset
select save_setting('cards', '[{"id":"k1","name":"삼성","payDay":14,"closeDay":31,"color":2}]'::jsonb, 0) as v2 \gset
reset role;
select pg_temp.chk('11. 설정 저장: 칸마다 버전 (예산 1, 카드 1)', :v1 = 1 and :v2 = 1
  and (select budget from settings where user_id = :'A') = 500000
  and (select ver from settings where user_id = :'A') = '{"budget": 1, "cards": 1}'::jsonb,
  (select ver::text from settings where user_id = :'A'));

select pg_temp.as_user(:'B');
select save_setting('budget', '700000'::jsonb, 1) as v3 \gset
reset role;
select pg_temp.chk('12. 공유 참여자도 같은 가계부 설정 저장 (예산 버전 2, 카드 그대로 1)', :v3 = 2
  and (select (ver->>'cards')::int from settings where user_id = :'A') = 1);

select pg_temp.as_user(:'A');
do $$ begin
  begin perform save_setting('budget', '900000'::jsonb, 1); perform pg_temp.chk('13. 옛 버전으로 저장하면 version_conflict (LV409)', false);
  exception when sqlstate 'LV409' then perform pg_temp.chk('13. 옛 버전으로 저장하면 version_conflict (LV409)', true, sqlerrm); end;
end $$;
reset role;
select pg_temp.chk('14. 충돌 시 값은 그대로', (select budget from settings where user_id = :'A') = 700000);

select pg_temp.as_user(:'A');
select save_setting('budget', '700000'::jsonb, 2) as v4 \gset
select save_setting('favorites', '[]'::jsonb, null) as v5 \gset
update settings set ver = '{"budget": 0}'::jsonb where user_id = :'A';
reset role;
select pg_temp.chk('15. 같은 값 다시 저장은 버전 그대로, base 없이 저장 가능, ver 직접 변경 불가',
  :v4 = 2 and :v5 = 0 and (select (ver->>'budget')::int from settings where user_id = :'A') = 2);

select pg_temp.as_user(:'A');
do $$ begin
  begin perform save_setting('ver', '{}'::jsonb, null); perform pg_temp.chk('16. 없는 칸 거절', false);
  exception when invalid_parameter_value then perform pg_temp.chk('16. 없는 칸 거절', true); end;
end $$;
select save_setting('categories', 'null'::jsonb, null) as v6 \gset
reset role;
select pg_temp.chk('17. 카테고리 null(기본값으로)도 저장', (select categories from settings where user_id = :'A') is null);

-- 다른 가계부 C 는 자기 가계부에만
select pg_temp.as_user(:'C');
select save_setting('budget', '1'::jsonb, null) as v7 \gset
reset role;
select pg_temp.chk('18. 다른 사람이 호출하면 자기 가계부에만 (A 예산 그대로)',
  (select budget from settings where user_id = :'A') = 700000 and (select budget from settings where user_id = :'C') = 1);

-- 제약(검사)은 그대로
select pg_temp.as_user(:'A');
do $$ begin
  begin perform save_setting('budget', '-5'::jsonb, null); perform pg_temp.chk('19. 기존 검사 제약 그대로 (음수 예산 거절)', false);
  exception when check_violation then perform pg_temp.chk('19. 기존 검사 제약 그대로 (음수 예산 거절)', true); end;
end $$;
reset role;

-- 로그인 없이
select set_config('request.jwt.claim.sub', '', false); set role anon;
do $$ begin begin perform save_setting('budget', '1'::jsonb, null); perform pg_temp.chk('20. 로그인 없이 호출 불가', false);
  exception when insufficient_privilege then perform pg_temp.chk('20. 로그인 없이 호출 불가', true); end; end $$;
reset role;

-- 복원도 그대로 동작
select pg_temp.as_user(:'A');
select restore_backup('[{"id":"r1","type":"expense","amount":5,"category":"식비","memo":"","date":"2026-11-01"}]'::jsonb, '[]'::jsonb, false) as rb \gset
reset role;
select pg_temp.chk('21. 백업 복원으로 넣은 내역도 version 1', (select version from transactions where id = 'r1') = 1);

select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,100) from out order by n;
select count(*) filter (where ok) || '/' || count(*) from out;
