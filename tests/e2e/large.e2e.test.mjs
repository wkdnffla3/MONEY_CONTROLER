// 내역이 많을 때: Supabase는 한 번에 1,000줄까지만 주므로 나눠 받아야 함 (가짜 서버도 1,000줄 제한)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, menu, seedScript, tx } from './helpers.mjs';

const env = setup();
const Y = new Date().getFullYear();

test('내역 1,205건 → 모두 불러오고, 리포트·백업에도 전부 들어감', async () => {
  const rows = Array.from({ length: 1205 }, (_, i) => tx('t' + String(i).padStart(5, '0'), { amount: 1000, memo: 'm' + i, date: `${Y}-01-${String((i % 28) + 1).padStart(2, '0')}` }));
  const { ctx, page, errs } = await open(env, { seed: seedScript({ transactions: rows }) });
  const cached = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ledger.cache.u1') || sessionStorage.getItem('ledger.cache.u1')).tx).length);
  assert.equal(cached, 1205);
  await menu(page, '백업·복원');
  assert.match(await page.innerText('.backup .hint'), /내역 1,205건/);
  assert.deepEqual(errs, []);
  await ctx.close();
});
