// 즐겨찾기 사람별 묶기·묶음 안 순서 바꾸기 (lib/favorites.js)
import assert from 'node:assert/strict';
import { groupFavorites, moveInGroup } from '../../src/lib/favorites.js';

const members = [{ id: 'm1', name: '민지', color: 0 }, { id: 'm2', name: '준호', color: 1 }];
const f = (id, memberId = null) => ({ id, label: id, type: 'expense', amount: 1000, category: '식비', memo: '', memberId, cardId: null, tags: [] });
const favs = [f('a', 'm1'), f('b'), f('c', 'm2'), f('d', 'm1'), f('e', 'gone'), f('g', 'm2')];

// 나(m2) 먼저 → 사람 목록 순서 → 공동(사람 없음·지워진 사람), 빈 묶음 없음, 묶음 안은 원래 순서
let g = groupFavorites(favs, members, 'm2');
assert.deepEqual(g.map((x) => `${x.key}:${x.items.map((i) => i.id).join('')}`), ['m2:cg', 'm1:ad', 'shared:be']);
assert.deepEqual(g.map((x) => x.label), ['준호', '민지', '공동']);
assert.deepEqual(g.map((x) => x.isMe), [true, false, false]);
// 나를 모르면 사람 목록 순서
assert.deepEqual(groupFavorites(favs, members, null).map((x) => x.key), ['m1', 'm2', 'shared']);
assert.deepEqual(groupFavorites(favs, members, 'nobody').map((x) => x.key), ['m1', 'm2', 'shared']);
// 사람이 없으면 하나로
assert.deepEqual(groupFavorites(favs, [], null).map((x) => x.key), ['shared']);
assert.equal(groupFavorites([], members, 'm1').length, 0);

// 같은 사람 묶음 안에서만 이동, 다른 사람 위치는 그대로
assert.deepEqual(moveInGroup(favs, 'd', -1, members).map((x) => x.id), ['d', 'b', 'c', 'a', 'e', 'g']);
assert.deepEqual(moveInGroup(favs, 'a', 1, members).map((x) => x.id), ['d', 'b', 'c', 'a', 'e', 'g']);
assert.deepEqual(moveInGroup(favs, 'b', 1, members).map((x) => x.id), ['a', 'e', 'c', 'd', 'b', 'g']); // 지워진 사람도 공동 묶음
assert.equal(moveInGroup(favs, 'a', -1, members), favs); // 맨 위는 그대로
assert.equal(moveInGroup(favs, 'zz', 1, members), favs);

console.log('favorites unit tests: all passed');

// 반복 내역도 같은 "누가" 묶음 (groupByMember) + 묶음별 매달 합계
{
  const { groupByMember } = await import('../../src/lib/members.js');
  const { monthlyTotals } = await import('../../src/lib/recurring.js');
  const rule = (id, memberId, o = {}) => ({ id, memberId, type: 'expense', amount: 10000, active: true, end: null, ...o });
  const rules = [rule('r1', 'm1'), rule('r2', null), rule('r3', 'm2', { type: 'income', amount: 3000000 }), rule('r4', 'gone'), rule('r5', 'm1', { active: false })];
  const g2 = groupByMember(rules, members, 'm2');
  assert.deepEqual(g2.map((x) => x.key), ['m2', 'm1', 'shared']);
  assert.deepEqual(g2.find((x) => x.key === 'shared').items.map((r) => r.id), ['r2', 'r4']); // 사람 없음·지운 사람 = 공동
  assert.equal(g2[0].isMe, true);
  assert.deepEqual(groupByMember(rules, [], null).map((x) => x.key), ['shared']);
  const today = new Date(2026, 10, 27);
  assert.deepEqual(monthlyTotals(g2.find((x) => x.key === 'm1').items, today), { exp: 10000, inc: 0, active: 1 }); // 일시정지 제외
  assert.deepEqual(monthlyTotals([rule('e', null, { end: '2026-10' }), rule('f', null, { end: '2026-11' })], today), { exp: 10000, inc: 0, active: 1 }); // 끝난 규칙 제외
  assert.deepEqual(monthlyTotals(rules, today), { exp: 30000, inc: 3000000, active: 4 });
  console.log('recurring group tests: all passed');
}
