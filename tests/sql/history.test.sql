\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated, anon; grant usage on sequence out_n_seq to authenticated, anon;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;
-- B가 A 가계부에 참여
select pg_temp.as_user(:'A');
select (create_invite())->>'code' as code \gset
insert into transactions(id,user_id,type,amount,category,memo,date,created_at,device_id) values ('t1',:'A','expense',1000,'식비','점심',current_date,1,'dA');
reset role;
select pg_temp.as_user(:'B'); select join_ledger(:'code', null, '밥'); 
update transactions set amount = 1500, device_id='dB' where id = 't1';
update transactions set amount = 1500, device_id='dX' where id = 't1';   -- 내용 같음(기기만 다름) → 기록 안 함
delete from transactions where id = 't1';
select pg_temp.chk('1. 추가·수정·삭제가 순서대로 기록, 같은 내용 재저장은 생략',
  (select string_agg(action, ',' order by id) from activity_log) = 'insert,update,delete');
select pg_temp.chk('2. 누가: 추가=A, 수정·삭제=B',
  (select string_agg(actor::text, ',' order by id) from activity_log) = :'A'||','||:'B'||','||:'B');
select pg_temp.chk('3. 수정 전후 값 저장 (기기 ID·가계부 ID 제외)',
  (select (before->>'amount')||'>'||(after->>'amount') from activity_log where action='update') = '1000>1500'
  and (select before ? 'device_id' or before ? 'user_id' from activity_log where action='delete') = false);
select pg_temp.chk('4. 삭제 기록에 되살릴 전체 값', (select before->>'memo' from activity_log where action='delete') = '점심');
do $$ begin begin insert into activity_log(user_id, table_name, row_id, action) values ('00000000-0000-0000-0000-00000000000a','transactions','x','insert');
  perform pg_temp.chk('5. 앱에서 기록 직접 추가 불가', false); exception when insufficient_privilege then perform pg_temp.chk('5. 앱에서 기록 직접 추가 불가', true); end; end $$;
delete from activity_log;
select pg_temp.chk('6. 앱에서 기록 삭제 불가', (select count(*) from activity_log) = 3);
-- 댓글
insert into tx_comments(id, user_id, tx_id, author_name, body) values ('c1', :'A', 't1', '밥', '이거 뭐 산 거야?');
do $$ begin begin insert into tx_comments(id, user_id, tx_id, author, author_name, body) values ('c2', '00000000-0000-0000-0000-00000000000a', 't1', '00000000-0000-0000-0000-00000000000a', '사칭', 'x');
  perform pg_temp.chk('7. 다른 사람 이름(계정)으로 댓글 불가', false); exception when insufficient_privilege then perform pg_temp.chk('7. 다른 사람 이름(계정)으로 댓글 불가', true); end; end $$;
do $$ begin begin insert into tx_comments(id, user_id, tx_id, author_name, body) values ('c3', '00000000-0000-0000-0000-00000000000b', 't1', '밥', 'x');
  perform pg_temp.chk('8. 다른 가계부에 댓글 불가', false); exception when insufficient_privilege then perform pg_temp.chk('8. 다른 가계부에 댓글 불가', true); end; end $$;
do $$ begin begin insert into tx_comments(id, user_id, tx_id, author_name, body) values ('c4', '00000000-0000-0000-0000-00000000000a', 't1', '밥', '   ');
  perform pg_temp.chk('9. 빈 댓글 거절', false); exception when check_violation then perform pg_temp.chk('9. 빈 댓글 거절', true); end; end $$;
reset role;
select pg_temp.as_user(:'A');
select pg_temp.chk('10. 같은 가계부의 A는 댓글·기록을 봄', (select count(*) from tx_comments)=1 and (select count(*) from activity_log)=3);
delete from tx_comments where id='c1';
select pg_temp.chk('11. 남의 댓글은 못 지움', (select count(*) from tx_comments)=1);
reset role;
select pg_temp.as_user(:'C');
select pg_temp.chk('12. 다른 가계부 사람은 댓글·기록 안 보임', (select count(*) from tx_comments)=0 and (select count(*) from activity_log)=0);
reset role;
select pg_temp.as_user(:'B');
delete from tx_comments where id='c1';
select pg_temp.chk('13. 내 댓글은 지울 수 있음', (select count(*) from tx_comments)=0);
-- 장보기도 기록
insert into shopping_items(id,user_id,name,qty,price,category,member_id,memo,checked,status,created_at) values ('i1',:'A','우유',1,0,'식비',null,'',false,'todo',1);
select pg_temp.chk('14. 장보기 물품도 기록', (select count(*) from activity_log where table_name='shopping_items')=1);
reset role;
insert into settings(user_id) values (:'C') on conflict do nothing;
do $$ begin begin update settings set dismissed_subs = (select jsonb_agg(i) from generate_series(1,101) i);
  perform pg_temp.chk('15. 무시 목록 100개 제한', false); exception when check_violation then perform pg_temp.chk('15. 무시 목록 100개 제한', true); end; end $$;
-- service_role(웹훅 등)으로 바뀐 것도 기록, 누가=null
select set_config('request.jwt.claim.sub','',false); set role service_role; insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('t9',:'A','expense',1,'x','',current_date,1); reset role;
select pg_temp.chk('16. 서버 작업도 기록(누가 없음)', (select actor is null from activity_log where row_id='t9'));
select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,100) from out order by n;
select count(*) filter (where ok) || '/' || count(*) from out;
