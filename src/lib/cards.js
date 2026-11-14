/**
 * 신용카드 결제일 · 할부 계산
 *
 * 카드 { id, name, payDay(결제일 1~31), closeDay(이용 마감일 1~31, 31=말일), color }
 * - M월 1일 ~ M월 마감일에 쓴 금액 → M+1월 결제일에 청구
 * - 마감일 다음 날 ~ 월말에 쓴 금액 → M+2월 결제일에 청구
 *   (예: 마감일 말일·결제일 14일 → 11월 사용분이 12월 14일에 청구)
 * - 할부 N개월: 첫 청구월부터 N개월 동안 나눠 청구. 나누어떨어지지 않는 원 단위는 첫 달에 더함
 *   (실제 카드사 할부 수수료는 계산하지 않음)
 * 가계부 지출은 산 날에 전액으로 잡히고, 여기서는 "언제 얼마가 빠져나가는지"만 계산함.
 */
import { daysInMonth, pad } from './format.js';

const toNum = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
const toYm = (n) => `${Math.floor(n / 12)}-${pad((n % 12) + 1)}`;
export const addMonths = (ym, k) => toYm(toNum(ym) + k);
export const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24, 36];

/** 첫 청구월 (YYYY-MM) */
export function firstBillMonth(card, date) {
  const [y, m, d] = date.split('-').map(Number);
  const close = Math.min(card.closeDay, daysInMonth(y, m));
  return addMonths(`${y}-${pad(m)}`, d <= close ? 1 : 2);
}

/** 청구 날짜 (그 달에 결제일이 없으면 말일) */
export function payDate(card, ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(Math.min(card.payDay, daysInMonth(y, m)))}`;
}

/** 한 내역의 청구 일정 [{ ym, amount, index, of }] */
export function chargesOf(tx, card) {
  const n = Math.max(1, tx.inst || 1);
  const base = Math.floor(tx.amount / n);
  const first = tx.amount - base * (n - 1);
  const start = firstBillMonth(card, tx.date);
  return Array.from({ length: n }, (_, i) => ({ ym: addMonths(start, i), amount: i === 0 ? first : base, index: i + 1, of: n }));
}

/**
 * 카드별 청구 요약.
 * months: 보여줄 청구월 목록 (예: [이번 달, 다음 달])
 * 반환: [{ card, bills: [{ ym, date, total, items:[{ id, tx, amount, index, of }] }], remaining }]
 *  - remaining: 마지막으로 보여주는 달 이후에 남은 할부 금액
 */
export function cardBills(txList, cards, months) {
  const last = months.length ? toNum(months[months.length - 1]) : -Infinity;
  return cards.map((card) => {
    const bills = months.map((ym) => ({ ym, date: payDate(card, ym), total: 0, items: [] }));
    const byYm = new Map(bills.map((b) => [b.ym, b]));
    let remaining = 0;
    for (const t of txList) {
      if (t.type === 'income' || t.cardId !== card.id) continue;
      for (const c of chargesOf(t, card)) {
        const b = byYm.get(c.ym);
        if (b) { b.total += c.amount; b.items.push({ id: t.id, tx: t, amount: c.amount, index: c.index, of: c.of }); }
        else if (toNum(c.ym) > last) remaining += c.amount;
      }
    }
    for (const b of bills) b.items.sort((x, y) => (x.tx.date < y.tx.date ? -1 : 1));
    return { card, bills, remaining };
  });
}
