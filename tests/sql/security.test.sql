-- 보안: RLS 켜짐, 로그인 없이(anon) 읽기·초대 코드·리포트 호출 차단, 다른 가계부 안 보임
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated, anon; grant usage on sequence out_n_seq to authenticated, anon;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;

select pg_temp.chk('1. public 테이블 모두 RLS 켜짐',
  not exists(select 1 from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity),
  (select string_agg(relname, ',') from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity));

select pg_temp.as_user(:'A');
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('a1',:'A','expense',1000,'식비','비밀',current_date,1);
insert into settings(user_id, budget) values (:'A', 100000);
insert into tx_comments(id,user_id,tx_id,author_name,body) values ('c1',:'A','a1','A','댓글');
reset role;

-- 로그인 없이
select set_config('request.jwt.claim.sub', '', false); set role anon;
do $$ declare n int; begin
  begin select count(*) into n from transactions; perform pg_temp.chk('2. 로그인 없이 내역 0건', n = 0, n::text);
  exception when insufficient_privilege then perform pg_temp.chk('2. 로그인 없이 내역 0건', true, 'permission denied'); end;
  begin select count(*) into n from settings; perform pg_temp.chk('3. 로그인 없이 설정 0건', n = 0, n::text);
  exception when insufficient_privilege then perform pg_temp.chk('3. 로그인 없이 설정 0건', true, 'permission denied'); end;
  begin select count(*) into n from tx_comments; perform pg_temp.chk('4. 로그인 없이 댓글 0건', n = 0, n::text);
  exception when insufficient_privilege then perform pg_temp.chk('4. 로그인 없이 댓글 0건', true, 'permission denied'); end;
  begin perform create_invite(); perform pg_temp.chk('5. 로그인 없이 초대 코드 만들기 차단', false);
  exception when others then perform pg_temp.chk('5. 로그인 없이 초대 코드 만들기 차단', true, sqlerrm); end;
  begin insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('x1','00000000-0000-0000-0000-00000000000a','expense',1,'x','',current_date,1);
    perform pg_temp.chk('6. 로그인 없이 쓰기 차단', false);
  exception when others then perform pg_temp.chk('6. 로그인 없이 쓰기 차단', true, sqlerrm); end;
end $$;
reset role;

-- 다른 계정
select pg_temp.as_user(:'B');
select pg_temp.chk('7. 다른 계정은 A의 내역·설정·댓글이 안 보임',
  (select count(*) from transactions)=0 and (select count(*) from settings where user_id=:'A')=0 and (select count(*) from tx_comments)=0);
update transactions set memo='해킹' where id='a1';
delete from transactions where id='a1';
reset role;
select pg_temp.chk('8. 다른 계정의 수정·삭제는 아무것도 바꾸지 못함', (select memo from transactions where id='a1')='비밀');
select pg_temp.as_user(:'B');
do $$ begin
  begin insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('b9','00000000-0000-0000-0000-00000000000a','expense',1,'x','',current_date,1);
    perform pg_temp.chk('9. 남의 가계부 ID로 쓰기 차단', false);
  exception when insufficient_privilege then perform pg_temp.chk('9. 남의 가계부 ID로 쓰기 차단', true); end;
end $$;
reset role;

select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,100) from out order by n;
select count(*) filter (where ok) || '/' || count(*) from out;
