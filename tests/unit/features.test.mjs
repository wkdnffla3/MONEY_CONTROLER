import { leftLedger } from '../../src/lib/leftLedger.js';
import assert from 'node:assert/strict';
import { planRecurring, dueMonths, occurrenceDate, recurringTxId, nextDate, ruleFromTx, backfillCount, resumeRule, ruleOfTx, repeatMarker } from '../../src/lib/recurring.js';
import { csvCell, toCsv } from '../../src/lib/csv.js';
import { planPurchase, summarize as shopSummary, defaultMemo, groupHistory, isShoppingTxId } from '../../src/lib/shopping.js';
import { isValidItem, sameTarget, isValidRecurring, isValidTx, isValidCategories, isValidCatBudgets, isValidOp, coalesce, applyQueue, EMPTY_STATE } from '../../src/lib/outbox.js';

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
// 새 내역을 "매달 반복"으로: 그 날짜의 일마다, 그 달은 이미 입력했으니 다음 달부터
{
  const d = { type: 'expense', amount: 55000, category: '주거·통신', memo: '통신비', date: '2026-11-18', memberId: 'm1', tags: ['고정'], cardId: 'c1', inst: 1 };
  const r = ruleFromTx(d, 'abc');
  assert.deepEqual(r, { id: 'abc', type: 'expense', amount: 55000, category: '주거·통신', memo: '통신비', memberId: 'm1', day: 18, start: '2026-11', end: null, last: '2026-11', active: true, cardId: 'c1', tags: ['고정'] }); // 카드·태그도 이어감 (2026-11-24)
  assert.ok(isValidRecurring([r]));
  const nov = new Date(2026, 10, 30);
  assert.equal(planRecurring([r], nov).changed, false); // 같은 달은 다시 안 만듦
  const { txs } = planRecurring([r], new Date(2026, 11, 18));
  assert.deepEqual(txs.map((t) => t.id), [recurringTxId('abc', '2026-12')]);
  assert.equal(txs[0].data.date, '2026-12-18');
  // 31일 → 2월은 말일
  assert.equal(planRecurring([ruleFromTx({ ...d, date: '2027-01-31' }, 'e')], new Date(2027, 1, 28)).txs[0].data.date, '2027-02-28');
  // 지난달 날짜로 넣으면 빠진 달 수
  assert.equal(backfillCount('2026-11-18', new Date(2026, 10, 18)), 0);
  assert.equal(backfillCount('2026-09-05', new Date(2026, 10, 18)), 2); // 10월·11월(5일 지남)
  assert.equal(backfillCount('2026-09-25', new Date(2026, 10, 18)), 1); // 10월만 (11월 25일은 아직)
  assert.equal(backfillCount('2026-12-01', new Date(2026, 10, 18)), 0); // 앞날짜
  assert.equal(backfillCount('', new Date()), 0);
}
// 일시정지 후 다시 시작: 멈춘 달은 건너뜀
{
  const base = { id: 'p', type: 'expense', amount: 13500, category: '문화·여가', memo: '', memberId: null, start: '2026-01', end: null, last: '2026-08', active: false };
  const today = new Date(2026, 10, 18); // 11월 18일
  assert.equal(resumeRule({ ...base, day: 5 }, today).last, '2026-11'); // 이번 달 5일은 지남
  assert.equal(resumeRule({ ...base, day: 25 }, today).last, '2026-10'); // 25일은 아직
  assert.equal(resumeRule({ ...base, day: 18 }, today).last, '2026-11'); // 오늘이 그날 → 지난 것으로
  assert.equal(resumeRule({ ...base, day: 5, last: '2026-12' }, today).last, '2026-12'); // 이미 더 뒤면 그대로
  assert.equal(resumeRule({ ...base, day: 5, last: null }, today).last, '2026-11');
  assert.equal(resumeRule({ ...base, day: 31, last: '2026-01' }, new Date(2026, 1, 28)).last, '2026-02'); // 31일 규칙, 2월 28일 = 그달 말일 → 지난 것으로
  const r = resumeRule({ ...base, day: 25 }, today);
  assert.equal(r.active, true);
  assert.deepEqual(dueMonths(r, today), []);
  assert.deepEqual(dueMonths(r, new Date(2026, 10, 25)).map((x) => x.date), ['2026-11-25']);
  assert.deepEqual(dueMonths(resumeRule({ ...base, day: 5 }, today), new Date(2026, 11, 5)).map((x) => x.date), ['2026-12-05']);
}
// 내역에서 반복 켜기·끄기: 내역 ↔ 규칙 연결
{
  const d = { type: 'expense', amount: 9900, category: '문화·여가', memo: '구독', date: '2026-10-07', memberId: null };
  const a = ruleFromTx(d, 'ab', 'tx-old');
  const b = ruleFromTx(d, 'ab-c');
  assert.equal(a.srcTx, 'tx-old');
  assert.equal('srcTx' in b, false);
  assert.ok(isValidRecurring([a, b]));
  assert.equal(isValidRecurring([{ ...a, srcTx: 5 }]), false);
  assert.equal(ruleOfTx([a, b], 'tx-old'), a);
  assert.equal(ruleOfTx([a, b], 'rec-ab-c-2026-11'), b); // 규칙 ID에 - 가 있어도 정확히
  assert.equal(ruleOfTx([a, b], 'rec-ab-2026-11'), a);
  assert.equal(ruleOfTx([a, b], 'rec-zz-2026-11'), null); // 지운 규칙의 자동 내역
  assert.equal(ruleOfTx([a, b], 'other'), null);
  const mark = repeatMarker([a, b]);
  assert.ok(mark('tx-old') && mark('rec-zz-2026-11') && !mark('other'));
}
// 공유 가계부에서 나가거나 내보내지면 그 가계부 사본만 지움
{
  const U = 'u', S = 's', T = 't';
  assert.equal(leftLedger(U, { ledgerId: S }, { ledgerId: U }), S);
  assert.equal(leftLedger(U, { ledgerId: S }, null), S);
  assert.equal(leftLedger(U, { ledgerId: S }, { ledgerId: S }), null);
  assert.equal(leftLedger(U, { ledgerId: U }, { ledgerId: S }), null); // 참여: 내 가계부는 그대로
  assert.equal(leftLedger(U, null, { ledgerId: S }), null);
  assert.equal(leftLedger(U, { ledgerId: S }, { ledgerId: T }), S);
}
// 반복 내역 카드·태그 (2026-11-24)
{
  const rule = { id: 'c1', type: 'expense', amount: 17000, category: '문화·여가', memo: '넷플릭스', memberId: null, day: 10, start: '2026-10', end: null, last: '2026-10', active: true, cardId: 'k1', tags: ['구독'] };
  assert.ok(isValidRecurring([rule]));
  assert.equal(isValidRecurring([{ ...rule, tags: ['a', 'a'] }]), false);
  assert.equal(isValidRecurring([{ ...rule, cardId: 5 }]), false);
  const p = planRecurring([rule], new Date(2026, 10, 18));
  assert.deepEqual([p.txs[0].data.cardId, p.txs[0].data.tags, p.txs[0].data.inst], ['k1', ['구독'], 1]);
  assert.ok(isValidTx(p.txs[0].data));
  // 수입이면 카드 없음, 예전 규칙(카드·태그 없음)도 그대로
  const inc = planRecurring([{ ...rule, type: 'income' }], new Date(2026, 10, 18)).txs[0].data;
  assert.equal(inc.cardId, null);
  const old = planRecurring([{ ...rule, cardId: undefined, tags: undefined }], new Date(2026, 10, 18)).txs[0].data;
  assert.deepEqual([old.cardId, old.tags], [null, []]);
  // 내역 → 규칙: 카드·태그 이어감
  const r2 = ruleFromTx({ type: 'expense', amount: 1, category: '식비', memo: '', date: '2026-11-03', cardId: 'k1', tags: ['x'] }, 'z');
  assert.deepEqual([r2.cardId, r2.tags], ['k1', ['x']]);
  const r3 = ruleFromTx({ type: 'expense', amount: 1, category: '식비', memo: '', date: '2026-11-03', cardId: null, tags: [] }, 'z');
  assert.equal('cardId' in r3 || 'tags' in r3, false);
}
console.log('feature unit tests: all passed');
// 예산: 이번 달 남은 날에 기록될 반복 지출
{
  const { upcomingThisMonth } = await import('../../src/lib/recurring.js');
  const r = (id, o) => ({ id, type: 'expense', amount: 1000, category: '식비', memo: '', memberId: null, day: 25, start: '2026-01', end: null, last: '2026-10', active: true, ...o });
  const today = new Date(2026, 10, 18);
  const up = upcomingThisMonth([
    r('a'), r('b', { day: 10 }), r('c', { last: '2026-11' }), r('d', { active: false }), r('e', { type: 'income' }),
    r('f', { start: '2026-12' }), r('g', { end: '2026-10' }), r('h', { day: 31 }),
  ], today);
  assert.deepEqual(up.map((x) => [x.rule.id, x.date]), [['a', '2026-11-25'], ['h', '2026-11-30']]);
}
console.log('upcoming ok');

