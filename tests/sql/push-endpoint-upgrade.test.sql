-- 이미 쓰던 DB에 012 를 실행: 엉뚱한 주소만 지우고 정상 기기는 그대로, 두 번 실행해도 안전
\set A '00000000-0000-0000-0000-00000000000a'
create temp table out(n serial, name text, ok bool, detail text);
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;
insert into push_subscriptions(user_id, account_id, device_id, endpoint, p256dh, auth) values
  (:'A', :'A', 'good1', 'https://fcm.googleapis.com/fcm/send/g1', 'p', 'a'),
  (:'A', :'A', 'good2', 'https://web.push.apple.com/g2', 'p', 'a'),
  (:'A', :'A', 'bad1', 'https://attacker.example/collect', 'p', 'a');
\i :migration
select pg_temp.chk('1. 012 실행 → 엉뚱한 주소만 삭제, 정상 2개 유지',
  (select string_agg(device_id, ',' order by device_id) from push_subscriptions) = 'good1,good2',
  (select string_agg(device_id, ',' order by device_id) from push_subscriptions));
\i :migration
select pg_temp.chk('2. 다시 실행해도 안전 (제약 1개)',
  (select count(*) from pg_constraint where conname = 'push_subscriptions_endpoint_host') = 1);
select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,100) from out order by n;
