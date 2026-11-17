import assert from 'node:assert/strict';
import { coalesce, applyQueue, removeOp, isRetryable, isValidOp, isValidTx, isValidMembers, isSchemaError } from '../src/lib/outbox.js';
import { summarizeByMember, filterByOwner, sharePercents, SHARED } from '../src/lib/members.js';
let q = [];
const up = (id, memo, opId) => ({ opId, kind: 'upsert', id, data: { memo } });
q = coalesce(q, up('a', 'v1', 1));
q = coalesce(q, up('a', 'v2', 2));            // 같은 내역 두 번 수정 → 마지막만
assert.equal(q.length, 1); assert.equal(q[0].data.memo, 'v2');
q = coalesce(q, up('b', 'x', 3));
q = coalesce(q, { opId: 4, kind: 'delete', id: 'a' }); // 추가 후 삭제 → 삭제만
assert.deepEqual(q.map(o => [o.kind, o.id]), [['upsert', 'b'], ['delete', 'a']]);
q = coalesce(q, up('a', 'restored', 5));      // 되돌리기 → 삭제 대신 다시 저장
assert.deepEqual(q.map(o => [o.kind, o.id]), [['upsert', 'b'], ['upsert', 'a']]);
q = coalesce(q, { opId: 6, kind: 'budget', value: 1 });
q = coalesce(q, { opId: 7, kind: 'budget', value: 2 });
assert.equal(q.filter(o => o.kind === 'budget').length, 1);
const v = applyQueue({ tx: { a: { memo: 'server' }, z: { memo: 'keep' } }, budget: 0, members: [] }, q);
assert.equal(v.tx.a.memo, 'restored'); assert.equal(v.tx.z.memo, 'keep'); assert.equal(v.budget, 2);
assert.equal(removeOp(q, 999).length, q.length); // 이미 합쳐져 없어진 작업 제거는 무시
assert.equal(isRetryable({ message: 'TypeError: Failed to fetch' }), true);
assert.equal(isRetryable({ message: 'JWT expired', code: 'PGRST301' }), true);
assert.equal(isRetryable({ message: 'x', status: 503 }), true);
assert.equal(isRetryable({ message: 'violates check constraint', code: '23514' }), false);
assert.equal(isRetryable({ message: 'new row violates row-level security policy', code: '42501' }), true); // 로그인 만료 → 보존 후 재시도
assert.equal(isRetryable({ message: 'value out of range', code: '22003' }), false);
const good = { type: 'expense', amount: 1000, category: '식비', memo: '', date: '2026-11-12' };
assert.equal(isValidTx(good), true);
for (const bad of [null, 5, {}, { ...good, type: 'x' }, { ...good, amount: 0 }, { ...good, amount: 1e16 }, { ...good, amount: 1.5 },
  { ...good, category: '' }, { ...good, memo: 'x'.repeat(101) }, { ...good, date: '2026/11/12' }]) assert.equal(isValidTx(bad), false);
assert.equal(isValidOp({ opId: 'a', kind: 'upsert', id: 't1', data: good }), true);
for (const bad of [null, 5, {kind:'upsert'}, { opId: 'a', kind: 'upsert', id: 't1', data: null }, { opId: 'a', kind: 'drop', id: 't1' },
  { opId: 'a', kind: 'budget', value: -1 }, { opId: 'a', kind: 'delete', id: 'x'.repeat(65) }]) assert.equal(isValidOp(bad), false);

// ---- 함께 쓰는 사람 ----
const M = [{ id: 'm1', name: '엄마', color: 0 }, { id: 'm2', name: '아빠', color: 1 }];
assert.equal(isValidMembers(M), true);
for (const bad of [null, 'x', [{ id: 'a', name: '', color: 0 }], [{ id: 'a', name: 'x'.repeat(13), color: 0 }],
  [{ id: 'a', name: '가', color: 0 }, { id: 'a', name: '나', color: 1 }], new Array(11).fill(0).map((_, i) => ({ id: 'i' + i, name: 'n' + i, color: 0 }))])
  assert.equal(isValidMembers(bad), false);
assert.equal(isValidTx({ ...good, memberId: 'm1' }), true);
assert.equal(isValidTx({ ...good, memberId: null }), true);
assert.equal(isValidTx({ ...good, memberId: 5 }), false);
// 사람 목록 저장은 예산과 따로 합쳐짐
let q2 = coalesce([], { opId: 'b', kind: 'budget', value: 1 });
q2 = coalesce(q2, { opId: 'm', kind: 'members', value: M });
q2 = coalesce(q2, { opId: 'm2', kind: 'members', value: M.slice(0, 1) });
assert.deepEqual(q2.map((o) => o.kind), ['budget', 'members']);
assert.equal(applyQueue({ tx: {}, budget: 0, members: [] }, q2).members.length, 1);
// 합계: 사람별 + 공동(미지정·삭제된 사람) = 전체
const L = [
  { type: 'expense', amount: 10000, memberId: 'm1' }, { type: 'expense', amount: 5000, memberId: 'm1' },
  { type: 'expense', amount: 7000, memberId: 'm2' }, { type: 'income', amount: 300000, memberId: 'm2' },
  { type: 'expense', amount: 3000, memberId: null }, { type: 'expense', amount: 2000, memberId: 'gone' },
];
const S = summarizeByMember(L, M);
const row = (k) => S.rows.find((r) => r.key === k);
assert.equal(row('m1').exp, 15000); assert.equal(row('m2').exp, 7000); assert.equal(row('m2').inc, 300000);
assert.equal(row(SHARED).exp, 5000);           // 미지정 3000 + 삭제된 사람 2000
assert.equal(S.totalExp, 27000); assert.equal(S.totalInc, 300000);
assert.equal(S.rows.reduce((a, r) => a + r.exp, 0), S.totalExp); // 사람별 합 = 총합
assert.equal(filterByOwner(L, M, SHARED).length, 2);
assert.equal(filterByOwner(L, M, 'm1').length, 2);
assert.equal(summarizeByMember([{ type: 'expense', amount: 1, memberId: 'm1' }], M).rows.some((r) => r.key === SHARED), false); // 공동 내역 없으면 행 숨김
assert.equal(isSchemaError({ code: '42703', message: 'column transactions.member_id does not exist' }), true);
assert.equal(isSchemaError({ code: 'PGRST204', message: "Could not find the 'member_id' column" }), true);
assert.equal(isRetryable({ code: 'PGRST204', message: "Could not find the 'member_id' column" }), true); // 데이터 보존
const P = sharePercents([50000, 30000, 10000, 20000], 110000);   // 45.45 / 27.27 / 9.09 / 18.18
assert.equal(P.reduce((a, b) => a + b, 0), 100); assert.deepEqual(P, [46, 27, 9, 18]);
assert.deepEqual(sharePercents([1, 1, 1], 3), [34, 33, 33]);
assert.deepEqual(sharePercents([0, 0], 0), [0, 0]);
assert.equal(S.rows.reduce((a, r) => a + r.pct, 0), 100);
console.log('outbox unit tests: all passed');
