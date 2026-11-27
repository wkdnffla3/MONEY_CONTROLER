// 설정 충돌 자동 합치기 (017)
import assert from 'node:assert/strict';
import { mergeList, mergeSet, mergeMap, mergeSetting, canMerge } from '../../src/lib/merge.js';
const f = (id, o = {}) => ({ id, label: id, amount: 1000, ...o });

// 두 기기가 각각 즐겨찾기 추가 → 둘 다
let r = mergeList([f('a')], [f('a'), f('m')], [f('a'), f('t')]);
assert.deepEqual(r.value.map((x) => x.id), ['a', 't', 'm']);
// 나는 추가, 서버는 다른 항목 수정 → 둘 다
r = mergeList([f('a'), f('b')], [f('a'), f('b'), f('m')], [f('a', { amount: 5 }), f('b')]);
assert.deepEqual(r.value, [f('a', { amount: 5 }), f('b'), f('m')]);
// 같은 항목의 다른 칸 (반복 내역: 나는 금액, 다른 기기는 last) → 칸별로
r = mergeList([f('r', { last: '2026-11' })], [f('r', { last: '2026-11', amount: 2000 })], [f('r', { last: '2026-12' })]);
assert.deepEqual(r.value, [f('r', { last: '2026-12', amount: 2000 })]);
// 같은 칸을 서로 다르게 → 충돌
assert.equal(mergeList([f('a')], [f('a', { amount: 1 })], [f('a', { amount: 2 })]).ok, false);
// 같은 칸을 같게 → 괜찮음
assert.equal(mergeList([f('a')], [f('a', { amount: 2 })], [f('a', { amount: 2 })]).ok, true);
// 내가 지움 + 서버는 다른 것 추가 → 지운 채로 추가
r = mergeList([f('a'), f('b')], [f('b')], [f('a'), f('b'), f('t')]);
assert.deepEqual(r.value.map((x) => x.id), ['b', 't']);
// 내가 지운 걸 서버가 고침 → 충돌, 서버가 지운 걸 내가 고침 → 충돌
assert.equal(mergeList([f('a')], [], [f('a', { amount: 9 })]).ok, false);
assert.equal(mergeList([f('a')], [f('a', { amount: 9 })], []).ok, false);
// 둘 다 지움 → 없음
assert.deepEqual(mergeList([f('a'), f('b')], [f('b')], [f('b')]).value.map((x) => x.id), ['b']);
// 내가 순서 바꿈 + 서버는 추가 → 내 순서 + 추가
r = mergeList([f('a'), f('b'), f('c')], [f('c'), f('a'), f('b')], [f('a'), f('b'), f('c'), f('t')]);
assert.deepEqual(r.value.map((x) => x.id), ['c', 'a', 'b', 't']);
// 둘 다 순서 바꿈 → 충돌
assert.equal(mergeList([f('a'), f('b'), f('c')], [f('c'), f('a'), f('b')], [f('b'), f('a'), f('c')]).ok, false);
// id 없는 항목 → 못 합침
assert.equal(mergeList([{ x: 1 }], [{ x: 2 }], [{ x: 3 }]).ok, false);

// 숨긴 구독 제안(문자열 목록)
assert.deepEqual(mergeSet(['a'], ['a', 'm'], ['a', 't']).value, ['a', 't', 'm']);
assert.deepEqual(mergeSet(['a', 'b'], ['b'], ['a', 'b', 't']).value, ['b', 't']);
// 카테고리별 예산
assert.deepEqual(mergeMap({ 식비: 1 }, { 식비: 1, 교통: 2 }, { 식비: 5 }).value, { 식비: 5, 교통: 2 });
assert.equal(mergeMap({ 식비: 1 }, { 식비: 2 }, { 식비: 3 }).ok, false);
assert.deepEqual(mergeMap({ 식비: 1, 교통: 2 }, { 식비: 1 }, { 식비: 1, 교통: 2, 쇼핑: 3 }).value, { 식비: 1, 쇼핑: 3 });

// 합칠 수 없는 칸
assert.equal(canMerge('budget'), false);
assert.equal(canMerge('categories'), false);
assert.equal(mergeSetting('budget', 1, 2, 3).ok, false);
assert.equal(mergeSetting('favorites', undefined, [], []).ok, false); // 본 값을 모름
assert.deepEqual(mergeSetting('favorites', [], [f('a')], [f('a')]), { ok: true, value: [f('a')] });
console.log('merge unit tests: all passed');

// 키 순서만 다른 같은 내용 (서버 jsonb 는 키 순서를 바꿔 돌려줌) → 같은 것으로 봄
{
  const { sameJson } = await import('../../src/lib/merge.js');
  assert.equal(sameJson({ id: 'a', label: 'x', tags: ['t'] }, { tags: ['t'], label: 'x', id: 'a' }), true);
  assert.equal(sameJson([{ a: 1, b: { c: 2, d: 3 } }], [{ b: { d: 3, c: 2 }, a: 1 }]), true);
  assert.equal(sameJson(undefined, null), true);
  assert.equal(sameJson({ a: 1 }, { a: 2 }), false);
  assert.equal(sameJson([1, 2], [2, 1]), false); // 배열 순서는 그대로 따짐
  // 내가 추가한 항목이 서버에 키 순서만 바뀌어 있음 → 충돌 아님
  const mine = [f('a'), { id: 'm', label: 'm', amount: 500 }];
  const theirs = [f('a'), { amount: 500, label: 'm', id: 'm' }];
  assert.deepEqual(mergeSetting('favorites', [f('a')], mine, theirs).ok, true);
  // 내가 지운 항목: 서버 쪽은 키 순서만 다름(안 고침) → 지울 수 있음
  r = mergeList([f('a'), f('b')], [f('a')], [f('a'), { amount: 1000, label: 'b', id: 'b' }]);
  assert.deepEqual(r, { ok: true, value: [f('a')] });
  console.log('merge key-order tests: all passed');
}
