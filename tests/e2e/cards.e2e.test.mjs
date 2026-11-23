// 카드 관리: 내역이 있는 카드는 한 번 더 확인 후 삭제, 지운 카드가 골라진 내역을 수정하면 현금·일시불로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, settings, tx, db, menu } from './helpers.mjs';
const env = setup();
const cards = [{ id: 'k1', name: '삼성', payDay: 14, closeDay: 31, color: 2 }, { id: 'k2', name: '현대', payDay: 1, closeDay: 31, color: 3 }];
const seed = seedScript({ transactions: [tx('t1', { memo: '노트북', card_id: 'k1', inst_months: 6, amount: 1200000 })], settingsRow: settings({ cards }) });

test('내역 있는 카드는 확인 후 삭제, 없는 카드는 바로', async () => {
  const { ctx, page, errs } = await open(env, { seed, path: '#list' });
  await menu(page, '신용카드');
  const row = (n) => page.locator('.sheet .rule-list li', { hasText: n });
  await row('삼성').locator('button:has-text("삭제")').click();
  assert.match(await row('삼성').innerText(), /내역 1건이 "현금·기타"로/);
  assert.equal((await db(page)).settings[0].cards.length, 2);
  await row('삼성').locator('button:has-text("취소")').click();
  assert.equal(await row('삼성').locator('button:has-text("정말 삭제")').count(), 0);
  await row('현대').locator('button:has-text("삭제")').click();
  await page.waitForTimeout(600);
  assert.deepEqual((await db(page)).settings[0].cards.map((c) => c.id), ['k1']);
  await row('삼성').locator('button:has-text("삭제")').click();
  await row('삼성').locator('button:has-text("정말 삭제")').click();
  await page.waitForTimeout(600);
  assert.equal((await db(page)).settings[0].cards.length, 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('지운 카드의 할부 내역을 수정 저장 → 카드 없음·일시불 (할부만 남지 않음)', async () => {
  const s2 = seedScript({ transactions: [tx('t1', { memo: '노트북', card_id: 'gone', inst_months: 6, amount: 1200000 })], settingsRow: settings({ cards }) });
  const { ctx, page, errs } = await open(env, { seed: s2, path: '#list' });
  await page.click('.tx:has-text("노트북")');
  await page.waitForSelector('.sheet');
  await page.fill('.sheet input[id$="-memo"]', '노트북2');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(700);
  const t = (await db(page)).transactions.find((x) => x.id === 't1');
  assert.equal(t.memo, '노트북2');
  assert.equal(t.card_id, null);
  assert.equal(t.inst_months, 1);
  assert.deepEqual(errs, []);
  await ctx.close();
});
