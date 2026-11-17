-- 012 푸시 주소 제한: 실제 푸시 서비스 주소만 저장 가능 (앱의 isPushEndpoint 와 같은 규칙)
\set A '00000000-0000-0000-0000-00000000000a'
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated, anon; grant usage on sequence out_n_seq to authenticated, anon;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;

select pg_temp.chk('1. 허용: FCM·모질라(:443 포함)·엣지·애플',
  public.is_push_endpoint('https://fcm.googleapis.com/fcm/send/abc') and public.is_push_endpoint('https://android.googleapis.com/gcm/send/x')
  and public.is_push_endpoint('https://updates.push.services.mozilla.com/wpush/v2/g') and public.is_push_endpoint('https://updates.push.services.mozilla.com:443/wpush/v1/x')
  and public.is_push_endpoint('https://wns2-par02p.notify.windows.com/w/?token=B') and public.is_push_endpoint('https://web.push.apple.com/QGu'));
select pg_temp.chk('2. 거절: http·비슷한 가짜 도메인·내부 주소·다른 포트',
  not (public.is_push_endpoint('http://fcm.googleapis.com/fcm/send/x') or public.is_push_endpoint('https://fcm.googleapis.com.evil.io/x')
    or public.is_push_endpoint('https://evilfcm.googleapis.com/x') or public.is_push_endpoint('https://notify.windows.com/x')
    or public.is_push_endpoint('https://attacker.example/push.apple.com/x') or public.is_push_endpoint('https://169.254.169.254/latest')
    or public.is_push_endpoint('https://fcm.googleapis.com:8443/x') or public.is_push_endpoint('https://fcm.googleapis.com')));

select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
do $$ begin
  begin insert into push_subscriptions(device_id, endpoint, p256dh, auth) values ('d1', 'https://attacker.example/collect', 'p', 'a');
    perform pg_temp.chk('3. 앱에서 엉뚱한 주소 등록 → 거절', false);
  exception when check_violation then perform pg_temp.chk('3. 앱에서 엉뚱한 주소 등록 → 거절', true, sqlerrm); end;
  begin insert into push_subscriptions(device_id, endpoint, p256dh, auth) values ('d2', 'https://fcm.googleapis.com/fcm/send/ok1', 'p', 'a');
    perform pg_temp.chk('4. 정상 주소 등록 → 저장', true);
  exception when others then perform pg_temp.chk('4. 정상 주소 등록 → 저장', false, sqlerrm); end;
  begin update push_subscriptions set endpoint = 'https://attacker.example/x' where device_id = 'd2';
    perform pg_temp.chk('5. 저장된 주소를 엉뚱한 주소로 수정 → 거절', false);
  exception when check_violation then perform pg_temp.chk('5. 저장된 주소를 엉뚱한 주소로 수정 → 거절', true); end;
end $$;
reset role;

select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,100) from out order by n;
select count(*) filter (where ok) || '/' || count(*) from out;
