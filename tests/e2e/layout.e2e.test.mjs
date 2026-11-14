// 화면 구성: 탭 4개, 첫 화면엔 요약만, 내역 탭(목록·달력), 주소 #list, PC·좁은 폰
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, tab, seedScript, tx, norm } from './helpers.mjs';

const env = setup();
const many = seedScript({ transactions: Array.from({ length: 30 }, (_, i) => tx('s' + i, { amount: 1000 + i, memo: '메모' + i, created_at: i })) });

describe('화면 구성', () => {
  test('첫 화면: 탭 4개, 내역 목록은 없음', async () => {
    const { ctx, page, errs } = await open(env, { seed: many });
    const tabs = (await page.locator('.nav-tabs button').allInnerTexts()).map(norm);
    assert.deepEqual(tabs.slice(0, 4), ['가계부', '내역', '장보기', '리포트']);
    assert.equal(await page.locator('.tx').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('내역 탭: 주소 #list, 목록 ↔ 달력, 뒤로 가기는 첫 화면', async () => {
    const { ctx, page, errs } = await open(env, { seed: many });
    await tab(page, '내역');
    assert.ok(page.url().endsWith('#list'));
    assert.equal(await page.locator('.tx').count(), 30);
    assert.equal(await page.locator('.fab').count(), 1);
    await page.click('button:has-text("달력")');
    assert.ok(await page.locator('.cal-grid, .calendar, [class*="cal"]').count() > 0);
    await page.click('button:has-text("목록")');
    assert.equal(await page.locator('.tx').count(), 30);
    await page.goBack();
    await page.waitForTimeout(300);
    assert.ok(!page.url().endsWith('#list'));
    assert.equal(await page.locator('.tx').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('주소 #list 로 바로 열기 (홈 화면 바로가기)', async () => {
    const { ctx, page } = await open(env, { seed: many, path: '#list' });
    assert.equal(await page.locator('.nav-tabs button[aria-current="page"]').innerText(), '내역');
    assert.equal(await page.locator('.tx').count(), 30);
    await ctx.close();
  });

  test('PC: 내역 탭에 오른쪽 입력칸, 탭 한 줄', async () => {
    const { ctx, page } = await open(env, { seed: many, width: 1280, path: '#list' });
    assert.equal(await page.locator('.side-form').count(), 1);
    const ys = new Set();
    for (let i = 0; i < 4; i++) ys.add(Math.round((await page.locator('.nav-tabs button').nth(i).boundingBox()).y));
    assert.equal(ys.size, 1);
    await ctx.close();
  });

  test('좁은 폰(360px): 탭 한 줄, 화면이 옆으로 넘치지 않음', async () => {
    const { ctx, page } = await open(env, { seed: many, width: 360 });
    const ys = new Set();
    for (let i = 0; i < 4; i++) ys.add(Math.round((await page.locator('.nav-tabs button').nth(i).boundingBox()).y));
    assert.equal(ys.size, 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 360);
    await tab(page, '내역');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 360);
    await ctx.close();
  });

  test('모든 탭이 오류 없이 열림 (나눠 불러오는 화면)', async () => {
    const { ctx, page, errs } = await open(env, { seed: many });
    for (const t of ['내역', '장보기', '리포트', '가계부']) {
      await tab(page, t);
      assert.equal(await page.locator('.screen-error, .boundary-error').count(), 0, t);
    }
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
