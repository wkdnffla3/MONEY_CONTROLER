// 알림 문구 만들기 — 앱(앱 안 알림)과 Edge Function(웹 푸시)이 같은 파일을 씀.
// 브라우저와 Deno 둘 다에서 돌아가도록 외부 라이브러리 없이 작성.

export const NOTIFY_KINDS = ['tx', 'shop', 'purchase', 'weekly', 'monthly'];

export const DEFAULT_PREFS = Object.freeze({
  inapp: true,        // 앱이 열려 있을 때 화면 위 알림
  tx: true,           // 가계부 내역 추가
  shop: true,         // 장보기 물품 추가
  purchase: true,     // 장보기 결제 확정
  weekly: true,       // 주간 리포트 (월요일 오전 9시, 웹 푸시)
  monthly: true,      // 월간 리포트 (매월 1일 오전 9시, 웹 푸시)
  quiet: false,       // 방해 금지 시간 사용
  quietStart: '23:00',
  quietEnd: '07:00',
  tz: 'Asia/Seoul',
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 저장된 값이 깨져 있어도 안전한 설정으로 */
export function normalizePrefs(p) {
  const src = p && typeof p === 'object' ? p : {};
  const out = { ...DEFAULT_PREFS };
  for (const k of ['inapp', 'tx', 'shop', 'purchase', 'weekly', 'monthly', 'quiet']) if (typeof src[k] === 'boolean') out[k] = src[k];
  if (HHMM.test(src.quietStart)) out.quietStart = src.quietStart;
  if (HHMM.test(src.quietEnd)) out.quietEnd = src.quietEnd;
  if (typeof src.tz === 'string' && src.tz.length <= 64) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: src.tz }); out.tz = src.tz; } catch { /* 모르는 시간대 → 기본값 */ }
  }
  return out;
}

const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

/** 그 시간대 기준 지금 시각(분) */
export function localMinutes(date, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date);
  const h = Number(parts.find((x) => x.type === 'hour')?.value || 0) % 24;
  const m = Number(parts.find((x) => x.type === 'minute')?.value || 0);
  return h * 60 + m;
}

/** 방해 금지 시간인지 (23:00~07:00처럼 자정을 넘는 구간도 처리) */
export function inQuietHours(prefs, date = new Date()) {
  const p = normalizePrefs(prefs);
  if (!p.quiet) return false;
  const s = toMin(p.quietStart), e = toMin(p.quietEnd), now = localMinutes(date, p.tz);
  if (s === e) return false;
  return s < e ? now >= s && now < e : now >= s || now < e;
}

/** 이 종류의 알림을 지금 보낼지 */
export function shouldSend(kind, prefs, date = new Date()) {
  const p = normalizePrefs(prefs);
  if (!NOTIFY_KINDS.includes(kind) || p[kind] === false) return false;
  return !inQuietHours(p, date);
}

const won = (n) => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** 누가: 등록된 사람이면 "민지님이", 아니면 "다른 기기에서" */
export function whoText(members, memberId) {
  const m = Array.isArray(members) && memberId ? members.find((x) => x && x.id === memberId) : null;
  return m && m.name ? `${clip(m.name, 12)}님이` : '다른 기기에서';
}

/**
 * DB에 새로 들어온 줄 → 알림 내용. 알릴 필요 없으면 null.
 * table: 'transactions' | 'shopping_items', type: 'INSERT' 등, record: DB 줄(snake_case)
 * 반환: { kind, title, body, tag, url }
 */
export function buildNotification({ table, type = 'INSERT', record, members = [] }) {
  if (type !== 'INSERT' || !record || typeof record !== 'object' || typeof record.id !== 'string') return null;
  const who = whoText(members, record.member_id);

  if (table === 'transactions') {
    // 반복 내역은 그 달에 처음 연 기기가 자동으로 만드는 것 → 알리지 않음
    if (record.id.startsWith('rec-')) return null;
    const isIncome = record.type === 'income';
    const memo = clip(record.memo, 40);
    if (record.id.startsWith('shop-')) {
      return {
        kind: 'purchase',
        title: `${who} 장보기 결제를 확정했어요`,
        body: `${clip(record.category, 12)} ${won(record.amount)}${memo ? ` · ${memo}` : ''}`,
        tag: `purchase-${record.id}`,
        url: '/#shopping',
      };
    }
    return {
      kind: 'tx',
      title: `${who} ${isIncome ? '수입' : '지출'}을 추가했어요`,
      body: `${clip(record.category, 12)} ${won(record.amount)}${memo ? ` · ${memo}` : ''}`,
      tag: `tx-${record.id}`,
      url: '/',
    };
  }

  if (table === 'shopping_items') {
    if (record.status === 'bought') return null; // 결제 확정은 내역 쪽 알림으로 한 번만
    const qty = Number(record.qty) || 1;
    return {
      kind: 'shop',
      title: `${who} 장보기에 추가했어요`,
      body: `${clip(record.name, 30)}${qty > 1 ? ` ×${qty}` : ''}${Number(record.price) > 0 ? ` · 약 ${won(record.price * qty)}` : ''}`,
      tag: `shop-${record.id}`,
      url: '/#shopping',
    };
  }
  return null;
}

