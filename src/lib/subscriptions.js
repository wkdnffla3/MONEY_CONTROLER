/**
 * 구독 자동 발견: 매달 비슷한 날, 비슷한 금액으로 생기는 내역을 찾아 "반복 내역으로 등록할까요?" 제안
 *
 * 묶는 기준: 메모가 있으면 같은 메모(공백·대소문자 무시), 없으면 같은 카테고리 + 같은 금액
 * 조건: 최근까지 3달 이상 연속, 한 달에 한 번만, 금액 차이 10% 이내, 날짜 차이 6일 이내,
 *       마지막이 이번 달이나 지난달 (아직 계속되는 것), 이미 반복 내역이 있거나 "무시"한 건 제외
 */
import { ymOf } from './recurring.js';
import { MAX_MEMO } from './outbox.js';

export const MIN_MONTHS = 3;
const normMemo = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[()[\]·.,_-]/g, '');
const monthNum = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + m - 1; };

export function subscriptionKey(t) {
  const memo = normMemo(t.memo);
  return memo.length >= 2 ? `${t.type}|m|${memo}`.slice(0, 80) : `${t.type}|c|${t.category}|${t.amount}`.slice(0, 80);
}

const coveredBy = (s, rules) => rules.some((r) => r.active && r.type === s.type && (
  (normMemo(r.memo).length >= 2 && normMemo(r.memo) === normMemo(s.memo))
  || (r.category === s.category && Math.abs(r.amount - s.amount) <= s.amount * 0.1)));

export function detectSubscriptions(allTx, recurring = [], dismissed = [], today = new Date(), limit = 5) {
  const cur = monthNum(ymOf(today));
  const groups = new Map();
  for (const t of allTx) {
    if (typeof t.id === 'string' && (t.id.startsWith('rec-') || t.id.startsWith('shop-'))) continue;
    if (typeof t.date !== 'string' || !(t.amount > 0)) continue;
    const m = monthNum(t.date.slice(0, 7));
    if (m > cur || m < cur - 24) continue;
    const k = subscriptionKey(t);
    if (!groups.has(k)) groups.set(k, new Map());
    const byMonth = groups.get(k);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(t);
  }
  const dismissedSet = new Set(dismissed);
  const out = [];
  for (const [key, byMonth] of groups) {
    if (dismissedSet.has(key)) continue;
    const months = [...byMonth.keys()].sort((a, b) => a - b);
    const last = months[months.length - 1];
    if (last < cur - 1) continue; // 끊긴 것
    // 마지막 달부터 거꾸로 연속된 달
    const run = [last];
    for (let i = months.length - 2; i >= 0 && months[i] === run[run.length - 1] - 1; i -= 1) run.push(months[i]);
    if (run.length < MIN_MONTHS) continue;
    if (run.some((m) => byMonth.get(m).length > 1)) continue; // 한 달에 여러 번 = 구독이 아님 (커피 등)
    const recent = run.slice(0, MIN_MONTHS).map((m) => byMonth.get(m)[0]); // 최신부터
    const amounts = recent.map((t) => t.amount);
    if (Math.max(...amounts) > Math.min(...amounts) * 1.1) continue;
    const days = recent.map((t) => Number(t.date.slice(8, 10)));
    if (Math.max(...days) - Math.min(...days) > 6) continue;
    const latest = recent[0];
    const s = {
      key, type: latest.type, amount: latest.amount, category: latest.category, memo: latest.memo || '',
      memberId: latest.memberId ?? null, day: days[0], months: run.length, label: latest.memo || latest.category,
    };
    if (coveredBy(s, recurring)) continue;
    out.push(s);
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/** 제안 → 반복 내역 규칙. 이번 달 것은 이미 있으니 다음 달부터 자동 기록 (last = 이번 달) */
export function ruleFromSuggestion(s, id, today = new Date()) {
  const ym = ymOf(today);
  return {
    id, type: s.type, amount: s.amount, category: s.category, memo: s.memo.slice(0, MAX_MEMO), memberId: s.memberId ?? null,
    day: Math.min(31, Math.max(1, s.day)), start: ym, end: null, last: ym, active: true,
  };
}
