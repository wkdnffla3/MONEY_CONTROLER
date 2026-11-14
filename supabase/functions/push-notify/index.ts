// 웹 푸시 발송 (방법 2) — Supabase Edge Function (Deno)
//
// 흐름: 내역/장보기 물품이 DB에 새로 들어옴 → Database Webhook 이 이 함수를 호출
//       → 같은 계정의 다른 기기들(push_subscriptions)에 푸시 발송
//
// 필요한 비밀 값 (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어줌 (service_role 키는 이 서버 함수 안에만 있음)
// 배포: supabase functions deploy push-notify --no-verify-jwt   (대신 WEBHOOK_SECRET 헤더로 확인)
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildNotification, shouldSend } from '../_shared/notifyMessage.js';

const env = (k: string) => (Deno.env.get(k) || '').trim();
const VAPID_PUBLIC_KEY = env('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = env('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = env('VAPID_SUBJECT') || 'mailto:admin@example.com';
const WEBHOOK_SECRET = env('WEBHOOK_SECRET');
const TABLES = new Set(['transactions', 'shopping_items']);

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 비밀 값 비교: 길이·내용에 따라 걸리는 시간이 달라지지 않게
function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!WEBHOOK_SECRET || !safeEqual(req.headers.get('x-webhook-secret') || '', WEBHOOK_SECRET)) {
    return json(401, { error: 'unauthorized' });
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json(500, { error: 'VAPID keys not set' });

  let payload: { type?: string; table?: string; record?: Record<string, unknown> };
  try { payload = await req.json(); } catch { return json(400, { error: 'bad json' }); }
  const { type, table, record } = payload;
  if (!table || !TABLES.has(table) || type !== 'INSERT' || !record || typeof record.user_id !== 'string') {
    return json(200, { skipped: 'not a new entry' });
  }
  const userId = record.user_id as string;

  // "누가" 표시용 사람 목록 (003 전이면 칸이 없을 수 있음 → 없이 진행)
  const { data: st } = await admin.from('settings').select('members').eq('user_id', userId).maybeSingle();
  const members = Array.isArray(st?.members) ? st.members : [];

  const note = buildNotification({ table, type, record, members });
  if (!note) return json(200, { skipped: 'no notification for this entry' });

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('id, device_id, endpoint, p256dh, auth, prefs')
    .eq('user_id', userId);
  if (error) return json(500, { error: error.message });

  const message = JSON.stringify({ title: note.title, body: note.body, tag: note.tag, url: note.url });
  const now = new Date();
  let sent = 0, skipped = 0, removed = 0;

  await Promise.all((subs || []).map(async (s) => {
    // 입력한 기기 자신과, 그 종류를 껐거나 방해 금지 시간인 기기는 제외
    if (record.device_id && s.device_id === record.device_id) { skipped += 1; return; }
    if (!shouldSend(note.kind, s.prefs, now)) { skipped += 1; return; }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        message,
        { TTL: 60 * 60, urgency: 'normal', topic: note.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) },
      );
      sent += 1;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // 앱 삭제·권한 해제 등으로 더는 유효하지 않은 구독 → 지움
      if (code === 404 || code === 410) {
        await admin.from('push_subscriptions').delete().eq('id', s.id);
        removed += 1;
      } else {
        console.error('push failed', code, (e as Error).message);
      }
    }
  }));

  return json(200, { sent, skipped, removed });
});
