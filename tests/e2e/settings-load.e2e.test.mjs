// 설정만 못 받았을 때(네트워크 끊김 등): 빈 설정으로 화면·기기 캐시를 덮지 않음
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, settings, tx, settle } from './helpers.mjs';

const env = setup();
const fav = { id: 'f1', label: '커피', type: 'expense', amount: 4500, category: '카페·간식', memo: '', memberId: null, cardId: null, tags: [] };

describe('설정 불러오기 실패', () => {
  test('설정 요청만 실패해도 즐겨찾기·캐시가 지워지지 않고, 다시 되면 최신으로', async () => {
    const seed = seedScript({ transactions: [tx('t1')], settingsRow: settings({ budget: 500000, favorites: [fav] }) });
    const { ctx, page, errs } = await open(env, { seed });
    const bar = page.locator('.fav-bar');
    assert.equal(await bar.locator('button:has-text("커피")').count(), 1);

    // 설정 읽기만 실패하는 상태로 새로고침 → 캐시로 보이고, 서버 응답(내역만 성공)이 설정을 비우면 안 됨
    await page.evaluate(() => sessionStorage.setItem('__downRead', 'settings'));
    await page.reload(); await page.waitForSelector('.nav-tabs');
    await settle(page, 800);
    assert.equal(await bar.locator('button:has-text("커피")').count(), 1);
    const cached = await page.evaluate(() => {
      const raw = localStorage.getItem('ledger.cache.u1') || sessionStorage.getItem('ledger.cache.u1');
      return raw ? JSON.parse(raw) : null;
    });
    assert.equal(cached?.favorites?.length, 1);
    assert.equal(cached?.budget, 500000);

    // 다시 받을 수 있게 되면 정상
    await page.evaluate(() => sessionStorage.removeItem('__downRead'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await settle(page, 800);
    assert.equal(await bar.locator('button:has-text("커피")').count(), 1);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
