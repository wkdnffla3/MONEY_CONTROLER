-- 주간·월간 리포트 푸시 예약 (선택)
-- 먼저: 007·008 실행, push-notify 함수 배포, 웹 푸시 설정 완료
-- 1) 아래 ① ② 두 값을 내 값으로 바꾼 뒤  2) SQL Editor 에서 Run  (여러 번 실행해도 안전)
--
-- 보내는 시각 (한국 시간): 주간 = 매주 월요일 오전 9시 / 월간 = 매월 1일 오전 9시
-- 각 기기의 🔔 알림 설정에서 "주간 리포트", "월간 리포트"를 끄면 그 기기는 받지 않아요.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 함수 주소와 웹훅 비밀 값은 Vault(암호화 저장소)에 보관
delete from vault.secrets where name in ('push_notify_url', 'push_webhook_secret');
select vault.create_secret(
  'https://프로젝트ID.supabase.co/functions/v1/push-notify',   -- ① 프로젝트ID 부분만 바꾸기
  'push_notify_url');
select vault.create_secret(
  '웹훅 비밀 값',                                                -- ② supabase secrets 의 WEBHOOK_SECRET 과 같은 값
  'push_webhook_secret');

create or replace function public.send_report_push(p_period text) returns void
language plpgsql security definer set search_path = public as $$
declare
  u text;
  s text;
begin
  if p_period not in ('week', 'month') then raise exception 'bad period'; end if;
  select decrypted_secret into u from vault.decrypted_secrets where name = 'push_notify_url';
  select decrypted_secret into s from vault.decrypted_secrets where name = 'push_webhook_secret';
  perform net.http_post(
    url := u,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s),
    body := jsonb_build_object('type', 'REPORT', 'period', p_period),
    timeout_milliseconds := 60000
  );
end $$;
-- 앱(로그인 사용자·익명)에서는 호출 못 하게
revoke all on function public.send_report_push(text) from public, anon, authenticated;

-- cron 시각은 UTC 기준: UTC 0시 = 한국 오전 9시. 같은 이름으로 다시 실행하면 덮어씀
select cron.schedule('ledger-weekly-report',  '0 0 * * 1', $$select public.send_report_push('week')$$);
select cron.schedule('ledger-monthly-report', '0 0 1 * *', $$select public.send_report_push('month')$$);

-- 바로 시험해 보려면 (지난주 리포트가 지금 옴):
--   select public.send_report_push('week');
-- 예약 끄기:
--   select cron.unschedule('ledger-weekly-report'); select cron.unschedule('ledger-monthly-report');
