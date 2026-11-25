// 새 버전 알림 · 장보기 결제 카드 · 반복 내역 카드/태그
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, settings, tx, db, tab, menu, norm } from './helpers.mjs';
const env = setup();
const cards = [{ id: 'k1', name: '삼성', payDay: 14, closeDay: 31, color: 2 }];
const KST = { timezoneId: 'Asia/Seoul' };
const item = (id, name, o = {}) => ({ id, user_id: 'u1', name, qty: 1, price: 3000, category: '식비', member_id: null, memo: '', checked: true, status: 'todo', paid: null, tx_id: null, bought_at: null, created_at: 1, ...o });

describe('장보기 결제 카드', () => {
  test('카드를 골라 결제 확정 → 그 카드 일시불 내역, 다음엔 그 카드가 기본', async () => {
    const seed = seedScript({ settingsRow: settings({ cards }), extra: { shopping_items: [item('i1', '우유'), item('i2', '빵')] } });
    const { ctx, page, errs } = await open(env, { seed });
    await tab(page, '장보기');
    await page.click('.cart-bar button:has-text("결제 확정")');
    await page.waitForSelector('.sheet');
    await page.click('.sheet .chip:has-text("삼성")');
    assert.match(await page.innerText('.sheet'), /청구 예정에 잡혀요/);
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(900);
    const t = (await db(page)).transactions;
    assert.equal(t.length, 1);
    assert.deepEqual([t[0].card_id, t[0].inst_months, t[0].amount], ['k1', 1, 6000]);
    // 다시 담아서 결제 → 삼성이 기본
    await page.evaluate(() => { const d = JSON.parse(sessionStorage.getItem('__fakedb')); d.shopping_items.push({ id: 'i3', user_id: 'u1', name: '계란', qty: 1, price: 5000, category: '식비', member_id: null, memo: '', checked: true, status: 'todo', paid: null, tx_id: null, bought_at: null, created_at: 2 }); sessionStorage.setItem('__fakedb', JSON.stringify(d)); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(700);
    await page.click('.cart-bar button:has-text("결제 확정")');
    await page.waitForSelector('.sheet');
    assert.equal(await page.locator('.sheet .chip[aria-pressed="true"]:has-text("삼성")').count(), 1);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('물품별로 나누기도 고른 카드로', async () => {
    const seed = seedScript({ settingsRow: settings({ cards }), extra: { shopping_items: [item('i1', '우유'), item('i2', '빵')] } });
    const { ctx, page, errs } = await open(env, { seed });
    await tab(page, '장보기');
    await page.click('.cart-bar button:has-text("결제 확정")');
    await page.click('.sheet button:has-text("물품별로 나누기")');
    await page.click('.sheet .chip:has-text("삼성")');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(900);
    const t = (await db(page)).transactions;
    assert.equal(t.length, 2);
    assert.ok(t.every((x) => x.card_id === 'k1'));
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

describe('반복 내역 카드·태그', () => {
  test('카드·태그 붙인 새 내역을 반복으로 → 다음 달 자동 기록도 같은 카드·태그', async () => {
    const { ctx, page, errs } = await open(env, {
      seed: seedScript({ settingsRow: settings({ cards }) }), path: '#list', contextOptions: KST,
      beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
    });
    await page.click('.fab');
    await page.waitForSelector('.sheet');
    await page.fill('.sheet .amount-input input', '17000');
    await page.fill('.sheet input[id$="-memo"]', '넷플릭스');
    await page.fill('.sheet input[id$="-date"]', '2026-11-10');
    await page.click('.sheet .chip:has-text("삼성")');
    await page.fill('.sheet input[aria-label="태그 입력"]', '구독');
    await page.keyboard.press('Enter');
    await page.click('.sheet .repeat-toggle');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(800);
    let d = await db(page);
    const rule = d.settings[0].recurring[0];
    assert.deepEqual([rule.cardId, rule.tags], ['k1', ['구독']]);
    await page.clock.runFor(25 * 24 * 3600 * 1000); // 12월 13일
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(1200);
    d = await db(page);
    const dec = d.transactions.find((x) => x.date === '2026-12-10');
    assert.ok(dec, '12월 자동 기록');
    assert.deepEqual([dec.card_id, dec.tags, dec.inst_months], ['k1', ['구독'], 1]);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('반복 내역 관리에서 결제 카드·태그 고르기, 목록에 표시', async () => {
    const rule = { id: 'r1', type: 'expense', amount: 55000, category: '식비', memo: '통신비', memberId: null, day: 28, start: '2026-11', end: null, last: '2026-11', active: true };
    const { ctx, page, errs } = await open(env, { seed: seedScript({ settingsRow: settings({ cards, recurring: [rule] }) }) });
    await menu(page, '반복 내역');
    await page.click('.sheet .rule-list li:has-text("통신비") button:has-text("수정")');
    await page.click('.sheet .chip:has-text("삼성")');
    await page.fill('.sheet #rr-tags', '고정비');
    await page.keyboard.press('Enter');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(800);
    const r = (await db(page)).settings[0].recurring[0];
    assert.deepEqual([r.cardId, r.tags], ['k1', ['고정비']]);
    assert.match(norm(await page.innerText('.sheet .rule-list')), /💳 삼성 · #고정비/);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

describe('새 버전 알림', () => {
  test('서버의 index.html 이 바뀌면(새 배포) 화면으로 돌아올 때 알림 → 새로고침', async () => {
    const { ctx, page, errs } = await open(env, { seed: seedScript() });
    assert.equal(await page.locator('.update-bar').count(), 0);
    const base = new URL(page.url()).origin;
    await page.route(`${base}/`, async (route) => {
      if (route.request().headers()['x-update-check'] !== '1') return route.continue();
      const res = await route.fetch();
      const html = (await res.text()).replace('/assets/index.js', '/assets/index-NEWBUILD.js');
      return route.fulfill({ response: res, body: html });
    });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(600);
    assert.match(await page.innerText('.update-bar'), /새 버전이 있어요/);
    await page.click('.update-bar button:has-text("나중에")');
    assert.equal(await page.locator('.update-bar').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('같은 버전이면 알림 없음', async () => {
    const { ctx, page, errs } = await open(env, { seed: seedScript() });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.update-bar').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

describe('예산: 곧 기록될 반복 지출', () => {
  test('하루 쓸 수 있는 금액에서 이번 달 남은 반복 지출(월세 등)을 미리 뺌', async () => {
    const rule = { id: 'r1', type: 'expense', amount: 100000, category: '식비', memo: '월세', memberId: null, day: 28, start: '2026-01', end: null, last: '2026-10', active: true };
    const { ctx, page, errs } = await open(env, {
      seed: seedScript({ settingsRow: settings({ budget: 230000, recurring: [rule] }) }), contextOptions: KST,
      beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
    });
    // 남은 13일(18~30일), (230,000 - 100,000) / 13 = 10,000
    assert.match(norm(await page.innerText('.card:has(h2:has-text("월 예산"))')), /남은 13일 동안 하루 10,000원까지 쓸 수 있어요\. \(곧 기록될 반복 지출 100,000원 빼고\)/);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

test('다른 달을 보면 요약 제목도 그 달 ("이번 달 잔액" X), 하루 평균은 오늘까지만', async () => {
  const { ctx, page, errs } = await open(env, {
    seed: seedScript({ transactions: [tx('a', { date: '2026-11-02', amount: 18000 }), tx('b', { date: '2026-11-29', amount: 900000 })] }),
    contextOptions: KST, beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
  });
  assert.match(await page.innerText('.summary .stat.bal .k'), /^이번 달 잔액$/);
  // 29일 앞날짜 90만 원은 하루 평균에 안 넣음: 18,000 / 18일 = 1,000
  assert.match(norm(await page.innerText('.card:has(h2:has-text("일별 지출")) h2')), /하루 평균 1,000원/);
  await page.click('.monthbar button[aria-label="이전 달"]');
  assert.match(await page.innerText('.summary .stat.bal .k'), /^10월 잔액$/);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('장보기 빠른 추가: 같은 이름이 살 것에 있으면 수량 +1 (중복 안 만듦)', async () => {
  const seed = seedScript({ extra: { shopping_items: [item('i1', '우유', { checked: false })] } });
  const { ctx, page, errs } = await open(env, { seed });
  await tab(page, '장보기');
  await page.fill('.quick-add input[aria-label="물품 이름"]', ' 우 유 ');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const items = (await db(page)).shopping_items;
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 2);
  assert.match(await page.innerText('.toast'), /우유 수량을 2개로 늘렸어요/);
  await page.fill('.quick-add input[aria-label="물품 이름"]', '빵');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  assert.equal((await db(page)).shopping_items.length, 2);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('내역 빠른 검색: 카드 이름·공동으로도', async () => {
  const seed = seedScript({
    transactions: [tx('a', { memo: '점심', card_id: 'k1' }), tx('b', { memo: '저녁', member_id: 'm1' }), tx('c', { memo: '간식' })],
    settingsRow: settings({ cards, members: [{ id: 'm1', name: '민지', color: 0 }] }),
  });
  const { ctx, page, errs } = await open(env, { seed, path: '#list' });
  await page.fill('.toolbar input[type="search"]', '삼성');
  assert.deepEqual(await page.locator('.tx .memo').allInnerTexts().then((x) => x.map((s) => s.includes('점심'))), [true]);
  await page.fill('.toolbar input[type="search"]', '공동');
  assert.equal(await page.locator('.tx').count(), 2);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('카테고리별 예산도 곧 기록될 반복 지출을 미리 반영', async () => {
  const rule = { id: 'r1', type: 'expense', amount: 30000, category: '식비', memo: '급식비', memberId: null, day: 28, start: '2026-01', end: null, last: '2026-10', active: true };
  const { ctx, page, errs } = await open(env, {
    seed: seedScript({ transactions: [tx('a', { date: '2026-11-03', amount: 80000 })], settingsRow: settings({ cat_budgets: { 식비: 100000 }, recurring: [rule] }) }),
    contextOptions: KST, beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
  });
  assert.match(norm(await page.innerText('.catbud')), /곧 기록될 반복 30,000원까지 더하면 10,000원 넘어요/);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('반복 내역·즐겨찾기 삭제 → 되돌리기로 원래 자리에', async () => {
  const r = (id, memo) => ({ id, type: 'expense', amount: 1000, category: '식비', memo, memberId: null, day: 28, start: '2026-11', end: null, last: '2026-11', active: true });
  const f = (id, label) => ({ id, label, type: 'expense', amount: 1000, category: '식비', memo: '', memberId: null, cardId: null, tags: [] });
  const { ctx, page, errs } = await open(env, { seed: seedScript({ settingsRow: settings({ recurring: [r('r1', '월세'), r('r2', '통신비'), r('r3', '보험')], favorites: [f('f1', '커피'), f('f2', '점심')] }) }) });
  await menu(page, '반복 내역');
  await page.click('.sheet .rule-list li:has-text("통신비") button:has-text("삭제")');
  await page.waitForTimeout(600);
  assert.deepEqual((await db(page)).settings[0].recurring.map((x) => x.id), ['r1', 'r3']);
  await page.click('.toast button:has-text("되돌리기")');
  await page.waitForTimeout(600);
  assert.deepEqual((await db(page)).settings[0].recurring.map((x) => x.id), ['r1', 'r2', 'r3']);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await menu(page, '즐겨찾기');
  await page.click('.sheet .fav-row:has-text("커피")');
  await page.click('.sheet button.danger:has-text("삭제")');
  await page.waitForTimeout(600);
  assert.deepEqual((await db(page)).settings[0].favorites.map((x) => x.id), ['f2']);
  await page.click('.toast button:has-text("되돌리기")');
  await page.waitForTimeout(600);
  assert.deepEqual((await db(page)).settings[0].favorites.map((x) => x.id), ['f1', 'f2']);
  assert.deepEqual(errs, []);
  await ctx.close();
});
