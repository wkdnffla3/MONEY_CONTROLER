/**
 * 구독 자동 발견: 매달 비슷한 날, 비슷한 금액으로 생기는 내역을 찾아 "반복 내역으로 등록할까요?" 제안
 *
 * 묶는 기준: 메모가 있으면 같은 메모(공백·대소문자 무시), 없으면 같은 카테고리 + 같은 금액
 * 조건: 최근까지 3달 이상 연속, 한 달에 한 번만, 금액 차이 10% 이내, 날짜 차이 6일 이내,
 *       마지막이 이번 달이나 지난달 (아직 계속되는 것), 이미 반복 내역이 있거나 "무시"한 건 제외
 */
import { nextDate, ymOf } from './recurring.js';
import { MAX_MEMO } from './outbox.js';

export const MIN_MONTHS = 3;
const normMemo = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[()[\]·.,_-]/g, '');
const monthNum = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + m - 1; };

export function subscriptionKey(t) {
  const memo = normMemo(t.memo);
  return memo.length >= 2 ? `${t.type}|m|${memo}`.slice(0, 80) : `${t.type}|c|${t.category}|${t.amount}`.slice(0, 80);
}

// 일시정지한 규칙도 "이미 있음"으로 봄 (멈춰 둔 걸 또 등록하라고 제안하면 중복)
const coveredBy = (s, rules) => rules.some((r) => r.type === s.type && (
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
      lastYm: latest.date.slice(0, 7), // 마지막으로 결제된 달 (이번 달 또는 지난달)
      cardId: latest.type === 'expense' && latest.inst <= 1 ? latest.cardId ?? null : null, // 마지막 결제 카드
      tags: Array.isArray(latest.tags) ? latest.tags : [],
    };
    if (coveredBy(s, recurring)) continue;
    out.push(s);
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/**
 * 제안 → 반복 내역 규칙. 마지막으로 결제된 달까지는 이미 기록돼 있으니 그다음 달부터 자동 기록 (last = 마지막 결제 달).
 * 마지막이 지난달이면 이번 달 결제일에 기록되고, 이번 달이면 다음 달부터.
 */
export function ruleFromSuggestion(s, id, today = new Date()) {
  const ym = ymOf(today);
  const last = typeof s.lastYm === 'string' && /^\d{4}-\d{2}$/.test(s.lastYm) && s.lastYm <= ym ? s.lastYm : ym;
  return {
    id, type: s.type, amount: s.amount, category: s.category, memo: s.memo.slice(0, MAX_MEMO), memberId: s.memberId ?? null,
    day: Math.min(31, Math.max(1, s.day)), start: last, end: null, last, active: true,
    ...(s.cardId ? { cardId: s.cardId } : {}), ...(s.tags?.length ? { tags: [...s.tags] } : {}),
  };
}

/**
 * 등록 안내 문구: 언제부터 기록되는지. 마지막 결제가 지난달이고 이번 달 결제일이 이미 지났으면
 * 등록하자마자 이번 달 몫이 기록되므로 "다음 달부터"라고 하면 틀림
 */
export function suggestionStartText(rule, today = new Date()) {
  const d = nextDate(rule, today);
  if (!d) return '';
  const [, m, day] = d.split('-').map(Number);
  const todayKey = `${ymOf(today)}-${String(today.getDate()).padStart(2, '0')}`;
  return d <= todayKey ? `이번 달 ${day}일 몫은 바로 기록돼요` : `${m}월 ${day}일부터 자동 기록`;
}

// ===== 말일 결제가 다음 달 1일로 밀림 =====
// 말일(28일 이후)에 자동 기록되는 반복 내역인데, 실제 결제가 다음 달 1~3일에 들어와 직접 입력되면
// 같은 구독이 그 달에 한 번 더 기록됨(자동 + 직접) → 그 반복 내역의 자동 기록을 멈추고 알림
export const SLIP_MIN_DAY = 28; // 반복 내역 결제일이 이날 이후면 "말일 결제"로 봄
export const SLIP_MAX_DAY = 3;  // 다음 달 이날까지 들어온 결제를 "밀린 결제"로 봄

/** 반복 내역과 같은 구독으로 보이는 내역인지: 메모가 있으면 같은 메모, 없으면 같은 카테고리 + 금액 차이 10% 이내 */
export function sameSubscription(rule, t) {
  if (t.type !== rule.type) return false;
  const rm = normMemo(rule.memo);
  if (rm.length >= 2) return rm === normMemo(t.memo);
  return t.category === rule.category && Math.abs(t.amount - rule.amount) <= rule.amount * 0.1;
}

/**
 * 말일 결제가 1일로 밀린 반복 내역 → [{ rule, tx }]
 * 조건: 진행 중, 결제일 28일 이후, 그 전달 몫을 이미 자동 기록함(last ≥ 전달),
 *       이번 달·지난달 1~3일에 같은 구독으로 보이는 직접 입력 내역(rec-·shop- 아님)이 있음.
 *       이미 알린 내역(rule.slipTx)은 다시 알리지 않음 (다시 시작해도 같은 내역으로 또 멈추지 않게)
 */
export function findMonthEndSlips(rules, txList, today = new Date()) {
  const cur = monthNum(ymOf(today));
  const out = [];
  for (const r of rules || []) {
    if (!r.active || !(r.day >= SLIP_MIN_DAY) || typeof r.last !== 'string') continue;
    const hit = (txList || []).find((t) => {
      if (typeof t.id !== 'string' || t.id.startsWith('rec-') || t.id.startsWith('shop-') || t.id === r.slipTx || t.id === r.srcTx) return false;
      if (typeof t.date !== 'string' || Number(t.date.slice(8, 10)) > SLIP_MAX_DAY) return false;
      const m = monthNum(t.date.slice(0, 7));
      if (m > cur || m < cur - 1 || monthNum(r.last) < m - 1) return false;
      return sameSubscription(r, t);
    });
    if (hit) out.push({ rule: r, tx: hit });
  }
  return out;
}

/** 밀린 결제를 찾은 반복 내역: 자동 기록을 멈추고 이유·그 내역을 기억 */
export const pauseForSlip = (rule, tx) => ({ ...rule, active: false, pausedReason: 'slip', slipTx: tx.id });
