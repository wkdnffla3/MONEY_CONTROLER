import assert from 'node:assert/strict';
import { firstBillMonth, payDate, chargesOf, cardBills } from '../src/lib/cards.js';
import { compareMonths, yearReport, searchTx, allTags, calendarMonth, lastPrices, normalizeName } from '../src/lib/analysis.js';
import { isValidTx, isValidTags, isValidCards } from '../src/lib/outbox.js';

// ---------- 카드 ----------
const card = { id: 'c1', name: '신한', payDay: 14, closeDay: 31, color: 0 };    // 말일 마감, 14일 결제
const card2 = { id: 'c2', name: '국민', payDay: 25, closeDay: 10, color: 1 };   // 10일 마감, 25일 결제
assert.equal(firstBillMonth(card, '2026-11-30'), '2026-12');   // 11월 사용 → 12월
assert.equal(firstBillMonth(card, '2026-02-28'), '2026-03');   // 말일 마감은 2월 28일도 포함
assert.equal(firstBillMonth(card2, '2026-11-10'), '2026-12');  // 마감일 당일 → 다음 달
assert.equal(firstBillMonth(card2, '2026-11-11'), '2027-01');  // 마감 다음 날 → 다다음 달 (연도 넘어감)
assert.equal(payDate({ ...card, payDay: 31 }, '2027-02'), '2027-02-28');
// 할부: 100,000원 3개월 → 33,334 / 33,333 / 33,333 (합 = 원금)
const ch = chargesOf({ amount: 100000, inst: 3, date: '2026-11-05' }, card);
assert.deepEqual(ch.map((c) => [c.ym, c.amount, c.index]), [['2026-12', 33334, 1], ['2027-01', 33333, 2], ['2027-02', 33333, 3]]);
assert.equal(ch.reduce((a, c) => a + c.amount, 0), 100000);
assert.equal(chargesOf({ amount: 5000, date: '2026-11-05' }, card).length, 1); // 일시불
const txs = [
  { id: 't1', type: 'expense', amount: 100000, inst: 3, date: '2026-11-05', cardId: 'c1' },
  { id: 't2', type: 'expense', amount: 20000, inst: 1, date: '2026-11-20', cardId: 'c1' },
  { id: 't3', type: 'expense', amount: 7000, inst: 1, date: '2026-11-20', cardId: null },     // 현금 → 제외
  { id: 't4', type: 'income', amount: 9, date: '2026-11-20', cardId: 'c1' },                  // 수입 → 제외
  { id: 't5', type: 'expense', amount: 60000, inst: 2, date: '2026-10-15', cardId: 'c1' },    // 10월 2개월 할부
];
const [b] = cardBills(txs, [card], ['2026-12', '2027-01']);
assert.equal(b.bills[0].date, '2026-12-14');
assert.equal(b.bills[0].total, 33334 + 20000 + 30000);   // t1 1회차 + t2 + t5 2회차
assert.equal(b.bills[1].total, 33333);                   // t1 2회차
assert.equal(b.remaining, 33333);                        // t1 3회차
assert.deepEqual(b.bills[0].items.map((i) => `${i.id}:${i.index}/${i.of}`).sort(), ['t1:1/3', 't2:1/1', 't5:2/2']);

// ---------- 지난달 대비 (진행 중인 달은 같은 날짜까지) ----------
const T = (date, amount, category, extra = {}) => ({ id: date + amount + category, type: 'expense', amount, category, date, ...extra });
const tx2 = [
  T('2026-10-03', 10000, '카페'), T('2026-10-12', 30000, '식비'), T('2026-10-25', 999999, '쇼핑'),  // 10/25는 비교 밖
  T('2026-11-02', 25000, '카페'), T('2026-11-10', 20000, '식비'), T('2026-11-20', 5000, '교통'),   // 11/20은 아직 미래
];
const c = compareMonths(tx2, { y: 2026, m: 11 }, new Date('2026-11-13T12:00:00'));
assert.equal(c.partial, true); assert.equal(c.cutoffDay, 13);
assert.equal(c.curTotal, 45000); assert.equal(c.prevTotal, 40000); assert.equal(c.diff, 5000); assert.equal(c.pct, 13);
assert.deepEqual(c.up.map((x) => [x.name, x.diff, x.pct]), [['카페', 15000, 150]]);
assert.deepEqual(c.down.map((x) => [x.name, x.diff]), [['식비', -10000]]);
const full = compareMonths(tx2, { y: 2026, m: 11 }, new Date('2026-12-20T12:00:00')); // 지난 달을 볼 땐 전체 비교
assert.equal(full.partial, false); assert.equal(full.prevTotal, 1039999); assert.equal(full.curTotal, 50000);
// 3월 31일 기준 → 2월은 28일까지
assert.equal(compareMonths([], { y: 2027, m: 3 }, new Date('2027-03-31T12:00:00')).cutoffDay, 31);

