// 화면 테마 직접 선택: 기기 설정 따라감(기본) / 밝게 / 어둡게, 새로고침해도 유지
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, settle } from './helpers.mjs';

const env = setup();
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT = 'rgb(244, 241, 234)'; // --bg #f4f1ea
const DARK = 'rgb(21, 20, 15)';     // --bg #15140f
async function pick(page, label) {
  await page.click('button[aria-label="설정 메뉴"]');
  await page.click(`.theme-row button:has-text("${label}")`);
  await settle(page, 150);
}

describe('화면 테마', () => {
  test('기본은 기기 설정을 따름', async () => {
    const { ctx, page, errs } = await open(env, { contextOptions: { colorScheme: 'dark' } });
    assert.equal(await page.getAttribute('html', 'data-theme'), null);
    assert.equal(await bg(page), DARK);
    await page.click('button[aria-label="설정 메뉴"]');
    assert.equal(await page.locator('.theme-row button[aria-pressed="true"]').innerText(), '기기 설정');
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('기기가 어두워도 "밝게"를 고르면 밝게, 새로고침해도 유지, 다시 기기 설정으로', async () => {
    const { ctx, page, errs } = await open(env, { contextOptions: { colorScheme: 'dark' } });
    await pick(page, '밝게');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    assert.equal(await bg(page), LIGHT);
    assert.equal(await page.evaluate(() => localStorage.getItem('ledger.theme')), 'light');
    await page.reload(); await page.waitForSelector('.nav-tabs');
    assert.equal(await bg(page), LIGHT);
    await page.keyboard.press('Escape'); await settle(page, 150);
    await pick(page, '기기 설정');
    assert.equal(await page.getAttribute('html', 'data-theme'), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('ledger.theme')), null);
    assert.equal(await bg(page), DARK);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('기기가 밝아도 "어둡게"를 고르면 어둡게, 잘못 저장된 값은 기기 설정', async () => {
    const { ctx, page, errs } = await open(env, { contextOptions: { colorScheme: 'light' } });
    await pick(page, '어둡게');
    assert.equal(await bg(page), DARK);
    await page.evaluate(() => localStorage.setItem('ledger.theme', 'purple'));
    await page.reload(); await page.waitForSelector('.nav-tabs');
    assert.equal(await page.getAttribute('html', 'data-theme'), null);
    assert.equal(await bg(page), LIGHT);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
