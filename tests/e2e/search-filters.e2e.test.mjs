// 상세 검색: 안 보이는 조건(이름 바뀐 카테고리·지운 카드)이 결과를 0건으로 만들지 않게, 이번 달 앞날짜 포함
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, tx, settings, menu, settle } from './helpers.mjs';
const env = setup();
const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
const ym = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const seed = seedScript({
  transactions: [tx('a', { category: '식비', memo: '점심', date: `${ym}-01` }), tx('b', { category: '교통', memo: '버스', date: `${ym}-01` }),
    tx('c', { category: '식비', memo: '미리넣은', date: `${ym}-${p2(last)}` })],
  settingsRow: settings({ cards: [{ id: 'k1', name: '삼성', payDay: 14, closeDay: 31, color: 2 }] }),
});
const openSearch = async (page) => { await page.click('button:has-text("상세 검색")'); await settle(page, 300); };
const count = async (page) => Number((await page.innerText('.search-sum b')).replace(/\D/g, ''));
async function closeSheet(page) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

test('카테고리 이름을 바꾸면 검색 조건도 새 이름으로', async () => {
  const { ctx, page, errs } = await open(env, { seed, path: '#list' });
  await openSearch(page);
  await page.click('.adv-more summary');
  await page.click('.adv-search .chip:has-text("식비")');
  assert.equal(await count(page), 2);
  await closeSheet(page);
  await menu(page, '카테고리 편집');
  const names = page.locator('.sheet input[aria-label="이름"]');
  for (let i = 0; i < await names.count(); i++) if (await names.nth(i).inputValue() === '식비') { await names.nth(i).fill('밥값'); break; }
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(900);
  await openSearch(page);
  assert.equal(await count(page), 2);
  assert.equal(await page.locator('.adv-search .chip[aria-pressed="true"]:has-text("밥값")').count(), 1);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('고른 카드를 지우면 그 조건은 풀림 (안 보이는 조건으로 0건 X)', async () => {
  const { ctx, page, errs } = await open(env, { seed, path: '#list' });
  await openSearch(page);
  await page.click('.adv-more summary');
  await page.click('.adv-search .chip:has-text("삼성")');
  assert.equal(await count(page), 0);
  await closeSheet(page);
  await page.evaluate(() => {
    // 다른 기기에서 카드를 지운 것처럼: 서버 설정을 바꾸고 다시 불러오기
    const db = JSON.parse(sessionStorage.getItem('__fakedb')); db.settings[0].cards = []; sessionStorage.setItem('__fakedb', JSON.stringify(db));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(800);
  await openSearch(page);
  assert.equal(await count(page), 3);
  assert.equal(await page.locator('.adv-search button:has-text("조건 초기화")').count(), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});