// ===== 주간·월간 리포트 =====
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const addDays = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

/** 그 시간대 기준 오늘 날짜 (UTC 자정 Date 로) */
export function localToday(date = new Date(), tz = 'Asia/Seoul') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => Number(parts.find((x) => x.type === t)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

/**
 * 리포트 기간. week = 지난주 월~일, month = 지난달 1일~말일. 비교 대상은 그 직전 기간.
 * 반환: { cur: { start, end, month? }, prev: { start, end } } — 날짜는 'YYYY-MM-DD'
 */
export function reportRange(period, date = new Date(), tz = 'Asia/Seoul') {
  const today = localToday(date, tz);
  if (period === 'week') {
    const dow = (today.getUTCDay() + 6) % 7; // 월=0 … 일=6
    const thisMon = addDays(today, -dow);
    const start = addDays(thisMon, -7);
    return {
      cur: { start: ymd(start), end: ymd(addDays(thisMon, -1)) },
      prev: { start: ymd(addDays(start, -7)), end: ymd(addDays(start, -1)) },
    };
  }
  if (period === 'month') {
    const y = today.getUTCFullYear(), m = today.getUTCMonth(); // 이번 달(0~11)
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0));
    const pStart = new Date(Date.UTC(y, m - 2, 1));
    const pEnd = new Date(Date.UTC(y, m - 1, 0));
    return {
      cur: { start: ymd(start), end: ymd(end), month: start.getUTCMonth() + 1 },
      prev: { start: ymd(pStart), end: ymd(pEnd) },
    };
  }
  throw new Error('bad period');
}

/**
 * 리포트 알림 내용. txs: [{ type, amount, category, date }] (snake/camel 상관없음), budget: 월 예산(월간만 사용)
 * 그 기간에 내역이 하나도 없으면 null
 */
export function buildReport({ period, range, txs = [], budget = 0 }) {
  const inRange = (t, r) => typeof t.date === 'string' && t.date >= r.start && t.date <= r.end;
  const sum = (r, type) => txs.filter((t) => inRange(t, r) && (type === 'income' ? t.type === 'income' : t.type !== 'income'))
    .reduce((a, t) => a + (Number(t.amount) || 0), 0);
  const cur = txs.filter((t) => inRange(t, range.cur));
  if (!cur.length) return null;
  const exp = sum(range.cur, 'expense');
  const inc = sum(range.cur, 'income');
  const prevExp = sum(range.prev, 'expense');

  const byCat = {};
  for (const t of cur) if (t.type !== 'income') byCat[t.category] = (byCat[t.category] || 0) + (Number(t.amount) || 0);
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];

  const parts = [];
  const label = period === 'week' ? '그 전주' : '그 전달';
  if (prevExp > 0) {
    const pct = Math.round(((exp - prevExp) / prevExp) * 100);
    parts.push(pct === 0 ? `${label}${period === 'week' ? '와' : '과'} 비슷해요` : `${label}보다 ${Math.abs(pct)}% ${pct > 0 ? '늘었어요' : '줄었어요'}`);
  }
  if (period === 'month' && inc > 0) parts.push(`수입 ${won(inc)}`);
  if (period === 'month' && budget > 0) parts.push(`예산의 ${Math.round((exp / budget) * 100)}%`);
  if (top) parts.push(`가장 많이 쓴 곳 ${clip(top[0], 12)} ${won(top[1])}`);

  const isWeek = period === 'week';
  return {
    kind: isWeek ? 'weekly' : 'monthly',
    title: isWeek ? `지난주 지출 ${won(exp)}` : `${range.cur.month}월 지출 ${won(exp)}`,
    body: clip(parts.join(' · ') || '이번 기간 내역을 확인해 보세요', 160),
    tag: isWeek ? `weekly-${range.cur.start}` : `monthly-${range.cur.start}`,
    url: isWeek ? '/' : '/#report',
  };
}