// ---------- 연간 리포트 ----------
const yr = [
  T('2026-01-10', 100000, '식비', { tags: ['명절'] }), T('2026-03-05', 300000, '쇼핑', { cardId: 'c1' }),
  T('2026-03-20', 50000, '식비', { memberId: 'm1', tags: ['명절', '여행'] }),
  { id: 'i1', type: 'income', amount: 1000000, category: '월급', date: '2026-03-25' },
  T('2025-05-01', 200000, '식비'), { id: 'i0', type: 'income', amount: 500000, category: '월급', date: '2025-05-25' },
];
const R = yearReport(yr, 2026, { members: [{ id: 'm1', name: '엄마' }], cards: [card] });
assert.equal(R.exp, 450000); assert.equal(R.inc, 1000000); assert.equal(R.net, 550000); assert.equal(R.rate, 55);
assert.equal(R.months[2].exp, 350000); assert.equal(R.maxMonth.m, 3);
assert.equal(R.expPct, 125); assert.equal(R.incPct, 100);
assert.deepEqual(R.categories.map((x) => [x.name, x.amount]), [['쇼핑', 300000], ['식비', 150000]]);
assert.equal(R.top[0].amount, 300000);
assert.deepEqual(R.byTag.map((x) => [x.name, x.amount]), [['명절', 150000], ['여행', 50000]]);
assert.deepEqual(R.byMember.map((x) => [x.name, x.amount]), [['공동', 400000], ['엄마', 50000]]);
assert.deepEqual(R.byCard.map((x) => [x.name, x.amount]), [['신한', 300000], ['현금·기타', 150000]]);
assert.equal(R.count, 4);

// ---------- 검색 ----------
const S = searchTx(yr, { from: '2026-01-01', to: '2026-12-31', type: 'expense', tags: ['명절'] });
assert.equal(S.count, 2); assert.equal(S.exp, 150000); assert.equal(S.list[0].date, '2026-03-20'); // 최신순
assert.equal(searchTx(yr, { min: 100000, max: 300000, type: 'expense' }).count, 3);
assert.equal(searchTx(yr, { card: 'c1' }).count, 1);
assert.equal(searchTx(yr, { card: 'cash', type: 'expense' }).count, 3);
assert.equal(searchTx(yr, { who: 'm1' }, [{ id: 'm1', name: '엄마' }]).count, 1);
assert.equal(searchTx(yr, { q: '엄마' }, [{ id: 'm1', name: '엄마' }]).count, 1);   // 사람 이름으로도
assert.equal(searchTx(yr, { q: '여행' }).count, 1);                                 // 태그로도
assert.equal(searchTx(yr, { categories: ['식비', '쇼핑'], from: '2026-03-01' }).count, 2);
assert.deepEqual(allTags(yr), ['명절', '여행']);

// ---------- 달력 ----------
const cal = calendarMonth([T('2026-11-01', 5000, '식비'), T('2026-11-01', 3000, '카페'), T('2026-11-30', 1, '기타')], { y: 2026, m: 11 });
assert.equal(cal.weeks[0][0].day, 1);              // 2026-11-01은 일요일 → 첫 칸
assert.equal(cal.weeks[0][0].exp, 8000); assert.equal(cal.weeks[0][0].count, 2);
assert.equal(cal.maxExp, 8000);
assert.ok(cal.weeks.every((w) => w.length === 7));
const cal2 = calendarMonth([], { y: 2026, m: 12 });   // 12/1은 화요일 → 앞에 빈칸 2개
assert.equal(cal2.weeks[0][0], null); assert.equal(cal2.weeks[0][2].day, 1);

// ---------- 지난 구매가 ----------
const bought = (name, paid, qty, boughtAt, status = 'bought') => ({ name, paid, qty, boughtAt, status });
const LP = lastPrices([bought('우유', 5000, 2, '2026-10-01'), bought(' 우 유', 2800, 1, '2026-11-02'), bought('계란', 7900, 1, '2026-11-01'), bought('빵', 3000, 1, '2026-11-05', 'todo')]);
assert.deepEqual(LP[normalizeName('우유')].unit, 2800);   // 띄어쓰기 달라도 같은 물품, 최근 것
assert.equal(LP[normalizeName('계란')].unit, 7900);
assert.equal(LP[normalizeName('빵')], undefined);         // 아직 안 산 건 제외
assert.equal(lastPrices([bought('휴지', 25000, 2, '2026-11-01')])['휴지'].unit, 12500); // 단가 = 결제액/수량

// ---------- 검증 ----------
const good = { type: 'expense', amount: 1000, category: '식비', memo: '', date: '2026-11-12' };
assert.equal(isValidTx({ ...good, tags: ['여행'], cardId: 'c1', inst: 3 }), true);
for (const bad of [{ tags: ['a', 'a'] }, { tags: ['1', '2', '3', '4', '5', '6'] }, { tags: ['x'.repeat(13)] }, { tags: [''] }, { inst: 0 }, { inst: 37 }, { inst: 1.5 }, { cardId: 3 }])
  assert.equal(isValidTx({ ...good, ...bad }), false, JSON.stringify(bad));
assert.equal(isValidTags([]), true);
assert.equal(isValidCards([card, card2]), true);
for (const bad of [[card, card], [{ ...card, payDay: 0 }], [{ ...card, closeDay: 32 }], [{ ...card, name: '' }], [{ ...card, name: 'x'.repeat(17) }]])
  assert.equal(isValidCards(bad), false);
console.log('analysis unit tests: all passed');
