// 입력하다 만 칸: 이름·태그를 쓰고 "추가"·엔터 없이 바로 저장해도 같이 저장되는지 (사람·카테고리·태그)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, db, menu } from './helpers.mjs';
const env = setup();

test('새 이름 입력 후 바로 저장 → 그 사람도 저장, "나"로 선택', async () => {
  const { ctx, page, errs } = await open(env);
  await menu(page, '함께 쓰는 사람');
  await page.fill('.sheet input[aria-label="새 사람 이름"]', '엄마');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(700);
  assert.deepEqual((await db(page)).settings[0].members.map((m) => m.name), ['엄마']);
  await menu(page, '함께 쓰는 사람');
  assert.equal(await page.locator('.sheet .member-edit input[type="radio"]').first().isChecked(), true);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('카테고리 편집: 새 이름만 쓰고 저장 → 그 카테고리도 저장', async () => {
  const { ctx, page, errs } = await open(env);
  await menu(page, '카테고리 편집');
  await page.fill('.sheet input[aria-label="새 카테고리 이름"]', '반려동물');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(700);
  assert.ok((await db(page)).settings[0].categories.expense.some((c) => c.name === '반려동물'));
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('내역 입력: 태그를 쓰고 엔터 없이 바로 저장 → 태그도 저장', async () => {
  const { ctx, page, errs } = await open(env, { path: '#list' });
  await page.click('.fab');
  await page.waitForSelector('.sheet');
  await page.fill('.sheet .amount-input input', '5000');
  await page.fill('.sheet input[aria-label="태그 입력"]', '여행');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(700);
  assert.deepEqual((await db(page)).transactions[0].tags, ['여행']);
  assert.deepEqual(errs, []);
  await ctx.close();
});