// 한 건으로 합치기: 물품별 몫의 합 = 결제 금액 (결제 금액이 물품 수보다 작아도), 0원 몫은 paid 없음
{
  const { splitTotal } = await import('../../src/lib/shopping.js');
  assert.deepEqual(splitTotal(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(splitTotal(10, [0, 0]), [5, 5]);
  assert.deepEqual(splitTotal(7, [5000, 6000, 4000]).reduce((a, b) => a + b, 0), 7);
  assert.deepEqual(splitTotal(0, [1, 2]), [0, 0]);
  assert.deepEqual(splitTotal(5, []), []);
  const many = Array.from({ length: 12 }, (_, k) => it('m' + k, { price: 1000 }));
  const p = planPurchase(many, { purchaseId: 'P9', mode: 'combined', date: '2026-11-27', category: '식비', total: 10, amounts: {} });
  assert.equal(p.items.reduce((a, x) => a + (x.data.paid || 0), 0), 10);
  assert.equal(p.items.filter((x) => x.data.paid === null).length, 2);
  assert.ok(p.items.every((x) => x.data.paid === null || x.data.paid >= 1));
  // 큰 금액도 합이 정확히 맞음
  const p2 = planPurchase(many.slice(0, 3), { purchaseId: 'P10', mode: 'combined', date: '2026-11-27', category: '식비', total: 9_999_999_999, amounts: {} });
  assert.equal(p2.items.reduce((a, x) => a + x.data.paid, 0), 9_999_999_999);
  console.log('purchase split tests: all passed');
}

// 글자 수로 자를 때 이모지를 반으로 자르지 않음 (반쪽 이모지는 서버가 거절 → 저장 실패)
{
  const { clipText } = await import('../../src/lib/format.js');
  const { isValidTags } = await import('../../src/lib/outbox.js');
  assert.equal(clipText('여행여행여행여행여행여🎉', 12), '여행여행여행여행여행여');
  assert.equal(clipText('여행여행여행여행여행🎉', 12), '여행여행여행여행여행🎉');
  assert.equal(clipText('abc', 12), 'abc');
  assert.equal(clipText(null, 5), '');
  const tag = clipText('가나다라마바사아자차카🎉', 12);
  assert.ok(!/[\uD800-\uDBFF]$/.test(tag) && isValidTags([tag]));
  console.log('clip text tests: all passed');
}

// 오류 안내: 앱이 만든 한국어 오류는 그대로, DB 제약 위반은 할 일 안내, 모르는 오류는 원문과 함께
{
  const { koError } = await import('../../src/lib/errors.js');
  assert.equal(koError(Object.assign(new Error('저장할 수 없는 값이 있어요. 입력값을 확인해 주세요.'), { code: 'invalid_op' })), '저장할 수 없는 값이 있어요. 입력값을 확인해 주세요.');
  assert.equal(koError({ code: '23514', message: 'new row for relation "transactions" violates check constraint "transactions_memo_len"' }), '저장할 수 없는 값이 있어요. 글자 수·금액을 확인해 주세요.');
  assert.equal(koError({ code: '22008', message: 'date/time field value out of range: "2026-02-30"' }), '형식이 맞지 않는 값이 있어요. 날짜·금액을 확인해 주세요.');
  assert.equal(koError(new Error('Failed to fetch')), '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  assert.equal(koError(new Error('boom')), '문제가 생겼어요: boom');
  console.log('error text tests: all passed');
}
