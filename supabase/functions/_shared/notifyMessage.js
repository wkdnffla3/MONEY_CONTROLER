// 알림 문구 만들기 — 앱(앱 안 알림)과 Edge Function(웹 푸시)이 같은 파일을 씀.
// 브라우저와 Deno 둘 다에서 돌아가도록 외부 라이브러리 없이 작성.

export const NOTIFY_KINDS = ['tx', 'shop', 'purchase'];

export const DEFAULT_PREFS = Object.freeze({
  inapp: true,        // 앱이 열려 있을 때 화면 위 알림
  tx: true,           // 가계부 내역 추가
  shop: true,         // 장보기 물품 추가
  purchase: true,     // 장보기 결제 확정
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
  for (const k of ['inapp', 'tx', 'shop', 'purchase', 'quiet']) if (typeof src[k] === 'boolean') out[k] = src[k];
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
