import assert from 'node:assert/strict';
import { coalesce, applyQueue, removeOp, renameOps, isRetryable, isValidOp, isValidTx, isValidMembers, isSchemaError, withBase, rebase, setVer } from '../../src/lib/outbox.js';
import { summarizeByMember, filterByOwner, sharePercents, SHARED } from '../../src/lib/members.js';
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
  { ...good, category: '' }, { ...good, memo: 'x'.repeat(201) }, { ...good, date: '2026/11/12' }]) assert.equal(isValidTx(bad), false);
assert.equal(isValidTx({ ...good, memo: 'https://example.com/' + 'a'.repeat(180) }), true); // 200자 링크 OK
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
// ===== 카테고리 이름 변경 작업 (요청 1번) =====
{
  const r = (opId, type, from, to) => ({ opId, kind: 'renameCat', type, from, to });
  assert.ok(isValidOp(r('o1', 'expense', '식비', '밥값')));
  assert.ok(!isValidOp(r('o2', 'expense', '식비', '식비')));          // 같은 이름
  assert.ok(!isValidOp(r('o3', 'transfer', '식비', '밥값')));          // 이상한 종류
  assert.ok(!isValidOp(r('o4', 'expense', '', '밥값')));
  assert.ok(!isValidOp(r('o5', 'expense', '식비', 'x'.repeat(21))));  // 21자
  // 가→나, 나→다 연속 변경은 합쳐지지 않고 순서대로 남음
  let q = coalesce([], r('a', 'expense', '가', '나'));
  q = coalesce(q, r('b', 'expense', '나', '다'));
  assert.equal(q.length, 2);
  // 화면 반영: 같은 종류·같은 이름만, 순서대로
  const st = { tx: {
    t1: { type: 'expense', category: '가', amount: 1, memo: '유지' },
    t2: { type: 'income', category: '가', amount: 2 },     // 수입은 그대로
    t3: { type: 'expense', category: '기타', amount: 3 },
  } };
  const v = applyQueue(st, q);
  assert.equal(v.tx.t1.category, '다'); assert.equal(v.tx.t1.memo, '유지');
  assert.equal(v.tx.t2.category, '가'); assert.equal(v.tx.t3.category, '기타');
  assert.equal(st.tx.t1.category, '가'); // 원본은 안 바뀜
  // 이름 변경 전에 넣어 둔 내역 수정도 바뀐 이름으로 보임
  const v2 = applyQueue({ tx: {} }, [{ opId: 'u', kind: 'upsert', id: 'n1', data: { type: 'expense', category: '가', amount: 5 } }, r('c', 'expense', '가', '나')]);
  assert.equal(v2.tx.n1.category, '나');
}
// 이름 변경 순서: 맞바꾸기·이어 바꾸기는 임시 이름을 거쳐 두 단계로 (그대로 보내면 한쪽으로 합쳐짐)
{
  let k = 0; const id = () => `id${k++}`;
  const base = { tx: { a: { type: 'expense', category: '식비' }, b: { type: 'expense', category: '교통' }, c: { type: 'expense', category: '쇼핑' }, i: { type: 'income', category: '식비' } } };
  const cats = (v) => Object.fromEntries(Object.entries(v.tx).map(([key, t]) => [key, t.category]));
  // 단순 변경: 그대로 1개
  let ops = renameOps([{ type: 'expense', from: '식비', to: '밥값' }, { type: 'expense', from: '쇼핑', to: '쇼핑' }], id);
  assert.equal(ops.length, 1);
  assert.deepEqual(cats(applyQueue(base, ops)), { a: '밥값', b: '교통', c: '쇼핑', i: '식비' });
  // 맞바꾸기
  ops = renameOps([{ type: 'expense', from: '식비', to: '교통' }, { type: 'expense', from: '교통', to: '식비' }], id);
  assert.equal(ops.length, 4);
  assert.ok(ops.every((o) => isValidOp(o)), JSON.stringify(ops));
  assert.deepEqual(cats(applyQueue(base, ops)), { a: '교통', b: '식비', c: '쇼핑', i: '식비' });
  // 이어 바꾸기 (교통→버스, 식비→교통)
  ops = renameOps([{ type: 'expense', from: '식비', to: '교통' }, { type: 'expense', from: '교통', to: '버스' }], id);
  assert.deepEqual(cats(applyQueue(base, ops)), { a: '교통', b: '버스', c: '쇼핑', i: '식비' });
  // 세 개 돌리기
  ops = renameOps([{ type: 'expense', from: '식비', to: '교통' }, { type: 'expense', from: '교통', to: '쇼핑' }, { type: 'expense', from: '쇼핑', to: '식비' }], id);
  assert.deepEqual(cats(applyQueue(base, ops)), { a: '교통', b: '쇼핑', c: '식비', i: '식비' });
  // 종류가 다르면 이어진 게 아님 (수입 식비 → 교통 + 지출 교통 → 식비)
  ops = renameOps([{ type: 'income', from: '식비', to: '교통' }, { type: 'expense', from: '교통', to: '식비' }], id);
  assert.equal(ops.length, 2);
  assert.ok(ops.flatMap((o) => [o.from, o.to]).every((n) => n.length <= 20));
}
// 017 버전 확인: base 붙이기·이어받기·보낸 뒤 맞추기
{
  const ver = { 'tx:a': 3, 'item:i': 2, 'set:budget': 5 };
  assert.equal(withBase({ opId: '1', kind: 'upsert', id: 'a', data: {} }, [], ver).base, 3);
  assert.equal(withBase({ opId: '1', kind: 'upsert', id: 'new', data: {} }, [], ver).base, null); // 서버에 없음 = 새로 추가
  assert.equal(withBase({ opId: '1', kind: 'delete', id: 'a' }, [], ver).base, 3);
  assert.equal(withBase({ opId: '1', kind: 'itemDel', id: 'i' }, [], ver).base, 2);
  assert.equal(withBase({ opId: '1', kind: 'cards', value: [] }, [], ver).base, 0); // 설정 칸이 한 번도 안 바뀜
  assert.equal(withBase({ opId: '1', kind: 'budget', value: 1 }, [], ver).base, 5);
  assert.equal('base' in withBase({ opId: '1', kind: 'upsert', id: 'a', data: {} }, [], undefined), false); // 017 전: 확인 없이
  assert.equal('base' in withBase({ opId: '1', kind: 'renameCat', type: 'expense', from: 'a', to: 'b' }, [], ver), false);
  // 오프라인에서 여러 번 고침 → 처음 본 버전 이어받음
  const p1 = { opId: 'p1', kind: 'upsert', id: 'a', data: {}, base: 3 };
  assert.equal(withBase({ opId: '2', kind: 'upsert', id: 'a', data: {} }, [p1], { 'tx:a': 9 }).base, 3);
  assert.equal(withBase({ opId: '2', kind: 'delete', id: 'a' }, [{ ...p1, base: null }], ver).base, null); // 아직 안 올린 새 내역 → 그냥 지움
  assert.equal(withBase({ opId: '2', kind: 'upsert', id: 'a', data: {}, base: 7 }, [p1], ver).base, 7); // 이미 붙어 있으면 그대로
  // 보내는 사이에 또 고친 작업 → 새 버전 기준으로
  const q2 = [{ opId: 'x', kind: 'upsert', id: 'a', data: {}, base: 3 }, { opId: 'y', kind: 'upsert', id: 'b', data: {}, base: 3 }];
  const r = rebase(q2, { opId: 'sent', kind: 'upsert', id: 'a', base: 3 }, 4);
  assert.deepEqual(r.map((o) => o.base), [4, 3]);
  assert.deepEqual(rebase(q2, { opId: 'sent', kind: 'upsert', id: 'a', base: 3 }, undefined), q2);
  assert.deepEqual(rebase([{ opId: 'x', kind: 'upsert', id: 'a', data: {}, base: null }], { opId: 's', kind: 'upsert', id: 'a', base: null }, 1)[0].base, 1);
  // 버전 표
  const st = { tx: {}, _ver: { 'tx:a': 3 } };
  assert.deepEqual(setVer(st, { kind: 'upsert', id: 'a' }, 4)._ver, { 'tx:a': 4 });
  assert.deepEqual(setVer(st, { kind: 'delete', id: 'a' }, null)._ver, {});
  assert.equal(setVer({ tx: {} }, { kind: 'upsert', id: 'a' }, 4)._ver, undefined);
  // 형식 검사
  assert.ok(isValidOp({ opId: '1', kind: 'delete', id: 'a', base: 2 }));
  assert.ok(isValidOp({ opId: '1', kind: 'delete', id: 'a', base: null }));
  assert.equal(isValidOp({ opId: '1', kind: 'delete', id: 'a', base: -1 }), false);
  assert.equal(isValidOp({ opId: '1', kind: 'delete', id: 'a', base: '2' }), false);
}
console.log('outbox unit tests: all passed');
