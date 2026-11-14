import assert from 'node:assert/strict';
import { planRecurring, dueMonths, occurrenceDate, recurringTxId, nextDate } from '../../src/lib/recurring.js';
import { csvCell, toCsv } from '../../src/lib/csv.js';
import { planPurchase, summarize as shopSummary, defaultMemo, groupHistory, isShoppingTxId } from '../../src/lib/shopping.js';
import { isValidItem, sameTarget, isValidRecurring, isValidCategories, isValidCatBudgets, isValidOp, coalesce, applyQueue, EMPTY_STATE } from '../../src/lib/outbox.js';

const D = (s) => new Date(`${s}T12:00:00`);
const rule = (o = {}) => ({ id: 'r1', type: 'expense', amount: 500000, category: '주거·통신', memo: '월세', memberId: null,
  day: 25, start: '2026-09', end: null, last: null, active: true, ...o });

// ---- 반복: 날짜 계산 ----
assert.equal(occurrenceDate('2026-02', 31), '2026-02-28');
assert.equal(occurrenceDate('2028-02', 31), '2028-02-29'); // 윤년
assert.equal(occurrenceDate('2026-04', 31), '2026-04-30');
assert.equal(occurrenceDate('2026-11', 5), '2026-11-05');

// 오늘 11/13, 매달 25일, 9월 시작 → 9월·10월만 (11월 25일은 아직)
assert.deepEqual(dueMonths(rule(), D('2026-11-13')).map((x) => x.ym), ['2026-09', '2026-10']);
// 11/25 당일엔 11월도
assert.deepEqual(dueMonths(rule(), D('2026-11-25')).map((x) => x.ym), ['2026-09', '2026-10', '2026-11']);
// 이미 10월까지 등록 → 11월만 (날짜 된 후)
assert.deepEqual(dueMonths(rule({ last: '2026-10' }), D('2026-11-13')), []);
assert.deepEqual(dueMonths(rule({ last: '2026-10' }), D('2026-11-26')).map((x) => x.ym), ['2026-11']);
// 일시정지·종료
assert.deepEqual(dueMonths(rule({ active: false }), D('2026-11-30')), []);
assert.deepEqual(dueMonths(rule({ end: '2026-09' }), D('2026-11-30')).map((x) => x.ym), ['2026-09']);
// 연말 넘어감
assert.deepEqual(dueMonths(rule({ start: '2026-11', day: 1 }), D('2027-02-01')).map((x) => x.ym), ['2026-11', '2026-12', '2027-01', '2027-02']);
// 오래 안 열었을 때 최대 24개월만
assert.equal(dueMonths(rule({ start: '2020-01', day: 1 }), D('2026-11-13')).length, 24);

// ---- 반복: 계획 → 고정 ID, last 갱신, 두 번 돌려도 추가 없음 ----
const p1 = planRecurring([rule()], D('2026-11-13'));
assert.deepEqual(p1.txs.map((t) => t.id), [recurringTxId('r1', '2026-09'), recurringTxId('r1', '2026-10')]);
assert.equal(p1.txs[0].data.date, '2026-09-25');
assert.equal(p1.rules[0].last, '2026-10');
const p2 = planRecurring(p1.rules, D('2026-11-13'));
assert.equal(p2.changed, false); assert.equal(p2.txs.length, 0);
// 두 기기가 같은 시점에 계획 → 완전히 같은 ID·내용 (upsert라 서버엔 한 줄)
const pA = planRecurring([rule()], D('2026-11-13')), pB = planRecurring([rule()], D('2026-11-13'));
assert.deepEqual(pA.txs, pB.txs);
// 다음 예정일
assert.equal(nextDate(rule({ last: '2026-10' }), D('2026-11-13')), '2026-11-25');
assert.equal(nextDate(rule({ last: '2026-11' }), D('2026-11-26')), '2026-12-25');
assert.equal(nextDate(rule({ last: '2026-11', end: '2026-11' }), D('2026-11-26')), null);
assert.equal(nextDate(rule({ start: '2027-03', day: 31 }), D('2026-11-13')), '2027-03-31');

