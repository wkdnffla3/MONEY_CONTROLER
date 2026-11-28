/**
 * 반복 내역 (월세, 통신비, 구독료, 월급 등 매달 같은 날 생기는 돈)
 *
 * 규칙 형태
 *  { id, type, amount, category, memo, memberId, day(1~31), start:'YYYY-MM', end:'YYYY-MM'|null,
 *    last:'YYYY-MM'|null(마지막으로 등록한 달), active }
 *
 * 중복 방지
 *  - 자동 등록되는 내역의 ID는 "rec-<규칙ID>-<YYYY-MM>"으로 고정 → 두 기기가 같은 달을 동시에 등록해도
 *    서버에는 upsert라 한 줄만 남음.
 *  - 등록 후 규칙의 last를 그 달로 올림 → 사용자가 자동 등록된 내역을 지워도 다시 생기지 않음.
 */
import { daysInMonth, pad } from './format.js';

export const MAX_BACKFILL = 24; // 오래 앱을 안 열었을 때 최대 몇 달까지 채울지

const toNum = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
const toYm = (n) => `${Math.floor(n / 12)}-${pad((n % 12) + 1)}`;
export const ymOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

export const recurringTxId = (ruleId, ym) => `rec-${ruleId}-${ym}`;
export const isRecurringTxId = (id) => typeof id === 'string' && id.startsWith('rec-');

/** 그 달의 실제 날짜. 31일 규칙은 2월엔 28(29)일, 30일까지인 달엔 30일 */
export function occurrenceDate(ym, day) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

/** 아직 등록 안 된, 날짜가 이미 된 달들 */
export function dueMonths(rule, today = new Date()) {
  if (!rule.active) return [];
  const cur = toNum(ymOf(today));
  let from = toNum(rule.start);
  if (rule.last) from = Math.max(from, toNum(rule.last) + 1);
  from = Math.max(from, cur - MAX_BACKFILL + 1);
  const to = rule.end ? Math.min(cur, toNum(rule.end)) : cur;
  const out = [];
  for (let n = from; n <= to; n += 1) {
    const ym = toYm(n);
    const date = occurrenceDate(ym, rule.day);
    if (n === cur && Number(date.slice(8)) > today.getDate()) break; // 이번 달은 그날이 와야 등록
    out.push({ ym, date });
  }
  return out;
}

/**
 * 이번 달에 아직 안 왔지만 곧 자동으로 기록될 반복 내역 (예산의 "하루 쓸 수 있는 금액" 계산용)
 * 반환: [{ rule, date }] — 이번 달 그날이 오늘 이후이고, 아직 기록 안 됐고, 기간 안인 활성 규칙
 */
export function upcomingThisMonth(rules, today = new Date(), type = 'expense') {
  const ym = ymOf(today);
  const cur = toNum(ym);
  return (rules || []).filter((r) => r.active && r.type === type
    && toNum(r.start) <= cur && (!r.end || toNum(r.end) >= cur) && (!r.last || toNum(r.last) < cur))
    .map((r) => ({ rule: r, date: occurrenceDate(ym, r.day) }))
    .filter(({ date }) => Number(date.slice(8)) > today.getDate());
}

/**
 * 일시정지했던 규칙을 다시 시작: 멈춰 있던 달은 건너뜀 (그동안 안 낸 것으로 봄).
 * 이번 달의 그날이 이미 지났으면 이번 달도 건너뛰고, 아직이면 그날 기록됨.
 */
export function resumeRule(rule, today = new Date()) {
  const cur = ymOf(today);
  const passed = Number(occurrenceDate(cur, rule.day).slice(8)) <= today.getDate();
  const skipTo = passed ? cur : toYm(toNum(cur) - 1);
  const last = rule.last && toNum(rule.last) >= toNum(skipTo) ? rule.last : skipTo;
  // 멈춘 이유는 지움 (slipTx 는 남겨서 같은 결제로 다시 멈추지 않게)
  const { pausedReason: _r, ...rest } = rule;
  return { ...rest, active: true, last };
}

