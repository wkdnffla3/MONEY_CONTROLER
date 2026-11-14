-- 009 주간·월간 리포트 예약 (러너가 009_report_schedule.sql 을 먼저 적용)
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated, anon; grant usage on sequence out_n_seq to authenticated, anon;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;

select pg_temp.chk('1. 예약 2개: 매주 월 UTC 0시, 매월 1일 UTC 0시 (= 한국 오전 9시)',
  (select string_agg(jobname||'='||schedule, ',' order by jobname) from cron.job) = 'ledger-monthly-report=0 0 1 * *,ledger-weekly-report=0 0 * * 1',
  (select string_agg(jobname||'='||schedule, ',' order by jobname) from cron.job));
select public.send_report_push('week');
select pg_temp.chk('2. 호출하면 Vault 의 주소·비밀 값으로 REPORT 요청',
  (select count(*) from net.calls)=1 and (select body->>'type' from net.calls)='REPORT' and (select body->>'period' from net.calls)='week'
  and (select headers->>'x-webhook-secret' from net.calls) is not null,
  (select body::text || ' ' || headers::text from net.calls limit 1));
do $$ begin begin perform public.send_report_push('year'); perform pg_temp.chk('3. 잘못된 기간 거절', false);
  exception when others then perform pg_temp.chk('3. 잘못된 기간 거절', true); end; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false); set role authenticated;
do $$ begin begin perform public.send_report_push('week'); perform pg_temp.chk('4. 앱(로그인 사용자)에서는 호출 불가', false);
  exception when insufficient_privilege then perform pg_temp.chk('4. 앱(로그인 사용자)에서는 호출 불가', true); end; end $$;
reset role;
\i :migration
select pg_temp.chk('5. 009 를 다시 실행해도 안전 (예약 2개 그대로, 비밀 값 중복 없음)',
  (select count(*) from cron.job)=2 and (select count(*) from vault.secrets)=2);

select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,100) from out order by n;
select count(*) filter (where ok) || '/' || count(*) from out;
