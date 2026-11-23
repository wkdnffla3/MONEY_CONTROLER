// 휴대폰 뒤로 가기: 시트만 닫히고 화면(탭)은 그대로, 버튼으로 닫으면 기록이 남지 않음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, tab, settle } from './helpers.mjs';
const env = setup();
const sheetOpen = (page) => page.locator('.sheet').count();

test('입력창을 연 채 뒤로 가기 → 입력창만 닫힘, 탭 유지', async () => {
  const { ctx, page, errs } = await open(env);
  await tab(page, '내역');
  const url = page.url();
  await page.click('button.fab');
  await page.waitForTimeout(300);
  assert.equal(await sheetOpen(page), 1);
  await page.goBack();
  await page.waitForTimeout(300);
  assert.equal(await sheetOpen(page), 0);
  assert.equal(page.url(), url);
  assert.ok(await page.locator('.nav-tabs button[aria-current="page"]:has-text("내역")').count() >= 1);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('버튼으로 닫은 뒤 뒤로 가기 → 바로 이전 탭으로 (한 번 더 누를 필요 없음)', async () => {
  const { ctx, page } = await open(env);
  await tab(page, '내역');
  await page.click('button.fab');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await sheetOpen(page), 0);
  await page.goBack();
  await settle(page, 300);
  assert.ok(!page.url().includes('#list'));
  await ctx.close();
});

test('시트를 연 채 탭을 바꾸고 뒤로 가기 → 이전 탭', async () => {
  const { ctx, page } = await open(env);
  await tab(page, '내역');
  await page.click('button.fab');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await tab(page, '리포트');
  await page.goBack();
  await settle(page, 300);
  assert.ok(page.url().includes('#list'));
  await ctx.close();
});

test('수정 중인 내역이 다른 기기에서 지워지면 시트를 닫고 알림', async () => {
  const { seedScript, tx } = await import('./helpers.mjs');
  const { ctx, page, errs } = await open(env, { seed: seedScript({ transactions: [tx('t1', { memo: '지울것' })] }), path: '#list' });
  await page.click('.tx:has-text("지울것")');
  await page.waitForTimeout(300);
  assert.equal(await sheetOpen(page), 1);
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__fakedb')); db.transactions = []; sessionStorage.setItem('__fakedb', JSON.stringify(db));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(800);
  assert.equal(await sheetOpen(page), 0);
  assert.match(await page.innerText('.toast'), /다른 기기에서 지워진/);
  assert.deepEqual(errs, []);
  await ctx.close();
});