/** 등록할 내역 목록과 last가 갱신된 규칙 목록 */
export function planRecurring(rules, today = new Date()) {
  const txs = [];
  let changed = false;
  const next = rules.map((r) => {
    const due = dueMonths(r, today);
    if (!due.length) return r;
    changed = true;
    for (const { ym, date } of due) {
      txs.push({
        id: recurringTxId(r.id, ym),
        data: {
          type: r.type,
          amount: r.amount,
          category: r.category,
          memo: r.memo || '',
          date,
          memberId: r.memberId ?? null,
          tags: Array.isArray(r.tags) ? r.tags : [],
          cardId: r.type === 'expense' ? r.cardId ?? null : null, // 카드로 내는 구독료 → 그 카드 청구 예정에 잡힘
          inst: 1,
          createdAt: Date.parse(`${date}T00:00:00Z`), // 기기마다 같은 값 → 같은 내용
        },
      });
    }
    return { ...r, last: due[due.length - 1].ym };
  });
  return { txs, rules: next, changed };
}

/** 다음 등록 예정일 (표시용) */
// 지난 달들은 이미 등록됐으므로, "아직 등록 안 된 첫 달"(이번 달 이후)의 날짜
export function nextDate(rule, today = new Date()) {
  if (!rule.active) return null;
  let n = toNum(rule.start);
  if (rule.last) n = Math.max(n, toNum(rule.last) + 1);
  n = Math.max(n, toNum(ymOf(today)));
  if (rule.end && n > toNum(rule.end)) return null;
  return occurrenceDate(toYm(n), rule.day);
}

export const MAX_RECURRING = 100;

/**
 * 한 달에 자동으로 기록되는 금액 합계 (반복 내역 묶음 머리글용) → { exp, inc, active }
 * 일시정지했거나 끝난(끝나는 달이 지난) 규칙은 빼고, active 는 센 규칙 수
 */
export function monthlyTotals(rules, today = new Date()) {
  const cur = toNum(ymOf(today));
  let exp = 0, inc = 0, active = 0;
  for (const r of rules || []) {
    if (!r.active || (r.end && toNum(r.end) < cur)) continue;
    active += 1;
    if (r.type === 'income') inc += r.amount; else exp += r.amount;
  }
  return { exp, inc, active };
}

/**
 * 새 내역을 "매달 반복"으로 저장할 때의 규칙. 그 날짜의 일(day)마다, 그 달부터.
 * 입력한 내역이 그 달 몫이므로 last = 그 달 → 같은 달은 다시 만들지 않음.
 * (지난달 날짜로 넣으면 그다음 달부터 이번 달까지 빠진 달은 자동으로 채워짐)
 */
export function ruleFromTx(data, id, srcTx = null) {
  const ym = data.date.slice(0, 7);
  const rule = {
    id, type: data.type, amount: data.amount, category: data.category, memo: data.memo || '',
    memberId: data.memberId ?? null, day: Number(data.date.slice(8, 10)), start: ym, end: null, last: ym, active: true,
  };
  // 결제 카드·태그도 이어감 (카드로 내는 구독료가 다음 달부터 현금으로 잡히지 않게)
  if (data.type === 'expense' && data.cardId) rule.cardId = data.cardId;
  if (Array.isArray(data.tags) && data.tags.length) rule.tags = [...data.tags];
  // 이미 있던 내역을 반복으로 바꾼 경우: 그 내역 ID를 기억 (내역에서 반복을 다시 끌 수 있게)
  if (srcTx) rule.srcTx = srcTx;
  return rule;
}

/**
 * 이 내역과 연결된 반복 규칙 (없으면 null)
 * - 자동 기록된 내역: ID가 rec-<규칙ID>-<YYYY-MM>
 * - 반복으로 바꾼 원래 내역: 규칙의 srcTx
 */
export function ruleOfTx(rules, txId) {
  if (!txId || !Array.isArray(rules)) return null;
  return rules.find((r) => r.srcTx === txId
    || (isRecurringTxId(txId) && txId.length === `rec-${r.id}-`.length + 7 && txId.startsWith(`rec-${r.id}-`))) || null;
}

/** 반복과 연결된 내역 ID 판별 함수 (목록의 🔁 표시용) */
export function repeatMarker(rules) {
  const src = new Set(rules.map((r) => r.srcTx).filter(Boolean));
  return (id) => isRecurringTxId(id) || src.has(id);
}

/** "매달 반복"으로 저장하면 바로 채워질 지난 달 수 (안내용) */
export function backfillCount(date, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  return dueMonths(ruleFromTx({ date, type: 'expense', amount: 1, category: 'x' }, 'x'), today).length;
}
