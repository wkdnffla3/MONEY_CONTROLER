\set A '00000000-0000-0000-0000-00000000000a'
create temp table out(n serial, name text, ok bool, detail text);
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;
-- 011 적용 결과
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('m200',:'A','expense',1,'식비',repeat('가',200),current_date,1);
select pg_temp.chk('1. 내역 메모 200자 저장', exists(select 1 from transactions where id='m200'));
do $$ begin begin insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('m201','00000000-0000-0000-0000-00000000000a','expense',1,'식비',repeat('가',201),current_date,1);
  perform pg_temp.chk('2. 201자는 거절', false); exception when check_violation then perform pg_temp.chk('2. 201자는 거절', true); end; end $$;
insert into shopping_items(id,user_id,name,qty,price,category,member_id,memo,checked,status,created_at) values ('s200',:'A','우유',1,0,'식비',null,repeat('a',200),false,'todo',1);
select pg_temp.chk('3. 장보기 메모 200자 저장', exists(select 1 from shopping_items where id='s200'));
select pg_temp.chk('4. 메모 제약이 테이블마다 정확히 1개', (select count(*) from pg_constraint where conrelid='public.transactions'::regclass and pg_get_constraintdef(oid) like '%char_length(memo)%')=1
  and (select count(*) from pg_constraint where conrelid='public.shopping_items'::regclass and pg_get_constraintdef(oid) like '%char_length(memo)%')=1);
-- 즐겨찾기 20개 × 200자 한글 메모
insert into settings(user_id) values (:'A') on conflict do nothing;
update settings set favorites = (select jsonb_agg(jsonb_build_object('id','f'||i,'label','라벨'||i,'type','expense','amount',1000,'category','식비','memo',repeat('가나다라마바사아자차카타파하',15))) from generate_series(1,20) i) where user_id=:'A';
select pg_temp.chk('5. 즐겨찾기 20개에 200자 메모 저장', (select jsonb_array_length(favorites) from settings where user_id=:'A')=20);
update settings set recurring = (select jsonb_agg(jsonb_build_object('id','r'||i,'type','expense','amount',1000,'category','식비','memo',md5(i::text)||repeat('가나다라마바사아자차카타파하',12),'memberId',null,'day',1,'start','2026-01','end',null,'last',null,'active',true)) from generate_series(1,50) i) where user_id=:'A';
select pg_temp.chk('6. 반복 내역 50개에 200자 메모 저장', (select jsonb_array_length(recurring) from settings where user_id=:'A')=50);
select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,100) from out order by n;
select count(*) filter (where ok) || '/' || count(*) from out;
