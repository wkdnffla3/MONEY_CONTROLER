// 반복 내역 관리: "누가" 기준 사람별 묶음 (나 먼저 → 사람 순서 → 공동), 묶음마다 개수·매달 합계
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, settings, menu, norm } from './helpers.mjs';

const env = setup();
const members = [{ id: 'm1', name: '민지', color: 0 }, { id: 'm2', name: '준호', color: 1 }];
const rule = (id, memo, memberId, o = {}) => ({
  id, type: 'expense', amount: 10000, category: '주거·통신', memo, memberId, day: 25,
  start: '2026-01', end: null, last: '2099-12', active: true, ...o,
});
const recurring = [
  rule('r1', '민지폰', 'm1', { amount: 55000 }),
  rule('r2', '관리비', null, { amount: 150000 }),
  rule('r3', '준호월급', 'm2', { type: 'income', category: '월급', amount: 3000000 }),
  rule('r4', '민지구독', 'm1', { amount: 9900, active: false }),
];
const asJunho = "localStorage.setItem('ledger.me.u1','m2')";

describe('반복 내역 사람별 보기', () => {
  test('사람이 여럿이면 나(준호) → 민지 → 공동 순으로 묶고, 개수·매달 합계(일시정지 제외)를 보여 줌', async () => {
    const { ctx, page, errs } = await open(env, { seed: seedScript({ settingsRow: settings({ members, recurring }) }), init: [asJunho] });
    await menu(page, '반복 내역');
    const heads = (await page.locator('.sheet .rule-glabel').allInnerTexts()).map(norm);
    assert.equal(heads.length, 3);
    assert.match(heads[0], /^준호 \(나\) · 1개/);
    assert.match(heads[0], /매달 \+3,000,000원/);
    assert.match(heads[1], /^민지 · 2개/);
    assert.match(heads[1], /매달 -55,000원/); // 일시정지한 구독은 합계에서 빠짐
    assert.match(heads[2], /^공동 · 1개/);
    // 묶음 안에 그 사람의 규칙만
    const groupMemos = async (i) => page.locator('.sheet .rule-group').nth(i).locator('.rule-list .cat').allInnerTexts();
    assert.deepEqual((await groupMemos(1)).map(norm), ['민지폰', '민지구독']);
    // 묶음 이름이 있으면 줄마다 이름표는 붙이지 않음
    assert.equal(await page.locator('.sheet .rule-list .who-badge').count(), 0);
    // 새로 추가하면 "누가"가 이 기기 사람(준호)으로 미리 선택됨
    await page.click('.sheet button:has-text("+ 반복 내역 추가")');
    assert.equal(norm(await page.locator('.sheet .chip[aria-pressed="true"]:has-text("준호")').innerText()), '준호');
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('사람 목록이 없으면 묶음 없이 예전처럼 한 목록', async () => {
    const { ctx, page, errs } = await open(env, { seed: seedScript({ settingsRow: settings({ recurring: [rule('r1', '월세', null), rule('r2', '통신비', null)] }) }) });
    await menu(page, '반복 내역');
    assert.equal(await page.locator('.sheet .rule-glabel').count(), 0);
    assert.equal(await page.locator('.sheet .rule-list li').count(), 2);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
