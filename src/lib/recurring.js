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
