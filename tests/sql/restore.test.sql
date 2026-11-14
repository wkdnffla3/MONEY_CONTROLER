\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated; grant usage on sequence out_n_seq to authenticated;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;
-- B가 A 가계부에 참여
select pg_temp.as_user(:'A');
select (create_invite())->>'code' as code \gset
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('t1',:'A','expense',8800,'식비','댓글테스트',current_date,1);
insert into tx_comments(id,user_id,tx_id,author_name,body) values ('c1',:'A','t1','민지','첫 번째 댓글');
reset role;
select pg_temp.as_user(:'B'); select join_ledger(:'code'); 
insert into tx_comments(id,user_id,tx_id,author_name,body) values ('c2',:'A','t1','준호','두 번째 댓글');
-- B가 내역 삭제
delete from transactions where id='t1';
select pg_temp.chk('1. 내역 삭제 후에도 댓글 2개 그대로 (A·B 작성분 모두)', (select count(*) from tx_comments where tx_id='t1')=2 and (select count(*) from transactions where id='t1')=0);
-- 변경 기록의 삭제 직전 값으로 되살리기 (앱이 하는 것과 같은 upsert)
select before as b from activity_log where row_id='t1' and action='delete' \gset
insert into transactions(id,user_id,type,amount,category,memo,date,created_at)
  select b->>'id', :'A', b->>'type', (b->>'amount')::bigint, b->>'category', b->>'memo', (b->>'date')::date, (b->>'created_at')::bigint
  from (select :'b'::jsonb as b) s
on conflict (id) do update set amount=excluded.amount, memo=excluded.memo;
select pg_temp.chk('2. 같은 ID로 되살아남 (금액·메모 그대로)', (select amount||memo from transactions where id='t1')='8800댓글테스트');
select pg_temp.chk('3. 되살린 내역에 댓글 2개가 시간 순서대로 다시 연결', (select string_agg(body, ' / ' order by created_at, id) from tx_comments where tx_id='t1')='첫 번째 댓글 / 두 번째 댓글');
select pg_temp.chk('4. 변경 기록에 삭제와 되살리기(다시 추가)가 모두 남음', (select string_agg(action, ',' order by id) from activity_log where row_id='t1')='insert,delete,insert');
reset role;
select pg_temp.as_user(:'A');
select pg_temp.chk('5. 만든 사람(A)도 되살린 내역과 댓글을 봄', (select count(*) from tx_comments where tx_id='t1')=2 and (select count(*) from transactions where id='t1')=1);
reset role;
select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,100) from out order by n;
select count(*) filter (where ok) || '/' || count(*) from out;
