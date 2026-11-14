\set ON_ERROR_STOP 1
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated, anon; grant usage on sequence out_n_seq to authenticated, anon;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;

-- 각자 데이터 입력
select pg_temp.as_user(:'A');
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('a1',:'A','expense',1000,'식비','',current_date,1);
insert into settings(user_id, members) values (:'A', '[{"id":"m1","name":"아빠","color":0},{"id":"m2","name":"엄마","color":1}]');
reset role;
select pg_temp.as_user(:'B');
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('b1',:'B','expense',2000,'식비','',current_date,1);
select pg_temp.chk('1. 참여 전: B는 자기 내역만', (select count(*) from transactions)=1 and (select id from transactions)='b1');
reset role;

-- A가 초대 코드 생성
select pg_temp.as_user(:'A');
select (create_invite())->>'code' as code \gset
select pg_temp.chk('2. 초대 코드 10자리, 헷갈리는 글자 없음', :'code' ~ '^[A-HJ-NP-Z2-9]{10}$', :'code');
reset role;

-- B가 확인 → 참여 (기존 "엄마"로)
select pg_temp.as_user(:'B');
select peek_invite(lower(:'code')) as peek \gset
select pg_temp.chk('3. 코드 확인: 사람 목록·가려진 이메일·인원', (:'peek'::jsonb->>'owner')='ow***@gmail.com' and jsonb_array_length(:'peek'::jsonb->'members')=2 and (:'peek'::jsonb->>'count')='1', :'peek');
select join_ledger(:'code', 'm2', null) as j \gset
select pg_temp.chk('4. 참여 → 공유 가계부(A)로 전환, 엄마로 연결', (:'j'::jsonb->>'ledger_id')=:'A' and (:'j'::jsonb->>'person_id')='m2', :'j');
select pg_temp.chk('5. B는 이제 A의 내역만 보임 (자기 내역 b1은 안 보임)', (select string_agg(id,',') from transactions)='a1');
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('b2',:'A','expense',3000,'식비','',current_date,1);
update transactions set memo='수정' where id='a1';
select pg_temp.chk('6. B가 공유 가계부에 입력·수정 가능', (select count(*) from transactions)=2 and (select memo from transactions where id='a1')='수정');
do $$ begin
  begin insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('b3','00000000-0000-0000-0000-00000000000b','expense',1,'x','',current_date,1);
    perform pg_temp.chk('7. 참여 중 내 원래 가계부에 쓰기 차단', false);
  exception when insufficient_privilege then perform pg_temp.chk('7. 참여 중 내 원래 가계부에 쓰기 차단', true); end;
end $$;
insert into settings(user_id, budget) values (:'A', 500000) on conflict (user_id) do update set budget = excluded.budget;
select pg_temp.chk('8. B가 공유 설정(예산) 저장 가능', (select budget from settings)=500000);
select my_ledger() as ml \gset
select pg_temp.chk('9. my_ledger: 주인 아님, 참여자 2명(주인 먼저), 내 사람=엄마',
  (:'ml'::jsonb->>'is_owner')='false' and jsonb_array_length(:'ml'::jsonb->'people')=2 and (:'ml'::jsonb->'people'->0->>'owner')='true' and (:'ml'::jsonb->>'person_id')='m2', :'ml');
reset role;

-- 같은 코드 재사용 / C가 B 코드 쓰기
select set_config('my.code', :'code', false);
select pg_temp.as_user(:'C');
do $$ begin begin perform join_ledger(current_setting('my.code'), null, 'x'); exception when others then perform pg_temp.chk('10. 사용한 코드는 다시 못 씀', sqlerrm='used', sqlerrm); return; end; perform pg_temp.chk('10. 사용한 코드는 다시 못 씀', false); end $$;
reset role;
-- B(참여자)가 C를 초대 → C 참여(새 이름)
select pg_temp.as_user(:'B');
select (create_invite())->>'code' as code2 \gset
reset role;
select pg_temp.as_user(:'C');
select join_ledger(:'code2', null, '할머니') as j2 \gset
select pg_temp.chk('11. 참여자가 만든 초대로도 같은 가계부에 참여, 새 사람 추가', (:'j2'::jsonb->>'ledger_id')=:'A'
  and (select members from settings) @> '[{"name":"할머니"}]'::jsonb and jsonb_array_length((select members from settings))=3, :'j2');
reset role;

-- 동등 권한: C가 B 내보내기
select pg_temp.as_user(:'C');
select remove_member(:'B'::uuid);
do $$ begin begin perform remove_member('00000000-0000-0000-0000-00000000000a'); exception when others then perform pg_temp.chk('12. 만든 사람은 내보낼 수 없음', sqlerrm='not_member', sqlerrm); return; end; perform pg_temp.chk('12. 만든 사람은 내보낼 수 없음', false); end $$;
reset role;
select pg_temp.as_user(:'B');
select pg_temp.chk('13. 내보내진 B는 다시 자기 원래 내역만 (b1 보존)', (select string_agg(id,',') from transactions)='b1');
reset role;

