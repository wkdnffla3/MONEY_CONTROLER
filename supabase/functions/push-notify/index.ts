// 웹 푸시 발송 (방법 2) — Supabase Edge Function (Deno)
//
// 흐름 1: 내역/장보기 물품이 DB에 새로 들어옴 → Database Webhook 이 이 함수를 호출
//         → 같은 가계부의 다른 기기들(push_subscriptions)에 푸시 발송
// 흐름 2: pg_cron 이 매주/매월 { type: 'REPORT', period } 로 호출 (supabase/009_report_schedule.sql)
//         → 가계부마다 지난주/지난달 요약을 푸시
//
// 필요한 비밀 값 (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어줌 (service_role 키는 이 서버 함수 안에만 있음)
// 배포: supabase functions deploy push-notify --no-verify-jwt   (대신 WEBHOOK_SECRET 헤더로 확인)
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildNotification, buildReport, reportRange, shouldSend } from '../_shared/notifyMessage.js';

const env = (k: string) => (Deno.env.get(k) || '').trim();
const VAPID_PUBLIC_KEY = env('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = env('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = env('VAPID_SUBJECT') || 'mailto:admin@example.com';
const WEBHOOK_SECRET = env('WEBHOOK_SECRET');
const TABLES = new Set(['transactions', 'shopping_items', 'tx_comments']);

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

  let payload: { type?: string; table?: string; record?: Record<string, unknown>; period?: string };
  try { payload = await req.json(); } catch { return json(400, { error: 'bad json' }); }
  if (payload.type === 'REPORT') return sendReports(payload.period);
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

  // 댓글은 쓴 사람 계정의 모든 기기 제외(account_id, 008 이후), 나머지는 입력한 기기만 제외
  const isComment = table === 'tx_comments';
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select(isComment ? 'id, account_id, device_id, endpoint, p256dh, auth, prefs' : 'id, device_id, endpoint, p256dh, auth, prefs')
    .eq('user_id', userId);
  if (error) return json(500, { error: error.message });

  const result = await pushTo(subs || [], note, (s) => (isComment
    ? !!record.author && s.account_id === record.author
    : !!record.device_id && s.device_id === record.device_id));
  return json(200, result);
});

type Sub = { id: string; user_id?: string; account_id?: string; device_id: string; endpoint: string; p256dh: string; auth: string; prefs: unknown };
type Note = { kind: string; title: string; body: string; tag: string; url: string };

// 기기 목록에 알림 보내기. exclude(s) 가 true 인 기기, 그 종류를 껐거나 방해 금지 시간인 기기는 제외
async function pushTo(subs: Sub[], note: Note, exclude: (s: Sub) => boolean = () => false) {
  const message = JSON.stringify({ title: note.title, body: note.body, tag: note.tag, url: note.url });
  const now = new Date();
  let sent = 0, skipped = 0, removed = 0;
  await Promise.all(subs.map(async (s) => {
    if (exclude(s) || !shouldSend(note.kind, s.prefs, now)) { skipped += 1; return; }
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
  return { sent, skipped, removed };
}

// 주간·월간 리포트: 리포트를 받겠다는 기기가 있는 가계부만 계산
async function sendReports(period?: string) {
  if (period !== 'week' && period !== 'month') return json(400, { error: 'period must be week or month' });
  const kind = period === 'week' ? 'weekly' : 'monthly';
  const range = reportRange(period, new Date(), 'Asia/Seoul');
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('id, user_id, device_id, endpoint, p256dh, auth, prefs');
  if (error) return json(500, { error: error.message });

  const byLedger = new Map<string, Sub[]>();
  for (const s of (subs || []) as Sub[]) {
    if (!s.user_id || !shouldSend(kind, s.prefs)) continue;
    byLedger.set(s.user_id, [...(byLedger.get(s.user_id) || []), s]);
  }

  const total = { ledgers: 0, sent: 0, skipped: 0, removed: 0, empty: 0 };
  for (const [ledgerId, list] of byLedger) {
    const { data: txs, error: e1 } = await admin
      .from('transactions')
      .select('type, amount, category, date')
      .eq('user_id', ledgerId)
      .gte('date', range.prev.start)
      .lte('date', range.cur.end);
    if (e1) { console.error('report tx load failed', ledgerId, e1.message); continue; }
    let budget = 0;
    if (period === 'month') {
      const { data: st } = await admin.from('settings').select('budget').eq('user_id', ledgerId).maybeSingle();
      budget = Number(st?.budget) || 0;
    }
    const note = buildReport({ period, range, txs: txs || [], budget });
    if (!note) { total.empty += 1; continue; } // 그 기간 내역이 없으면 보내지 않음
    const r = await pushTo(list, note);
    total.ledgers += 1; total.sent += r.sent; total.skipped += r.skipped; total.removed += r.removed;
  }
  return json(200, { period, range, ...total });
}
