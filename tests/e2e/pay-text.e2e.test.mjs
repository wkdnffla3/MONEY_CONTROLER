// 결제 문자로 입력: 새 내역 창의 "📋 결제 문자 붙여넣기", 안드로이드 "공유 → 가계부"(?share=1)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, settings, tx, db } from './helpers.mjs';

const env = setup();
const cards = [{ id: 'k1', name: '신한', payDay: 14, closeDay: 31, color: 2 }];
const SMS = '[Web발신]\n신한카드(1234)승인 홍*동 12,000원(일시불)11/27 14:23 스타벅스 누적123,456원';
const seed = () => seedScript({
  settingsRow: settings({ cards }),
  transactions: [tx('old1', { memo: '스타벅스', category: '카페·간식', amount: 5000, date: '2026-10-01' })],
});

describe('결제 문자 붙여넣기', () => {
  test('클립보드를 못 읽으면 붙여 넣는 칸 → 읽기 → 금액·날짜·가맹점·카드·카테고리 채움, 저장은 직접', async () => {
    const { ctx, page, errs } = await open(env, { path: '#list', seed: seed() });
    await page.click('button.fab');
    // 헤드리스 브라우저는 클립보드 권한이 없어 직접 붙여 넣는 칸이 열림
    await page.click('.sheet button:has-text("결제 문자 붙여넣기")');
    await page.fill('.sheet textarea[aria-label="결제 문자"]', SMS);
    await page.click('.sheet .pay-actions button:has-text("읽기")');
    assert.equal(await page.inputValue('.sheet .amount-input input'), '12,000');
    assert.match(await page.inputValue('.sheet input[type="date"]'), /-11-27$/);
    assert.equal(await page.inputValue('.sheet input[id$="-memo"]'), '스타벅스');
    assert.equal(await page.locator('.sheet .chip[aria-pressed="true"]:has-text("신한")').count(), 1);
    assert.equal(await page.locator('.sheet .chip[aria-pressed="true"]:has-text("카페·간식")').count(), 1); // 예전에 쓴 카테고리
    assert.match(await page.innerText('.sheet .pay-msg'), /읽었어요/);
    assert.equal((await db(page)).transactions.length, 1); // 아직 저장 안 됨
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(600);
    const saved = (await db(page)).transactions.find((t) => t.id !== 'old1');
    assert.equal(saved.amount, 12000);
    assert.equal(saved.memo, '스타벅스');
    assert.equal(saved.card_id, 'k1');
    assert.equal(saved.category, '카페·간식');
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('취소 문자·금액 없는 글은 채우지 않고 안내', async () => {
    const { ctx, page, errs } = await open(env, { path: '#list', seed: seed() });
    await page.click('button.fab');
    await page.click('.sheet button:has-text("결제 문자 붙여넣기")');
    await page.fill('.sheet textarea[aria-label="결제 문자"]', '신한카드(1234)승인취소 12,000원 11/27 14:23 스타벅스');
    await page.click('.sheet .pay-actions button:has-text("읽기")');
    assert.match(await page.innerText('.sheet .pay-msg'), /승인 취소 문자/);
    assert.equal(await page.inputValue('.sheet .amount-input input'), '');
    await page.fill('.sheet textarea[aria-label="결제 문자"]', '안녕하세요');
    await page.click('.sheet .pay-actions button:has-text("읽기")');
    assert.match(await page.innerText('.sheet .pay-msg'), /금액을 찾지 못했어요/);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('수정 창에는 붙여넣기 버튼이 없음', async () => {
    // 목록은 이번 달만 보이므로 이번 달 내역으로
    const { ctx, page } = await open(env, { path: '#list', seed: seedScript({ transactions: [tx('t1', { memo: '이번달커피' })] }) });
    await page.click('.tx:has-text("이번달커피")');
    await page.waitForSelector('.sheet');
    assert.equal(await page.locator('.sheet button:has-text("결제 문자 붙여넣기")').count(), 0);
    await ctx.close();
  });
});

describe('공유 → 가계부', () => {
  test('공유로 받은 글(?share=1)을 읽어 새 내역 창을 채워 열고, 받은 글은 바로 지움', async () => {
    const { ctx, page, errs } = await open(env, { seed: seed() });
    // 서비스워커가 하는 일(공유 글을 캐시에 넣기)을 흉내 낸 뒤 공유 주소로 열기
    await page.evaluate(async (text) => {
      const c = await caches.open('ledger-share');
      await c.put('/__shared-text', new Response(text));
    }, SMS);
    await page.goto(env.url + '?share=1');
    await page.waitForSelector('.sheet .amount-input input');
    assert.equal(await page.inputValue('.sheet .amount-input input'), '12,000');
    assert.equal(await page.inputValue('.sheet input[id$="-memo"]'), '스타벅스');
    assert.match(await page.inputValue('.sheet input[type="date"]'), /-11-27$/);
    assert.equal(await page.locator('.sheet .chip[aria-pressed="true"]:has-text("신한")').count(), 1);
    assert.equal(new URL(page.url()).search, ''); // 주소에서 ?share 지움
    assert.equal(await page.evaluate(async () => !!(await (await caches.open('ledger-share')).match('/__shared-text'))), false);
    assert.equal((await db(page)).transactions.length, 1); // 저장은 사람이 직접
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('받은 글이 없으면 안내만', async () => {
    const { ctx, page, errs } = await open(env, { seed: seed(), path: '?share=1' });
    await page.waitForSelector('.toast:has-text("공유한 내용을 읽지 못했어요")');
    assert.equal(await page.locator('.sheet').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
