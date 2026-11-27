// 다른 기기에서 지운 내역·물품·댓글이 실시간으로 사라짐 (Supabase 삭제 이벤트는 필터 구독에 안 옴)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, tx, tab } from './helpers.mjs';
const env = setup();

test('다른 기기에서 지운 내역 → 새로고침 없이 사라짐, 다른 가계부 삭제는 무시', async () => {
  const { ctx, page, errs } = await open(env, { seed: seedScript({ transactions: [tx('t1', { memo: '지울내역' }), tx('t2', { memo: '남을내역' })] }), path: '#list' });
  assert.equal(await page.locator('.tx:has-text("지울내역")').count(), 1);
  await page.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__fakedb'));
    d.transactions = d.transactions.filter((x) => x.id !== 't1');
    sessionStorage.setItem('__fakedb', JSON.stringify(d));
    window.__loads = 0;
    window.__rt('transactions', { eventType: 'DELETE', old: { id: 'other-ledger-row' } }); // 남의 가계부 줄
    window.__rt('transactions', { eventType: 'DELETE', old: { id: 't1' } });
  });
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.tx:has-text("지울내역")').count(), 0);
  assert.equal(await page.locator('.tx:has-text("남을내역")').count(), 1);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('다른 기기에서 지운 장보기 물품 → 사라짐', async () => {
  const item = { id: 'i1', user_id: 'u1', name: '지울우유', qty: 1, price: 0, category: '식비', member_id: null, memo: '', checked: false, status: 'todo', paid: null, tx_id: null, bought_at: null, created_at: 1 };
  const { ctx, page, errs } = await open(env, { seed: seedScript({ extra: { shopping_items: [item] } }) });
  await tab(page, '장보기');
  assert.equal(await page.locator('text=지울우유').count(), 1);
  await page.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('__fakedb'));
    d.shopping_items = [];
    sessionStorage.setItem('__fakedb', JSON.stringify(d));
    window.__rt('shopping_items', { eventType: 'DELETE', old: { id: 'i1' } });
  });
  await page.waitForTimeout(900);
  assert.equal(await page.locator('text=지울우유').count(), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('다른 사람이 지운 댓글 → 열어 둔 내역에서 사라짐', async () => {
  const c = { id: 'c1', user_id: 'u1', tx_id: 't1', author: 'u2', author_name: '준호', body: '지울댓글', created_at: new Date().toISOString() };
  const { ctx, page, errs } = await open(env, { seed: seedScript({ transactions: [tx('t1', { memo: '점심' })], extra: { tx_comments: [c] } }), path: '#list' });
  await page.click('.tx:has-text("점심")');
  await page.waitForSelector('.comment-list');
  assert.match(await page.innerText('.comment-list'), /지울댓글/);
  await page.evaluate(() => window.__rt('tx_comments', { eventType: 'DELETE', old: { id: 'c1' } }));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.comment-list:has-text("지울댓글")').count(), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});
