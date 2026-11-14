// 메모 200자·메모 속 링크·자정 날짜 갱신
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, tab, seedScript, settings, tx, db, pending } from './helpers.mjs';

const env = setup();
const linkSeed = seedScript({ transactions: [
  tx('L1', { amount: 15000, category: '쇼핑', memo: '쿠팡 주문 https://www.coupang.com/vp/products/123 (영수증)', created_at: 1 }),
  tx('L2', { amount: 3000, memo: '링크 없음', created_at: 2 }),
] });

describe('메모', () => {
  test('메모 200자까지 입력·저장 (링크가 잘리지 않음)', async () => {
    const { ctx, page, errs } = await open(env, { path: '#list' });
    const link = 'https://example.com/receipt?id=' + 'a'.repeat(169); // 200자
    await page.click('.fab');
    await page.waitForSelector('.sheet');
    await page.fill('.sheet .amount-input input', '7700');
    const memo = page.locator('.sheet input[id$="-memo"]');
    await memo.fill(link + '초과분');
    assert.equal(await memo.getAttribute('maxlength'), '200');
    assert.equal((await memo.inputValue()).length, 200);
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(700);
    const row = (await db(page)).transactions.filter((t) => t.amount === 7700);
    assert.equal(row.length, 1);
    assert.equal(row[0].memo, link);
    assert.equal((await pending(page)).length, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 390);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

describe('메모 속 링크', () => {
  test('목록에 🔗 표시, 수정 화면에 링크 버튼 (새 탭, 앱 정보 안 넘김)', async () => {
    const { ctx, page, errs } = await open(env, { seed: linkSeed, path: '#list' });
    assert.equal(await page.locator('.tx:has-text("쿠팡") .link-mark').count(), 1);
    assert.equal(await page.locator('.tx:has-text("링크 없음") .link-mark').count(), 0);
    await page.click('.tx:has-text("쿠팡")');
    await page.waitForSelector('.sheet .memo-links');
    const a = page.locator('.sheet .memo-link').first();
    assert.equal(await a.getAttribute('href'), 'https://www.coupang.com/vp/products/123'); // 괄호·뒤 문장부호 제외
    assert.equal(await a.getAttribute('target'), '_blank');
    const rel = await a.getAttribute('rel');
    assert.ok(rel.includes('noopener') && rel.includes('noreferrer'), rel);
    // 외부로 나가지 않게 막고, 새 탭이 열리는지만 확인
    await ctx.route('https://www.coupang.com/**', (r) => r.fulfill({ status: 200, body: 'ok' }));
    const [popup] = await Promise.all([ctx.waitForEvent('page'), a.click()]);
    assert.ok(popup.url().startsWith('https://www.coupang.com/'), popup.url());
    assert.ok(page.url().endsWith('#list'));
    await popup.close();
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('입력하는 동안 바로 반영, javascript: 주소는 무시, 장보기 메모에도 링크', async () => {
    const { ctx, page, errs } = await open(env, { seed: linkSeed, path: '#list' });
    await page.click('.fab');
    await page.waitForSelector('.sheet');
    await page.fill('.sheet input[id$="-memo"]', 'javascript:alert(1) 그리고 http://a.kr/x 와 https://b.com');
    const links = page.locator('.sheet .memo-link');
    const hrefs = [];
    for (let i = 0; i < await links.count(); i++) hrefs.push(await links.nth(i).getAttribute('href'));
    assert.deepEqual(hrefs, ['http://a.kr/x', 'https://b.com/']);
    await page.click('.sheet button[aria-label="닫기"]');
    await tab(page, '장보기');
    await page.click('.fab');
    await page.waitForSelector('#si-memo');
    await page.fill('#si-name', '휴지');
    await page.fill('#si-memo', '최저가 https://shop.example/p/1');
    assert.equal(await page.locator('.sheet .memo-link').count(), 1);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

describe('자정', () => {
  test('앱을 켜 둔 채 자정이 지나면 몇 초 안에 새 달 반복 내역 생성', async () => {
    const seed = seedScript({
      transactions: [tx('L2', { memo: '링크 없음', date: '2026-11-30' })],
      settingsRow: settings({ recurring: [{ id: 'r1', type: 'expense', amount: 500000, category: '주거·통신', memo: '월세', memberId: null, day: 1, start: '2026-11', end: null, last: '2026-11', active: true }] }),
    });
    const { ctx, page, errs } = await open(env, {
      seed, contextOptions: { timezoneId: 'Asia/Seoul' },
      beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-30T23:59:40+09:00') }),
    });
    await page.clock.runFor(3000);
    const ids = async () => [...(await db(page)).transactions.map((t) => t.id), ...(await pending(page)).map((o) => o.id).filter(Boolean)];
    assert.ok(!(await ids()).includes('rec-r1-2026-12'));
    await page.clock.runFor(30_000); // 00:00:13
    await page.clock.runFor(3000);
    assert.ok((await ids()).includes('rec-r1-2026-12'), JSON.stringify(await ids()));
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

