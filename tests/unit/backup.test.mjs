// 전체 백업·복원 (lib/backup.js)
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, planRestore, planSettings, backupFileName } from '../../src/lib/backup.js';
import { EMPTY_STATE } from '../../src/lib/outbox.js';
import { DEFAULT_CATEGORIES } from '../../src/lib/categories.js';

const t = (o = {}) => ({ type: 'expense', amount: 1000, category: '식비', memo: '', date: '2026-10-01', memberId: null, tags: [], cardId: null, inst: 1, createdAt: 1, ...o });
const item = (o = {}) => ({ name: '우유', qty: 1, price: 0, category: '식비', memberId: null, memo: '', checked: false, status: 'todo', paid: null, txId: null, boughtAt: null, createdAt: 1, ...o });
const view = { ...EMPTY_STATE, tx: { a: t(), b: t({ amount: 2000, date: '2026-09-01', tags: ['외식'] }) }, items: { i1: item({ txId: 'a' }) }, budget: 300000 };

// 1. 만들고 다시 읽으면 그대로
const b = buildBackup(view, { ledgerId: 'L1', exportedAt: new Date('2026-11-17T08:00:00Z') });
assert.equal(b.format, 'ledger-backup');
assert.deepEqual(b.counts, { transactions: 2, items: 1 });
assert.deepEqual(b.transactions.map((x) => x.id), ['b', 'a']); // 날짜순
assert.equal(b.settings.budget, 300000);
const p = parseBackup(JSON.stringify(b));
assert.ok(p.ok);
assert.equal(p.backup.ledgerId, 'L1');
assert.deepEqual(Object.fromEntries(p.backup.tx), view.tx);
assert.deepEqual(Object.fromEntries(p.backup.items), view.items);
assert.deepEqual(p.invalid, { tx: 0, items: 0, settings: [] });
assert.ok(parseBackup('﻿' + JSON.stringify(b)).ok); // BOM 붙은 파일
assert.match(backupFileName(new Date(2026, 0, 5)), /^가계부-백업-2026-01-05\.json$/);

// 2. 잘못된 파일
assert.match(parseBackup('').error, /빈 파일/);
assert.match(parseBackup('a,b\n1,2').error, /JSON/);
assert.match(parseBackup('{"format":"other"}').error, /백업 파일이 아니에요/);
assert.match(parseBackup('{"format":"ledger-backup","version":2}').error, /새로운 버전/);
assert.match(parseBackup('{"format":"ledger-backup"}').error, /형식을 알 수 없어요/);

// 3. 잘못된 줄은 버리고 개수만 (조작된 값이 안 들어가게), 알 수 없는 칸은 버림, 같은 ID는 마지막 것
const evil = parseBackup(JSON.stringify({
  format: 'ledger-backup', version: 1,
  transactions: [
    { id: 'ok', ...t(), user_id: 'someone-else', hacked: true },
    { id: 'ok', ...t({ amount: 5 }) },
    { id: 'x'.repeat(65), ...t() }, { id: 'neg', ...t({ amount: -1 }) }, { id: 'memo', ...t({ memo: 'a'.repeat(201) }) }, null, 'str',
  ],
  items: [{ id: 'i', ...item({ qty: 0 }) }],
  settings: { budget: 'lots', members: [{ id: 'm1', name: '민지', color: 0 }], unknown: 1 },
}));
assert.ok(evil.ok);
assert.deepEqual(evil.backup.tx.map(([id]) => id), ['ok']);
assert.equal(evil.backup.tx[0][1].amount, 5);
assert.ok(!('user_id' in evil.backup.tx[0][1]) && !('hacked' in evil.backup.tx[0][1]));
assert.deepEqual(evil.invalid, { tx: 5, items: 1, settings: ['budget'] });
assert.deepEqual(Object.keys(evil.backup.settings), ['members']);

// 4. 복원 계획: 빠진 것만 / 덮어쓰기
const now = { ...EMPTY_STATE, tx: { a: t({ amount: 999 }) }, items: {} };
let plan = planRestore(p.backup, now, { overwrite: false });
assert.deepEqual(plan.count, { txNew: 1, txSame: 0, txChanged: 1, itemsNew: 1, itemsSame: 0, itemsChanged: 0 });
assert.deepEqual(plan.tx.map(([id]) => id), ['b']);
plan = planRestore(p.backup, now, { overwrite: true });
assert.deepEqual(plan.tx.map(([id]) => id).sort(), ['a', 'b']);
plan = planRestore(p.backup, view, { overwrite: true });
assert.equal(plan.tx.length + plan.items.length, 0); // 이미 같으면 보낼 것 없음
assert.equal(plan.count.txSame, 2);

