-- 016 회원 탈퇴: 혼자 쓰는 계정 / 남의 가계부 참여자 / 참여자가 있는 가계부 주인(거절) / 로그인 없이(거절)
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated, anon; grant usage on sequence out_n_seq to authenticated, anon;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;

-- A 가계부에 B 참여. C·D 는 혼자
insert into ledger_members(user_id, ledger_id) values (:'B', :'A');
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values
  ('a1', :'A', 'expense', 1000, '식비', 'A가 씀', current_date, 1),
  ('b1', :'A', 'expense', 2000, '식비', 'B가 공유 가계부에 씀', current_date, 2),
  ('c1', :'C', 'expense', 3000, '식비', 'C 혼자', current_date, 3);
insert into settings(user_id, budget) values (:'C', 500000) on conflict (user_id) do update set budget = 500000;
insert into shopping_items(id,user_id,name,qty,price,category,status,created_at) values ('ci', :'C', '우유', 1, 0, '식비', 'todo', 1);
insert into tx_comments(id,user_id,tx_id,author,author_name,body) values ('cmA', :'A', 'b1', :'A', 'A', 'A댓글'), ('cmB', :'A', 'b1', :'B', 'B', 'B댓글');
insert into push_subscriptions(user_id, account_id, device_id, endpoint, p256dh, auth) values
  (:'A', :'B', 'devB', 'https://fcm.googleapis.com/fcm/send/b', 'p', 'a'),
  (:'C', :'C', 'devC', 'https://fcm.googleapis.com/fcm/send/c', 'p', 'a');

-- 1) 참여자가 있는 가계부의 주인 A → 거절, 아무것도 안 지워짐
select pg_temp.as_user(:'A');
do $$ begin
  begin perform delete_account(); perform pg_temp.chk('1. 참여자가 있는 가계부 주인은 탈퇴 거절', false);
  exception when others then perform pg_temp.chk('1. 참여자가 있는 가계부 주인은 탈퇴 거절', sqlerrm = 'ledger_has_members', sqlerrm); end;
end $$;
reset role;
select pg_temp.chk('2. 거절되면 아무것도 안 지워짐', exists (select 1 from auth.users where id = :'A') and (select count(*) from transactions where user_id = :'A') = 2);

-- 2) 참여자 B 탈퇴 → 공유 내역은 남고, 참여 정보·B 기기·B 댓글은 지워짐
select pg_temp.as_user(:'B');
select delete_account();
reset role;
select pg_temp.chk('3. 참여자 탈퇴: 계정·참여 정보 삭제', not exists (select 1 from auth.users where id = :'B') and not exists (select 1 from ledger_members where user_id = :'B'));
select pg_temp.chk('4. B가 공유 가계부에 입력한 내역은 남음', exists (select 1 from transactions where id = 'b1'));
select pg_temp.chk('5. B의 기기 알림·댓글은 지워지고 A 댓글은 남음',
  not exists (select 1 from push_subscriptions where device_id = 'devB') and (select string_agg(id, ',') from tx_comments) = 'cmA');

-- 3) 이제 참여자가 없으니 A 도 탈퇴 가능
select pg_temp.as_user(:'A');
select delete_account();
reset role;
select pg_temp.chk('6. 참여자를 내보낸 뒤(여기선 B 탈퇴) 주인도 탈퇴 → 그 가계부 전체 삭제',
  not exists (select 1 from auth.users where id = :'A') and (select count(*) from transactions where user_id = :'A') = 0 and (select count(*) from tx_comments) = 0);

-- 4) 혼자 쓰는 C → 모든 데이터 삭제, 다른 계정(D)은 그대로
select pg_temp.as_user(:'C');
select delete_account();
reset role;
select pg_temp.chk('7. 혼자 쓰는 계정: 내역·설정·장보기·기기 알림 모두 삭제',
  (select count(*) from transactions where user_id = :'C') = 0 and not exists (select 1 from settings where user_id = :'C')
  and not exists (select 1 from shopping_items where user_id = :'C') and not exists (select 1 from push_subscriptions where device_id = 'devC'));
select pg_temp.chk('8. 다른 계정은 그대로', exists (select 1 from auth.users where id = :'D'));

-- 5) 로그인 없이
select set_config('request.jwt.claim.sub', '', false); set role anon;
do $$ begin begin perform delete_account(); perform pg_temp.chk('9. 로그인 없이 호출 불가', false);
  exception when insufficient_privilege then perform pg_temp.chk('9. 로그인 없이 호출 불가', true); end; end $$;
reset role;

select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,120) from out order by n;