// ---- CSV ----
assert.equal(csvCell('점심'), '점심');
assert.equal(csvCell('a,b'), '"a,b"');
assert.equal(csvCell('그는 "좋다"고'), '"그는 ""좋다""고"');
assert.equal(csvCell('줄\n바꿈'), '"줄\n바꿈"');
assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`); // 수식 실행 방지
assert.equal(csvCell('+82'), "'+82"); assert.equal(csvCell('-5'), "'-5"); assert.equal(csvCell('@sum'), "'@sum");
assert.equal(csvCell(-5000), '-5000'); // 숫자는 그대로
assert.equal(csvCell(null), '');
const csv = toCsv(['날짜', '금액'], [['2026-11-01', 12000]]);
assert.ok(csv.startsWith('﻿날짜,금액\r\n2026-11-01,12000'));

// ---- 검증 ----
assert.equal(isValidRecurring([rule()]), true);
for (const bad of [[rule({ day: 0 })], [rule({ day: 32 })], [rule({ start: '2026-13' })], [rule({ amount: 0 })],
  [rule({ active: 'yes' })], [rule(), rule()], [rule({ memberId: 3 })], 'x']) assert.equal(isValidRecurring(bad), false);
const C = { expense: [{ name: '식비', icon: '🍚' }], income: [{ name: '월급', icon: '💼' }] };
assert.equal(isValidCategories(C), true); assert.equal(isValidCategories(null), true);
for (const bad of [{ expense: [], income: C.income }, { expense: [{ name: '식비', icon: '🍚' }, { name: '식비', icon: '🍜' }], income: C.income },
  { expense: [{ name: 'x'.repeat(21), icon: '🍚' }], income: C.income }, { expense: C.expense }, 5]) assert.equal(isValidCategories(bad), false);
assert.equal(isValidCatBudgets({ 식비: 400000 }), true); assert.equal(isValidCatBudgets({}), true);
for (const bad of [{ 식비: 0 }, { 식비: -1 }, { 식비: 1.5 }, [], null]) assert.equal(isValidCatBudgets(bad), false);
assert.equal(isValidOp({ opId: 'a', kind: 'recurring', value: [rule()] }), true);
assert.equal(isValidOp({ opId: 'a', kind: 'catBudgets', value: { 식비: -1 } }), false);
// 설정 종류별로 따로 합쳐짐 + 적용
let q = coalesce([], { opId: '1', kind: 'recurring', value: [rule()] });
q = coalesce(q, { opId: '2', kind: 'categories', value: C });
q = coalesce(q, { opId: '3', kind: 'recurring', value: [] });
assert.deepEqual(q.map((o) => o.kind), ['categories', 'recurring']);
const st = applyQueue(EMPTY_STATE, q);
assert.deepEqual(st.recurring, []); assert.equal(st.categories, C); assert.deepEqual(st.catBudgets, {});
// ---- 장보기 ----
const it = (id, o = {}) => ({ id, name: id, qty: 1, price: 0, category: '식비', memberId: null, memo: '', checked: true, status: 'todo', paid: null, txId: null, boughtAt: null, createdAt: 1, ...o });
const A1 = it('우유', { price: 2500, qty: 2 }), B1 = it('계란', { price: 6000 }), C1 = it('휴지', { category: '생활용품' });
assert.equal(defaultMemo([A1, B1, C1]), '장보기: 우유 외 2개'); assert.equal(defaultMemo([A1]), '장보기: 우유');
assert.deepEqual(shopSummary([A1, { ...B1, checked: false }, { ...C1, status: 'bought' }]), { todo: 2, todoSum: 11000, cart: 1, cartSum: 5000, unpriced: 0 });
// 합치기: 내역 1건, ID = shop-<결제ID>, 물품 3개 모두 구매 완료 + 같은 txId, 물품 금액 합 = 결제액
const pc = planPurchase([A1, B1, C1], { purchaseId: 'P1', mode: 'combined', date: '2026-11-13', category: '식비', memberId: null, total: 15000, amounts: { 우유: 5000, 계란: 6000, 휴지: 4000 }, now: 5 });
assert.equal(pc.txs.length, 1); assert.equal(pc.txs[0].id, 'shop-P1'); assert.equal(pc.txs[0].data.amount, 15000);
assert.equal(pc.txs[0].data.memo, '장보기: 우유 외 2개'); assert.equal(isShoppingTxId(pc.txs[0].id), true);
assert.ok(pc.items.every((x) => x.data.status === 'bought' && x.data.txId === 'shop-P1' && !x.data.checked && x.data.boughtAt === '2026-11-13'));
assert.equal(pc.items.reduce((a, x) => a + x.data.paid, 0), 15000);
// 영수증 합계가 물품 합과 달라도(할인) 나눈 금액 합이 정확히 결제액
const pc2 = planPurchase([A1, B1, C1], { purchaseId: 'P2', mode: 'combined', date: '2026-11-13', category: '식비', total: 13999, amounts: { 우유: 5000, 계란: 6000, 휴지: 4000 } });
assert.equal(pc2.items.reduce((a, x) => a + x.data.paid, 0), 13999);
// 나누기: 물품마다 내역, ID = shop-<물품ID> (같은 물품을 다시 확정해도 같은 ID), 각자 카테고리
const ps = planPurchase([A1, C1], { purchaseId: 'X', mode: 'separate', date: '2026-11-13', amounts: { 우유: 5000, 휴지: 4000 } });
assert.deepEqual(ps.txs.map((t) => [t.id, t.data.amount, t.data.category]), [['shop-우유', 5000, '식비'], ['shop-휴지', 4000, '생활용품']]);
assert.equal(ps.txs[0].data.memo, '장보기: 우유 ×2');
const ps2 = planPurchase([A1, C1], { purchaseId: 'Y', mode: 'separate', date: '2026-11-13', amounts: { 우유: 5000, 휴지: 4000 } });
assert.deepEqual(ps2.txs.map((t) => t.id), ps.txs.map((t) => t.id)); // 결제ID가 달라도 같은 ID → 중복 없음
// 구매 기록 묶기
const hist = groupHistory([...pc.items.map((x) => x.data), ...ps.items.map((x) => ({ ...x.data, boughtAt: '2026-11-14' }))]);
assert.equal(hist.length, 3); assert.equal(hist[0].date, '2026-11-14'); assert.equal(hist.find((g) => g.txId === 'shop-P1').total, 15000);
// 검증·대상 구분
assert.equal(isValidItem(A1), true);
for (const bad of [{ ...A1, name: '' }, { ...A1, qty: 0 }, { ...A1, qty: 1000 }, { ...A1, price: -1 }, { ...A1, status: 'x' }, { ...A1, checked: 'y' }, { ...A1, boughtAt: '11/13' }])
  assert.equal(isValidItem(bad), false);
assert.equal(sameTarget({ kind: 'item', id: 'z' }, { kind: 'upsert', id: 'z' }), false); // 물품과 내역은 ID가 같아도 다른 대상
assert.equal(sameTarget({ kind: 'item', id: 'z' }, { kind: 'itemDel', id: 'z' }), true);
console.log('feature unit tests: all passed');
