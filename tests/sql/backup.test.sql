-- 014 백업 복원: 빠진 것만 추가 / 덮어쓰기, 변경 기록·다른 가계부, 재전송 안전, 권한
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated, anon; grant usage on sequence out_n_seq to authenticated, anon;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;

-- 지금 A 가계부: t1(그대로), t2(백업 뒤 금액 수정됨). 백업에는 t1·t2·t3(지워진 것) + 장보기 i1
insert into ledger_members(user_id, ledger_id) values (:'B', :'A');
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values
  ('t1', :'A', 'expense', 1000, '식비', '점심', '2026-10-01', 1),
  ('t2', :'A', 'expense', 9999, '식비', '저녁(수정됨)', '2026-10-02', 2),
  ('cx', :'C', 'expense', 7000, '식비', 'C것', '2026-10-01', 1);
delete from activity_log;
\set tx '[{"id":"t1","type":"expense","amount":1000,"category":"식비","memo":"점심","date":"2026-10-01","member_id":null,"tags":[],"card_id":null,"inst_months":1,"created_at":1},{"id":"t2","type":"expense","amount":2000,"category":"식비","memo":"저녁","date":"2026-10-02","member_id":null,"tags":["외식"],"card_id":null,"inst_months":1,"created_at":2},{"id":"t3","type":"income","amount":3000000,"category":"월급","memo":"","date":"2026-10-25","member_id":"m1","tags":[],"card_id":null,"inst_months":1,"created_at":3},{"id":"cx","type":"expense","amount":1,"category":"해킹","memo":"","date":"2026-10-01","created_at":4}]'
\set it '[{"id":"i1","name":"우유","qty":2,"price":2500,"category":"식비","member_id":null,"memo":"","checked":false,"status":"todo","paid":null,"tx_id":null,"bought_at":null,"created_at":5}]'

-- 공유 참여자 B가 "빠진 것만" 복원
select pg_temp.as_user(:'B');
select restore_backup(:'tx'::jsonb, :'it'::jsonb, false) as r1 \gset
reset role;
select pg_temp.chk('1. 빠진 것만: 내역 1건(t3)·장보기 1개 추가', (:'r1'::jsonb->>'tx_added')::int = 1 and (:'r1'::jsonb->>'items_added')::int = 1, :'r1');
select pg_temp.chk('2. 지운 내역이 공유 가계부(A)로 돌아옴, 칸 그대로',
  (select user_id::text || '/' || amount || '/' || member_id || '/' || created_at from transactions where id = 't3') = :'A' || '/3000000/m1/3');
select pg_temp.chk('3. 지금 바뀐 내용(t2)은 그대로', (select amount from transactions where id = 't2') = 9999);
select pg_temp.chk('4. 다른 가계부(C)의 같은 ID는 건드리지 않고 건너뜀',
  (select category from transactions where id = 'cx') = '식비' and (:'r1'::jsonb->>'tx_skipped')::int = 1);
select pg_temp.chk('5. 복원으로 추가한 줄은 변경 기록에 안 남음', (select count(*) from activity_log) = 0, (select count(*) from activity_log)::text);
select pg_temp.chk('6. 넣은 줄의 기기 ID는 비어 있음 (푸시 알림 안 보냄)', (select device_id is null from transactions where id = 't3'));

-- 덮어쓰기
select pg_temp.as_user(:'A');
select restore_backup(:'tx'::jsonb, '[]'::jsonb, true) as r2 \gset
reset role;
select pg_temp.chk('7. 덮어쓰기: 내용이 다른 t2만 되돌림 (1건)', (:'r2'::jsonb->>'tx_updated')::int = 1 and (:'r2'::jsonb->>'tx_added')::int = 0, :'r2');
select pg_temp.chk('8. t2 가 백업 때 값으로', (select amount || '/' || memo || '/' || tags::text from transactions where id = 't2') = '2000/저녁/["외식"]');
select pg_temp.chk('9. 덮어쓴 수정은 변경 기록에 남음 (되돌릴 수 있음)',
  (select count(*) from activity_log where row_id = 't2' and action = 'update' and (before->>'amount')::int = 9999) = 1);

-- 같은 요청 다시 (재전송)
select pg_temp.as_user(:'A');
select restore_backup(:'tx'::jsonb, :'it'::jsonb, true) as r3 \gset
reset role;
select pg_temp.chk('10. 다시 보내도 아무것도 안 바뀜',
  (:'r3'::jsonb->>'tx_added')::int + (:'r3'::jsonb->>'tx_updated')::int + (:'r3'::jsonb->>'items_added')::int + (:'r3'::jsonb->>'items_updated')::int = 0, :'r3');
select pg_temp.chk('11. 같은 트랜잭션에서 이어지는 일반 추가는 기록됨 (생략 표시가 꺼짐)', true);
select pg_temp.as_user(:'A');
begin;
select restore_backup('[]'::jsonb, '[]'::jsonb, false);
insert into transactions(id,user_id,type,amount,category,memo,date,created_at) values ('t9', :'A', 'expense', 5, '식비', '', '2026-10-03', 9);
commit;
reset role;
update out set ok = (select count(*) = 1 from activity_log where row_id = 't9' and action = 'insert') where name like '11.%';

-- 잘못된 값
select pg_temp.as_user(:'A');
do $$ begin
  begin perform restore_backup('[{"id":"bad","type":"expense","amount":0,"category":"식비","date":"2026-10-01"}]'::jsonb, '[]'::jsonb, false);
    perform pg_temp.chk('12. 금액 0 같은 잘못된 줄 → 거절 (아무것도 안 들어감)', false);
  exception when check_violation then perform pg_temp.chk('12. 금액 0 같은 잘못된 줄 → 거절 (아무것도 안 들어감)', not exists (select 1 from transactions where id = 'bad')); end;
  begin perform restore_backup('{"a":1}'::jsonb, '[]'::jsonb, false); perform pg_temp.chk('13. 배열이 아니면 거절, 1000건 넘으면 거절', false);
  exception when invalid_parameter_value then
    begin perform restore_backup((select jsonb_agg(jsonb_build_object('id','x'||g)) from generate_series(1,1001) g), '[]'::jsonb, false);
      perform pg_temp.chk('13. 배열이 아니면 거절, 1000건 넘으면 거절', false);
    exception when invalid_parameter_value then perform pg_temp.chk('13. 배열이 아니면 거절, 1000건 넘으면 거절', true); end;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false); set role anon;
do $$ begin begin perform restore_backup('[]'::jsonb, '[]'::jsonb, false); perform pg_temp.chk('14. 로그인 없이 호출 불가', false);
  exception when insufficient_privilege then perform pg_temp.chk('14. 로그인 없이 호출 불가', true); end; end $$;
reset role;

select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,120) from out order by n;
select count(*) filter (where ok) || '/' || count(*) from out;