-- 공유 중인 주인은 다른 가계부에 참여 불가 / 참여 중엔 다른 곳 참여 불가
select pg_temp.as_user(:'D');
select (create_invite())->>'code' as code3 \gset
select (create_invite())->>'code' as code4 \gset
reset role;
select set_config('my.c3', :'code3', false);
select pg_temp.as_user(:'A');
do $$ begin begin perform join_ledger(current_setting('my.c3')); exception when others then perform pg_temp.chk('14. 다른 사람이 참여 중인 가계부 주인은 다른 곳에 참여 불가', sqlerrm='has_members', sqlerrm); return; end; perform pg_temp.chk('14', false); end $$;
reset role;
select pg_temp.as_user(:'C');
do $$ begin begin perform join_ledger(current_setting('my.c3')); exception when others then perform pg_temp.chk('15. 이미 참여 중이면 다른 가계부 참여 불가', sqlerrm='already_joined', sqlerrm); return; end; perform pg_temp.chk('15', false); end $$;
-- C 나가기
select leave_ledger();
select pg_temp.chk('16. 나가기 → 내 가계부(빈 것)로', (select count(*) from transactions)=0 and (my_ledger()->>'is_owner')='true');
reset role;
select set_config('my.c4', :'code4', false);
select pg_temp.as_user(:'D');
do $$ begin begin perform join_ledger(current_setting('my.c4')); exception when others then perform pg_temp.chk('17. 내가 만든 코드로는 참여 불가', sqlerrm='own_ledger', sqlerrm); return; end; perform pg_temp.chk('17', false); end $$;
reset role;
-- 만료
update ledger_invites set expires_at = now() - interval '1 minute' where code = :'code4';
select pg_temp.as_user(:'C');
do $$ begin begin perform peek_invite(current_setting('my.c4')); exception when others then perform pg_temp.chk('18. 만료된 코드 거절', sqlerrm='expired', sqlerrm); return; end; perform pg_temp.chk('18', false); end $$;
do $$ begin begin perform peek_invite('ZZZZZZZZZZ'); exception when others then perform pg_temp.chk('19. 없는 코드 거절', sqlerrm='invalid_code', sqlerrm); return; end; perform pg_temp.chk('19', false); end $$;
-- 직접 테이블 접근 차단
select pg_temp.chk('20. 참여자·초대 테이블은 직접 못 읽음', (select count(*) from ledger_members)=0 and (select count(*) from ledger_invites)=0);
do $$ begin begin insert into ledger_members(user_id, ledger_id) values ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a');
  perform pg_temp.chk('21. 초대 없이 직접 참여 행 넣기 차단', false); exception when insufficient_privilege then perform pg_temp.chk('21. 초대 없이 직접 참여 행 넣기 차단', true); end; end $$;
reset role;
-- 익명은 함수 호출 불가
set role anon;
do $$ begin begin perform create_invite(); exception when insufficient_privilege then perform pg_temp.chk('22. 로그인 안 한 요청은 함수 호출 불가', true); return; end; perform pg_temp.chk('22', false); end $$;
reset role;

-- 푸시 구독: 기기 주인만 관리, 참여·나가기에 따라 가계부 이동
select pg_temp.as_user(:'C');
insert into push_subscriptions(device_id, endpoint, p256dh, auth, user_id) values ('dc','https://push/c','p','a',:'C');
reset role;
select pg_temp.as_user(:'A');
select (create_invite())->>'code' as code5 \gset
insert into push_subscriptions(device_id, endpoint, p256dh, auth, user_id) values ('da','https://push/a','p','a',:'A');
reset role;
select pg_temp.as_user(:'C');
select join_ledger(:'code5') ;
select pg_temp.chk('23. 참여하면 내 기기 푸시가 공유 가계부로 옮겨짐', (select user_id::text from push_subscriptions)=:'A' and (select count(*) from push_subscriptions)=1);
do $$ begin begin insert into push_subscriptions(device_id, endpoint, p256dh, auth, user_id) values ('x','https://push/x','p','a','00000000-0000-0000-0000-00000000000c');
  perform pg_temp.chk('24. 다른 가계부로 구독 등록 차단', false); exception when insufficient_privilege then perform pg_temp.chk('24. 다른 가계부로 구독 등록 차단', true); end; end $$;
select pg_temp.chk('25. 같은 가계부라도 다른 계정 기기 구독은 안 보임', (select count(*) from push_subscriptions where device_id='da')=0);
select leave_ledger();
select pg_temp.chk('26. 나가면 푸시도 내 가계부로 돌아옴', (select user_id::text from push_subscriptions)=:'C');
reset role;
-- 주인 계정 삭제 → 참여자 자동 해제
select pg_temp.as_user(:'A');
select (create_invite())->>'code' as code6 \gset
reset role;
select pg_temp.as_user(:'C'); select join_ledger(:'code6'); reset role;
delete from auth.users where id = :'A';
select pg_temp.as_user(:'C');
select pg_temp.chk('27. 주인 계정이 삭제되면 참여자는 자기 가계부로', (my_ledger()->>'is_owner')='true');
reset role;
-- 즐겨찾기 칸 제약
insert into settings(user_id) values ('00000000-0000-0000-0000-00000000000d') on conflict do nothing;
do $$ begin begin update settings set favorites = (select jsonb_agg(i) from generate_series(1,21) i);
  perform pg_temp.chk('28. 즐겨찾기 20개 초과 거절', false); exception when check_violation then perform pg_temp.chk('28. 즐겨찾기 20개 초과 거절', true); end; end $$;
select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail, 140) from out order by n;
select count(*) filter (where ok) || '/' || count(*) as result from out;
