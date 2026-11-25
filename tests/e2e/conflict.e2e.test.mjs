// 017 버전 확인: 다른 기기·사람이 먼저 고친 것을 덮어쓰지 않고 알림, 버튼으로 내 내용 다시 저장
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, settings, tx, db, pending, norm, menu } from './helpers.mjs';
const env = setup();
const seed = seedScript({ transactions: [tx('t1', { memo: '점심', amount: 1000 })] });
// 다른 기기에서 고친 것처럼: 서버(가짜 DB)만 바꾸고 이 기기엔 알리지 않음
const other = (page, fn) => page.evaluate((src) => {
  const d = JSON.parse(sessionStorage.getItem('__fakedb'));
  new Function('d', src)(d);
  sessionStorage.setItem('__fakedb', JSON.stringify(d));
}, fn);
const openTx = async (page, memo) => { await page.click(`.tx:has-text("${memo}")`); await page.waitForSelector('.sheet'); };
const toast = async (page) => norm(await page.innerText('.toast'));

describe('동시에 고칠 때', () => {
  test('다른 기기가 먼저 고친 내역을 수정 → 저장 안 함 + 알림, 최신 내용 표시 → "내 것으로 저장"', async () => {
    const { ctx, page, errs } = await open(env, { seed, path: '#list' });
    await openTx(page, '점심');
    await other(page, "const t = d.transactions.find((x) => x.id === 't1'); t.amount = 2000; t.version = 2;");
    await page.fill('.sheet input[id$="-memo"]', '저녁');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(900);
    assert.match(await toast(page), /다른 기기에서 먼저 고친 내역이라 내 수정은 저장하지 않았어요/);
    let t = (await db(page)).transactions.find((x) => x.id === 't1');
    assert.deepEqual([t.amount, t.memo], [2000, '점심']);
    assert.equal(await page.locator('.tx:has-text("점심")').count(), 1); // 최신 내용
    assert.equal((await pending(page)).length, 0);
    await page.click('.toast button:has-text("내 것으로 저장")');
    await page.waitForTimeout(900);
    t = (await db(page)).transactions.find((x) => x.id === 't1');
    assert.deepEqual([t.amount, t.memo, t.version], [1000, '저녁', 3]);
    assert.match(await toast(page), /내 내용으로 저장했어요/);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('오프라인에서 고친 내역을 다른 기기가 지움 → 연결되면 알림 → "다시 살리기"', async () => {
    const { ctx, page, errs } = await open(env, { seed, path: '#list' });
    await ctx.setOffline(true);
    await openTx(page, '점심');
    await page.fill('.sheet input[id$="-memo"]', '오프라인 수정');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(400);
    await other(page, "d.transactions = d.transactions.filter((x) => x.id !== 't1');");
    await ctx.setOffline(false);
    await page.waitForTimeout(1500);
    assert.match(await toast(page), /다른 기기에서 지운 내역이라 저장하지 않았어요/);
    assert.equal((await db(page)).transactions.length, 0);
    assert.equal(await page.locator('.tx:has-text("오프라인 수정")').count(), 0);
    await page.click('.toast button:has-text("다시 살리기")');
    await page.waitForTimeout(900);
    const t = (await db(page)).transactions.find((x) => x.id === 't1');
    assert.equal(t.memo, '오프라인 수정');
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('다른 기기가 고친 내역을 지우려 하면 지우지 않음 → "그래도 지우기"', async () => {
    const { ctx, page, errs } = await open(env, { seed, path: '#list' });
    await other(page, "const t = d.transactions.find((x) => x.id === 't1'); t.memo = '고침'; t.version = 2;");
    await openTx(page, '점심');
    await page.click('.sheet button:has-text("삭제")');
    await page.waitForTimeout(900);
    assert.match(await toast(page), /다른 기기에서 고친 내역이라 지우지 않았어요/);
    assert.equal((await db(page)).transactions.length, 1);
    assert.equal(await page.locator('.tx:has-text("고침")').count(), 1);
    await page.click('.toast button:has-text("그래도 지우기")');
    await page.waitForTimeout(900);
    assert.equal((await db(page)).transactions.length, 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('설정(예산): 다른 기기가 먼저 바꿨으면 저장 안 함 → "내 것으로 저장"', async () => {
    const { ctx, page, errs } = await open(env, { seed });
    await other(page, "d.settings[0].budget = 800000; d.settings[0].ver = { budget: 1 };");
    await menu(page, '월 예산');
    await page.fill('#budget-amt', '500000');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(900);
    assert.match(await toast(page), /다른 기기에서 먼저 예산을 바꿔서/);
    assert.equal((await db(page)).settings[0].budget, 800000);
    await page.click('.toast button:has-text("내 것으로 저장")');
    await page.waitForTimeout(900);
    assert.equal((await db(page)).settings[0].budget, 500000);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

describe('내 저장끼리는 충돌로 보지 않음', () => {
  test('같은 내역을 연달아 두 번 고침 (첫 저장 응답 전에 두 번째)', async () => {
    const { ctx, page, errs } = await open(env, { seed, path: '#list' });
    await openTx(page, '점심');
    await page.fill('.sheet input[id$="-memo"]', '첫번째');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(10);
    await openTx(page, '첫번째');
    await page.fill('.sheet input[id$="-memo"]', '두번째');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(1200);
    const t = (await db(page)).transactions.find((x) => x.id === 't1');
    assert.equal(t.memo, '두번째');
    assert.doesNotMatch(await page.innerText('.toast'), /다른 기기/);
    assert.equal((await pending(page)).length, 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('저장은 됐는데 응답이 사라짐 → 다시 보낼 때 내 것이면 성공 (새 내역·수정·예산)', async () => {
    const { ctx, page, errs } = await open(env, { seed, path: '#list' });
    await page.evaluate(() => { window.__net = 'lost'; });
    await openTx(page, '점심');
    await page.fill('.sheet input[id$="-memo"]', '응답유실');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(4500);
    await page.evaluate(() => { window.__net = 'lost'; });
    await page.click('.fab');
    await page.fill('.sheet .amount-input input', '3300');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(4500);
    const d = await db(page);
    assert.equal(d.transactions.find((x) => x.id === 't1').memo, '응답유실');
    assert.equal(d.transactions.filter((x) => x.amount === 3300).length, 1);
    assert.equal((await pending(page)).length, 0);
    assert.doesNotMatch(await page.innerText('.toast'), /다른 기기/);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('017 전 DB: 예전처럼 나중에 저장한 쪽이 남음 (오류 없음)', async () => {
    const { ctx, page, errs } = await open(env, { seed, path: '#list', init: [() => sessionStorage.setItem('__no017', '1')] });
    await openTx(page, '점심');
    await other(page, "const t = d.transactions.find((x) => x.id === 't1'); t.amount = 2000;");
    await page.fill('.sheet input[id$="-memo"]', '덮어씀');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(900);
    const t = (await db(page)).transactions.find((x) => x.id === 't1');
    assert.deepEqual([t.amount, t.memo], [1000, '덮어씀']);
    assert.match(await page.innerText('.notice'), /017/); // 업데이트 안내
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

test('수정 창을 열어 둔 사이 다른 기기가 고치고 이 기기가 그걸 받아도(실시간) → 창을 연 때 기준으로 알림', async () => {
  const { ctx, page, errs } = await open(env, { seed, path: '#list' });
  await openTx(page, '점심');
  await other(page, "const t = d.transactions.find((x) => x.id === 't1'); t.amount = 2500; t.version = 2;");
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // 새로 불러옴 (버전 2를 앎)
  await page.waitForTimeout(600);
  await page.fill('.sheet input[id$="-memo"]', '창 열어둔 수정');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(900);
  assert.match(await toast(page), /먼저 고친 내역/);
  assert.equal((await db(page)).transactions.find((x) => x.id === 't1').amount, 2500);
  assert.deepEqual(errs, []);
  await ctx.close();
});

describe('설정 자동 합치기', () => {
  test('두 기기에서 즐겨찾기를 하나씩 추가 → 알림 없이 둘 다 저장', async () => {
    const { ctx, page, errs } = await open(env, { seed, path: '#list' });
    await other(page, "d.settings[0].favorites = [{ id: 'fo', label: '다른기기', type: 'expense', amount: 500, category: '교통', memo: '', memberId: null, cardId: null, tags: [] }]; d.settings[0].ver = { favorites: 1 };");
    await openTx(page, '점심');
    await page.click('.sheet .fav-add-btn');
    await page.waitForTimeout(1000);
    const favs = (await db(page)).settings[0].favorites;
    assert.equal(favs.length, 2);
    assert.ok(favs.some((x) => x.id === 'fo'));
    assert.doesNotMatch(await page.innerText('.toast'), /다른 기기/);
    assert.equal((await pending(page)).length, 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('같은 반복 내역을 다른 기기는 기록(last), 이 기기는 금액 수정 → 칸별로 합침', async () => {
    const rule = { id: 'r1', type: 'expense', amount: 55000, category: '식비', memo: '통신비', memberId: null, day: 28, start: '2026-01', end: null, last: '2026-10', active: true };
    const { ctx, page, errs } = await open(env, { seed: seedScript({ settingsRow: settings({ recurring: [rule] }) }) });
    await other(page, "d.settings[0].recurring = [{ ...d.settings[0].recurring[0], last: '2026-11', memo: '통신비' }]; d.settings[0].ver = { recurring: 1 };");
    await menu(page, '반복 내역');
    await page.click('.sheet .rule-list li:has-text("통신비") button:has-text("수정")');
    await page.fill('.sheet .amount-input input', '61000');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(1000);
    const r = (await db(page)).settings[0].recurring[0];
    assert.deepEqual([r.amount, r.last], [61000, '2026-11']);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
