// 휴대폰 뒤로 가기: 시트만 닫히고 화면(탭)은 그대로, 버튼으로 닫으면 기록이 남지 않음
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, tab, settle } from './helpers.mjs';
const env = setup();
const sheetOpen = (page) => page.locator('.sheet').count();

test('입력창을 연 채 뒤로 가기 → 입력창만 닫힘, 탭 유지', async () => {
  const { ctx, page, errs } = await open(env);
  await tab(page, '내역');
  const url = page.url();
  await page.click('button.fab');
  await page.waitForTimeout(300);
  assert.equal(await sheetOpen(page), 1);
  await page.goBack();
  await page.waitForTimeout(300);
  assert.equal(await sheetOpen(page), 0);
  assert.equal(page.url(), url);
  assert.ok(await page.locator('.nav-tabs button[aria-current="page"]:has-text("내역")').count() >= 1);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('버튼으로 닫은 뒤 뒤로 가기 → 바로 이전 탭으로 (한 번 더 누를 필요 없음)', async () => {
  const { ctx, page } = await open(env);
  await tab(page, '내역');
  await page.click('button.fab');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await sheetOpen(page), 0);
  await page.goBack();
  await settle(page, 300);
  assert.ok(!page.url().includes('#list'));
  await ctx.close();
});

test('시트를 연 채 탭을 바꾸고 뒤로 가기 → 이전 탭', async () => {
  const { ctx, page } = await open(env);
  await tab(page, '내역');
  await page.click('button.fab');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await tab(page, '리포트');
  await page.goBack();
  await settle(page, 300);
  assert.ok(page.url().includes('#list'));
  await ctx.close();
});

test('수정 중인 내역이 다른 기기에서 지워지면 시트를 닫고 알림', async () => {
  const { seedScript, tx } = await import('./helpers.mjs');
  const { ctx, page, errs } = await open(env, { seed: seedScript({ transactions: [tx('t1', { memo: '지울것' })] }), path: '#list' });
  await page.click('.tx:has-text("지울것")');
  await page.waitForTimeout(300);
  assert.equal(await sheetOpen(page), 1);
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__fakedb')); db.transactions = []; sessionStorage.setItem('__fakedb', JSON.stringify(db));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(800);
  assert.equal(await sheetOpen(page), 0);
  assert.match(await page.innerText('.toast'), /다른 기기에서 지워진/);
  assert.deepEqual(errs, []);
  await ctx.close();
});

describe('입력하다 닫을 때 확인', () => {
  test('메모만 쓰고 저장을 눌러 "금액을 입력해 주세요"가 뜬 뒤 바깥을 눌러도 물어봄', async () => {
    const { ctx, page, errs } = await open(env, { path: '#list' });
    await page.click('button.fab');
    await page.fill('.sheet input[id$="-memo"]', '점심 메모');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(100);
    assert.match(await page.innerText('.sheet .err'), /금액/);
    await page.mouse.click(5, 5); // 바깥
    assert.equal(await page.locator('.leave-ask').count(), 1);
    await page.click('.leave-ask button:has-text("계속 입력")');
    assert.equal(await page.locator('.sheet input[id$="-memo"]').inputValue(), '점심 메모');
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('금액을 입력한 채 바깥·Esc·뒤로 가기 → 닫지 않고 물어봄, "계속 입력"하면 그대로', async () => {
    const { ctx, page, errs } = await open(env, { path: '#list' });
    await page.click('button.fab');
    await page.fill('.sheet .amount-input input', '12000');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.leave-ask').count(), 1);
    await page.click('.leave-ask button:has-text("계속 입력")');
    assert.equal(await page.locator('.sheet .amount-input input').inputValue(), '12,000');
    await page.mouse.click(5, 5); // 바깥
    assert.equal(await page.locator('.leave-ask').count(), 1);
    await page.click('.leave-ask button:has-text("계속 입력")');
    await page.goBack();
    await page.waitForTimeout(300);
    assert.equal(await sheetOpen(page), 1);
    assert.equal(await page.locator('.leave-ask').count(), 1);
    await page.click('.leave-ask button:has-text("닫기")');
    await page.waitForTimeout(300);
    assert.equal(await sheetOpen(page), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('아무것도 안 고쳤거나 저장한 뒤엔 그냥 닫힘, 검색 같은 시트는 묻지 않음', async () => {
    const { ctx, page, errs } = await open(env, { path: '#list' });
    await page.click('button.fab');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await sheetOpen(page), 0);
    await page.click('button:has-text("상세 검색")');
    await page.fill('.adv-search input[type="search"]', '점심');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await sheetOpen(page), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

test('반복 내역: 규칙 입력하다 "취소"로 목록에 돌아오면 닫을 때 묻지 않음, 입력 중이면 물어봄', async () => {
  const { menu } = await import('./helpers.mjs');
  const { ctx, page, errs } = await open(env);
  await menu(page, '반복 내역');
  await page.click('.sheet button:has-text("+ 반복 내역 추가")');
  await page.fill('#rr-amt', '5000');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.leave-ask').count(), 1);
  await page.click('.leave-ask button:has-text("계속 입력")');
  await page.click('.sheet button:has-text("취소")');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await sheetOpen(page), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});