// 5. 다른 가계부 백업: 새 ID (항상 같은 값 → 두 번 넣어도 중복 없음), 장보기→내역 연결도 새 ID로
const o1 = planRestore(p.backup, EMPTY_STATE, { sameLedger: false, ledgerId: 'L2' });
const o2 = planRestore(p.backup, EMPTY_STATE, { sameLedger: false, ledgerId: 'L2' });
assert.deepEqual(o1.tx.map(([id]) => id), o2.tx.map(([id]) => id));
assert.ok(o1.tx.every(([id]) => /^rb-[0-9a-z]+$/.test(id) && id.length <= 64));
assert.notDeepEqual(o1.tx.map(([id]) => id), planRestore(p.backup, EMPTY_STATE, { sameLedger: false, ledgerId: 'L3' }).tx.map(([id]) => id));
const newA = o1.tx.find(([, d]) => d.amount === 1000)[0];
assert.equal(o1.items[0][1].txId, newA);
// 내역에서 반복으로 바꾼 규칙(srcTx)도 새 ID를 가리킴
{
  const rule = { id: 'r1', type: 'expense', amount: 1000, category: '식비', memo: '', memberId: null, day: 1, start: '2026-10', end: null, last: '2026-10', active: true, srcTx: 'a' };
  const bb = { ...p.backup, settings: { ...p.backup.settings, recurring: [rule] } };
  const rr = planRestore(bb, EMPTY_STATE, { sameLedger: false, ledgerId: 'L2' }).settings.find((x) => x.kind === 'recurring');
  assert.equal(rr.value[0].srcTx, newA);
  const same = planRestore(bb, EMPTY_STATE).settings.find((x) => x.kind === 'recurring');
  assert.equal(same.value[0].srcTx, 'a');
}
const again = planRestore(p.backup, { ...EMPTY_STATE, tx: Object.fromEntries(o1.tx), items: Object.fromEntries(o1.items) }, { sameLedger: false, ledgerId: 'L2' });
assert.equal(again.tx.length + again.items.length, 0);

// 6. 설정: 빠진 것만 더함 / 덮어쓰기
const cur = { ...EMPTY_STATE, budget: 100, members: [{ id: 'm1', name: '민지', color: 0 }], categories: null, catBudgets: { 식비: 1000 }, dismissedSubs: ['a'] };
const bak = { budget: 999, members: [{ id: 'm1', name: '바뀐이름', color: 3 }, { id: 'm2', name: '준호', color: 1 }],
  categories: { expense: [...DEFAULT_CATEGORIES.expense, { name: '반려동물', icon: '🐶' }], income: DEFAULT_CATEGORIES.income },
  catBudgets: { 식비: 5, 교통: 2000 }, dismissedSubs: ['a', 'b'], favorites: [] };
const merged = Object.fromEntries(planSettings(cur, bak, false).map((s) => [s.kind, s.value]));
assert.ok(!('budget' in merged)); // 지금 예산이 있으면 유지
assert.deepEqual(merged.members.map((m) => `${m.id}:${m.name}`), ['m1:민지', 'm2:준호']);
assert.equal(merged.categories.expense.at(-1).name, '반려동물');
assert.deepEqual(merged.catBudgets, { 식비: 1000, 교통: 2000 });
assert.deepEqual(merged.dismissedSubs, ['a', 'b']);
assert.ok(!('favorites' in merged)); // 바뀌는 것 없음
const over = Object.fromEntries(planSettings(cur, bak, true).map((s) => [s.kind, s.value]));
assert.equal(over.budget, 999);
assert.equal(over.members[0].name, '바뀐이름');
assert.deepEqual(planSettings({ ...cur, budget: 0 }, { budget: 999 }, false), [{ kind: 'budget', value: 999 }]);
// 기본 카테고리를 그대로 쓰는 중 + 백업도 기본값 → 바꿀 것 없음
assert.deepEqual(planSettings({ ...EMPTY_STATE }, { categories: DEFAULT_CATEGORIES }, false), []);
// 한도 넘게 합쳐지지 않음 (사람 10명)
const ten = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, name: '사람' + i, color: 0 }));
assert.equal(planSettings({ ...EMPTY_STATE, members: ten }, { members: [{ id: 'new', name: '새사람', color: 0 }] }, false).length, 0);

console.log('backup unit tests: all passed');
