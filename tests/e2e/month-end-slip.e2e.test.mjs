// 말일 결제가 다음 달 1일로 밀린 구독 → 알림 + 그 반복 내역 자동 기록 멈춤, 반복 내역 화면에 이유 표시
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, settings, tx, db, menu } from './helpers.mjs';

const env = setup();
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const prevLast = new Date(now.getFullYear(), now.getMonth(), 0); // 지난달 말일
const rule = { id: 'r1', type: 'expense', amount: 13900, category: '문화·여가', memo: '넷플릭스', memberId: null, day: 31, start: ym(prev), end: null, last: ym(prev), active: true };

test('말일 결제 반복 내역인데 이번 달 1일에 같은 결제를 직접 입력 → 알림, 자동 기록 멈춤, 이유 표시', async () => {
  const seed = seedScript({
    transactions: [
      tx(`rec-r1-${ym(prev)}`, { amount: 13900, category: '문화·여가', memo: '넷플릭스', date: `${ym(prev)}-${pad(prevLast.getDate())}` }),
      tx('m1', { amount: 13900, category: '문화·여가', memo: '넷플릭스', date: `${ym(now)}-01` }),
    ],
    settingsRow: settings({ recurring: [rule] }),
  });
  const { ctx, page, errs } = await open(env, { seed });
  await page.waitForSelector('.toast:has-text("자동 기록을 멈췄어요")', { timeout: 5000 });
  assert.match(await page.innerText('.toast'), /"넷플릭스" 결제가 말일이 아니라 \d+월 1일에 들어왔어요/);
  await page.waitForTimeout(500);
  const saved = (await db(page)).settings[0].recurring[0];
  assert.equal(saved.active, false);
  assert.equal(saved.pausedReason, 'slip');
  assert.equal(saved.slipTx, 'm1');
  // 알림의 "반복 내역 보기" → 반복 내역 화면에 이유
  await page.click('.toast button:has-text("반복 내역 보기")');
  await page.waitForSelector('.sheet .rule-slip');
  assert.match(await page.innerText('.sheet .rule-slip'), /다음 달 1일에 들어와서 자동 기록을 멈췄어요/);
  // 다시 시작하면 이유가 사라지고, 같은 결제로는 다시 멈추지 않음
  await page.click('.sheet .rule-actions button:has-text("다시 시작")');
  await page.waitForTimeout(800);
  const resumed = (await db(page)).settings[0].recurring[0];
  assert.equal(resumed.active, true);
  assert.equal(resumed.pausedReason, undefined);
  assert.equal(await page.locator('.sheet .rule-slip').count(), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('같은 결제가 말일에 정상으로 들어오면 아무것도 하지 않음', async () => {
  const seed = seedScript({
    transactions: [tx(`rec-r1-${ym(prev)}`, { amount: 13900, category: '문화·여가', memo: '넷플릭스', date: `${ym(prev)}-${pad(prevLast.getDate())}` })],
    settingsRow: settings({ recurring: [rule] }),
  });
  const { ctx, page, errs } = await open(env, { seed });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.toast:has-text("자동 기록을 멈췄어요")').count(), 0);
  assert.equal((await db(page)).settings[0].recurring[0].active, true);
  await menu(page, '반복 내역');
  assert.equal(await page.locator('.sheet .rule-slip').count(), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});
