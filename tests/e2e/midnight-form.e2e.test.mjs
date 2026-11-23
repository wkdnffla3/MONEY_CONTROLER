// 앱을 켜 둔 채 자정이 지날 때: PC 입력칸 날짜, 달이 바뀌면 이번 달 보기 따라가기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, db } from './helpers.mjs';
const env = setup();
test('PC 입력칸: 켜 둔 채 자정이 지나면 날짜도 오늘로', async () => {
  const { ctx, page, errs } = await open(env, { width: 1280, path: '#list', contextOptions: { timezoneId: 'Asia/Seoul' },
    beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-23T23:59:30+09:00') }) });
  const form = page.locator('.side-form');
  assert.equal(await form.locator('input[type="date"]').inputValue(), '2026-11-23');
  await page.clock.runFor(40_000);
  await page.clock.runFor(2000);
  assert.equal(await form.locator('input[type="date"]').inputValue(), '2026-11-24');
  await form.locator('.amount-input input').fill('3000');
  await form.locator('button[type="submit"]').click();
  await page.waitForTimeout(700);
  assert.equal((await db(page)).transactions[0].date, '2026-11-24');
  assert.deepEqual(errs, []);
  await ctx.close();
});
test('이번 달을 보던 중 달이 바뀌면 새 달로, 입력칸 날짜도 새 달 1일', async () => {
  const { ctx, page, errs } = await open(env, { width: 1280, path: '#list', contextOptions: { timezoneId: 'Asia/Seoul' },
    beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-30T23:59:30+09:00') }) });
  await page.clock.runFor(40_000);
  await page.clock.runFor(2000);
  assert.match(await page.innerText('.monthbar .label'), /12월/);
  assert.equal(await page.locator('.side-form input[type="date"]').inputValue(), '2026-12-01');
  assert.deepEqual(errs, []);
  await ctx.close();
});
test('지난달을 일부러 보던 중이면 그대로', async () => {
  const { ctx, page } = await open(env, { width: 1280, path: '#list', contextOptions: { timezoneId: 'Asia/Seoul' },
    beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-30T23:59:30+09:00') }) });
  await page.click('.monthbar button[aria-label="이전 달"]');
  assert.match(await page.innerText('.monthbar .label'), /10월/);
  await page.clock.runFor(40_000);
  await page.clock.runFor(2000);
  assert.match(await page.innerText('.monthbar .label'), /10월/);
  await ctx.close();
});
