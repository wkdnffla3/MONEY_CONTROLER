import assert from 'node:assert/strict';
import { coalesce, applyQueue, removeOp, isRetryable, isValidOp, isValidTx } from '../src/lib/outbox.js';
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
const v = applyQueue({ a: { memo: 'server' }, z: { memo: 'keep' } }, 0, q);
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
console.log('outbox unit tests: all passed');
