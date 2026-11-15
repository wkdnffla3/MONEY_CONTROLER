-- 012: 웹 푸시 주소를 실제 푸시 서비스로만 제한 (보안)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)
-- 실행 전에도 앱은 그대로 동작해요. Edge Function 도 같은 검사를 하므로, 이 파일은 DB 쪽 이중 잠금이에요.

-- 푸시 주소는 실제 브라우저 푸시 서비스로만 (그 외 주소로 서버가 요청을 보내지 않게)
--   구글 FCM(크롬·삼성 인터넷·오페라 등), 모질라(파이어폭스), 마이크로소프트 WNS(엣지), 애플(사파리·아이폰)
--   목록 출처: https://github.com/pushpad/known-push-services
create or replace function public.is_push_endpoint(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p ~* '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)+notify\.windows\.com|([a-z0-9-]+\.)+push\.apple\.com)(:443)?/'
$$;
-- 이미 저장된 엉뚱한 주소는 지움 (정상 기기는 영향 없음)
delete from public.push_subscriptions where not public.is_push_endpoint(endpoint);
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_host;
alter table public.push_subscriptions add  constraint push_subscriptions_endpoint_host check (public.is_push_endpoint(endpoint));

notify pgrst, 'reload schema';
