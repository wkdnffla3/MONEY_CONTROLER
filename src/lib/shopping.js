import { MAX_MEMO } from './outbox.js';
/**
 * 장보기 목록 → 가계부 연동
 *
 * 물품 { name, qty, price(예상 단가, 0=미정), category, memberId, memo, checked(장바구니에 담음),
 *        status: 'todo'|'bought', paid(실제 결제액), txId(연결된 가계부 내역), boughtAt, createdAt }
 *
 * 결제 확정 시 중복 방지
 *  - 한 건으로 합치기: 내역 ID = "shop-<결제ID>" (결제ID는 확정 버튼을 누를 때 한 번 만들어짐)
 *  - 물품별로 나누기: 내역 ID = "shop-<물품ID>" (물품은 한 번만 구매 처리되므로 고정)
 *  → 오프라인 재전송, 응답 유실, 두 번 누르기에도 서버에는 같은 ID로 한 번만 저장됨.
 *  - 확정과 동시에 물품이 '구매 완료'로 바뀌어 다시 확정 대상에 들어가지 않음.
 */
export const MAX_ITEM_NAME = 40;
export const MAX_QTY = 999;

export const SHOP_TX_PREFIX = 'shop-';
export const isShoppingTxId = (id) => typeof id === 'string' && id.startsWith(SHOP_TX_PREFIX);

/** 예상 금액 = 단가 × 수량 (단가 미정이면 0) */
export const expectedTotal = (item) => (item.price || 0) * (item.qty || 1);

export function summarize(items) {
  let todo = 0, todoSum = 0, cart = 0, cartSum = 0, unpriced = 0;
  for (const i of items) {
    if (i.status !== 'todo') continue;
    todo += 1; todoSum += expectedTotal(i);
    if (!i.price) unpriced += 1;
    if (i.checked) { cart += 1; cartSum += expectedTotal(i); }
  }
  return { todo, todoSum, cart, cartSum, unpriced };
}

/** 가계부 메모 기본값: "장보기: 우유 외 2개" */
export function defaultMemo(items) {
  if (!items.length) return '장보기';
  const first = items[0].name;
  return items.length === 1 ? `장보기: ${first}` : `장보기: ${first} 외 ${items.length - 1}개`;
}

/**
 * 결제 확정 계획.
 * opts: { purchaseId, mode:'combined'|'separate', date, category, memberId, memo, total, amounts:{물품ID:금액} }
 * 반환: { txs:[{id,data}], items:[{id,data}] }
 */
export function planPurchase(items, opts) {
  const { purchaseId, mode, date, now = Date.now() } = opts;
  const txs = [];
  const updated = [];
  if (mode === 'combined') {
    const txId = `${SHOP_TX_PREFIX}${purchaseId}`;
    txs.push({
      id: txId,
      data: {
        type: 'expense', amount: opts.total, category: opts.category,
        memo: (opts.memo || defaultMemo(items)).slice(0, MAX_MEMO), date, memberId: opts.memberId ?? null, createdAt: now,
        cardId: opts.cardId ?? null, inst: 1, // 결제 카드 (일시불)
      },
    });
    // 합계를 물품별 금액 비율로 나눠 기록(구매 기록 표시용). 합이 항상 결제 금액과 정확히 같게 (최대 잔여 방식).
    // 결제 금액이 물품 수보다 작아 0원이 되는 물품은 paid 를 비움(null) — 1원씩 억지로 주면 합이 결제 금액보다 커짐
    const shares = splitTotal(opts.total, items.map((i) => opts.amounts?.[i.id] || expectedTotal(i)));
    items.forEach((i, k) => {
      updated.push({ id: i.id, data: { ...i, status: 'bought', checked: false, paid: shares[k] > 0 ? shares[k] : null, txId, boughtAt: date } });
    });
  } else {
    items.forEach((i, k) => {
      const txId = `${SHOP_TX_PREFIX}${i.id}`;
      const amount = opts.amounts[i.id];
      txs.push({
        id: txId,
        data: {
          type: 'expense', amount, category: i.category,
          memo: `장보기: ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`.slice(0, MAX_MEMO), date,
          memberId: i.memberId ?? opts.memberId ?? null, createdAt: now + k,
          cardId: opts.cardId ?? null, inst: 1,
        },
      });
      updated.push({ id: i.id, data: { ...i, status: 'bought', checked: false, paid: amount, txId, boughtAt: date } });
    });
  }
  return { txs, items: updated };
}

/** total 을 weights 비율로 나눈 정수 목록. 합 = total (weights 가 모두 0이면 똑같이) */
export function splitTotal(total, weights) {
  if (!weights.length) return [];
  const sum = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const w = sum ? weights.map((x) => (x > 0 ? x : 0)) : weights.map(() => 1);
  const wSum = sum || weights.length;
  const raw = w.map((x) => (total * x) / wSum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return out;
}

/** 구매 기록을 결제(가계부 내역)별로 묶기, 최근 것 먼저 */
export function groupHistory(items) {
  const groups = new Map();
  for (const i of items) {
    if (i.status !== 'bought') continue;
    const key = i.txId || `solo-${i.id}`;
    if (!groups.has(key)) groups.set(key, { key, txId: i.txId, date: i.boughtAt || '', items: [], total: 0 });
    const g = groups.get(key);
    g.items.push(i); g.total += i.paid || 0;
  }
  return [...groups.values()].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}
