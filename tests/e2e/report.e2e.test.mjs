// 리포트: 줄을 누르면 그 묶음의 내역 펼치기(10개씩 더 보기), 카테고리·태그 전체 보기, 큰 지출 더 보기, 내역 누르면 수정 화면
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, tab, seedScript, settings, tx, norm } from './helpers.mjs';

const env = setup();
const Y = new Date().getFullYear();
const cats = ['식비', '카페·간식', '교통', '쇼핑', '주거·통신', '의료·건강', '문화·여가', '교육', '경조사', '생활용품'];
const rows = [
  ...Array.from({ length: 25 }, (_, i) => tx('f' + i, { category: '식비', amount: 1000 * (i + 1), memo: '밥' + i, date: `${Y}-0${(i % 9) + 1}-1${i % 9}`, tags: i < 3 ? ['외식'] : [] })),
  ...cats.slice(1).map((c, i) => tx('c' + i, { category: c, amount: 500 + i, memo: c + '내역', date: `${Y}-02-0${(i % 9) + 1}`, tags: [`태그${i}`, i % 2 ? '공통' : '혼자'] })),
];
const seed = seedScript({ transactions: rows, settingsRow: settings({ members: [{ id: 'm1', name: '민지', color: 0 }] }) });

describe('리포트 펼쳐 보기', () => {
  test('카테고리 줄 → 그 카테고리 내역(큰 금액 순 10개), 더 보기, 다시 누르면 접힘', async () => {
    const { ctx, page, errs } = await open(env, { seed });
    await tab(page, '리포트');
    const row = page.locator('.share-row', { hasText: '식비' }).first();
    assert.equal(await row.getAttribute('aria-expanded'), 'false');
    await row.click();
    assert.equal(await row.getAttribute('aria-expanded'), 'true');
    const items = page.locator('.share-list li.open .share-items li');
    assert.equal(await items.count(), 10);
    assert.match(norm(await items.first().innerText()), /밥24.*25,000원/);
    await page.click('.share-list li.open .share-items .more:has-text("15건 남음")');
    assert.equal(await items.count(), 25);
    assert.equal(await page.locator('.share-list li.open .share-items .more').count(), 0);
    await row.click();
    assert.equal(await page.locator('.share-list li.open').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('카테고리 8개 넘으면 "전체 보기", 태그 10개 넘으면 "전체 보기"', async () => {
    const { ctx, page } = await open(env, { seed });
    await tab(page, '리포트');
    const catCard = page.locator('.card', { has: page.locator('h2:has-text("카테고리별 지출")') });
    assert.equal(await catCard.locator('.share-row').count(), 8);
    await catCard.locator('button:has-text("전체 보기 (2개 더)")').click();
    assert.equal(await catCard.locator('.share-row').count(), 10);
    await catCard.locator('button:has-text("접기")').click();
    assert.equal(await catCard.locator('.share-row').count(), 8);
    const tagCard = page.locator('.card', { has: page.locator('h2:has-text("태그별 지출")') });
    const total = await tagCard.locator('.share-row').count();
    assert.equal(total, 10);
    await tagCard.locator('button:has-text("전체 보기")').click();
    assert.equal(await tagCard.locator('.share-row').count(), 12); // 외식 + 태그0~8 + 공통 + 혼자
    await ctx.close();
  });

  test('큰 지출: TOP 5 → 더 보기 20 → 접기, 내역을 누르면 수정 화면', async () => {
    const { ctx, page, errs } = await open(env, { seed });
    await tab(page, '리포트');
    const list = page.locator('.top-list li');
    assert.equal(await list.count(), 5);
    await page.click('button:has-text("더 보기 (29건 남음)")');
    assert.equal(await list.count(), 20);
    assert.match(norm(await page.innerText('.card:has(.top-list) h2')), /TOP 20/);
    await page.click('.card:has(.top-list) button:has-text("접기")');
    assert.equal(await list.count(), 5);
    await list.first().locator('button').click();
    await page.waitForSelector('.sheet h3:has-text("내역 수정")');
    assert.equal(await page.inputValue('.sheet input[id$="-memo"]'), '밥24');
    await page.click('.sheet button[aria-label="닫기"]');
    // 펼친 묶음의 내역도 누르면 수정 화면
    await page.locator('.share-row', { hasText: '생활용품' }).first().click();
    await page.locator('.share-list li.open .share-items li button').first().click();
    await page.waitForSelector('.sheet h3:has-text("내역 수정")');
    assert.equal(await page.inputValue('.sheet input[id$="-memo"]'), '생활용품내역');
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('좁은 폰에서도 펼친 목록이 옆으로 넘치지 않음', async () => {
    const { ctx, page } = await open(env, { seed, width: 360 });
    await tab(page, '리포트');
    await page.locator('.share-row', { hasText: '식비' }).first().click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 360);
    await ctx.close();
  });
});
