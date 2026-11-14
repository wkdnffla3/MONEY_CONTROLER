// 오프라인 보관·재전송·중복 방지, 카테고리 이름 변경(요청 1번), DB 업데이트 전(011) 보관
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, tab, menu, addTx, seedScript, tx, db, pending, norm } from './helpers.mjs';

const env = setup();
const memos = async (page) => (await db(page)).transactions.map((t) => t.memo).sort();

async function editMemo(page, from, to) {
  await page.click(`.tx:has-text("${from}")`);
  await page.waitForSelector('.sheet');
  await page.fill('.sheet input[id$="-memo"]', to);
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(300);
}

describe('오프라인과 재전송', () => {
  test('오프라인에서 추가·수정·삭제 → 화면엔 바로, 연결되면 최종 상태만 한 번씩 올라감', async () => {
    const { ctx, page, errs } = await open(env, { path: '#list' });
    await ctx.setOffline(true);
    await addTx(page, 10000, '택시');
    await addTx(page, 20000, '점심');
    await addTx(page, 30000, '마트');
    await editMemo(page, '점심', '점심(수정1)');
    await editMemo(page, '점심(수정1)', '점심(수정2)');
    await page.click('.tx:has-text("마트")');
    await page.waitForSelector('.sheet');
    await page.click('.sheet .btn.danger');
    await page.waitForTimeout(300);
    const shown = (await page.locator('.tx .memo').allInnerTexts()).map(norm).sort();
    assert.deepEqual(shown, ['점심(수정2)', '택시']);
    assert.deepEqual(await memos(page), []); // 서버엔 아직 없음
    assert.ok((await pending(page)).length >= 2);
    await ctx.setOffline(false);
    await page.waitForTimeout(2500);
    assert.deepEqual(await memos(page), ['점심(수정2)', '택시']);
    assert.equal((await pending(page)).length, 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('저장은 됐는데 응답이 사라진 경우 → 자동 재전송해도 중복 없음', async () => {
    const { ctx, page, errs } = await open(env, { path: '#list' });
    await page.evaluate(() => { window.__net = 'lost'; });
    await addTx(page, 4500, '편의점');
    await page.waitForTimeout(4000);
    assert.deepEqual(await memos(page), ['편의점']);
    assert.equal((await pending(page)).length, 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('삭제 후 "되돌리기" → 그대로 복구', async () => {
    const { ctx, page } = await open(env, { path: '#list', seed: seedScript({ transactions: [tx('t1', { memo: '택시' })] }) });
    await page.click('.tx:has-text("택시")');
    await page.waitForSelector('.sheet');
    await page.click('.sheet .btn.danger');
    await page.waitForTimeout(400);
    await page.click('.toast button');
    await page.waitForTimeout(700);
    assert.deepEqual(await memos(page), ['택시']);
    await ctx.close();
  });
});

describe('카테고리 이름 변경', () => {
  const seed = seedScript({ transactions: [
    ...Array.from({ length: 40 }, (_, i) => tx('s' + i, { memo: '메모' + i, created_at: i })),
    tx('i1', { type: 'income', amount: 9000, memo: '수입식비', created_at: 98 }),
    tx('x1', { user_id: 'u9', memo: '남의것' }),
  ] });

  async function rename(page, from, to) {
    await menu(page, '카테고리 편집');
    const names = page.locator('.sheet input[aria-label="이름"]');
    for (let i = 0; i < await names.count(); i++) {
      if (await names.nth(i).inputValue() === from) { await names.nth(i).fill(to); break; }
    }
    await page.click('.sheet button[type="submit"]');
  }

  test('40건 이름 변경 → 서버 요청 1번, 메모 유지, 수입·다른 가계부는 그대로', async () => {
    const { ctx, page, errs } = await open(env, { seed });
    const u0 = (await db(page)).updateCalls || 0;
    await rename(page, '식비', '밥값');
    await page.waitForTimeout(1200);
    const d = await db(page);
    const mine = d.transactions.filter((t) => t.id.startsWith('s'));
    assert.ok(mine.every((t) => t.category === '밥값' && t.memo === '메모' + t.id.slice(1)));
    assert.equal((d.updateCalls || 0) - u0, 1);
    assert.equal(d.transactions.find((t) => t.id === 'i1').category, '식비');
    assert.equal(d.transactions.find((t) => t.id === 'x1').category, '식비');
    assert.equal((await pending(page)).length, 0);
    await tab(page, '내역');
    assert.ok(await page.locator('.tx:has-text("밥값")').count() >= 40);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('오프라인 이름 변경 → 보낼 목록에 작업 2개뿐, 연결되면 반영', async () => {
    const { ctx, page, errs } = await open(env, { seed });
    await ctx.setOffline(true);
    await rename(page, '식비', '식사');
    await page.waitForTimeout(500);
    assert.deepEqual((await pending(page)).map((o) => o.kind).sort(), ['categories', 'renameCat']);
    await tab(page, '내역');
    assert.ok(await page.locator('.tx:has-text("식사")').count() >= 40);
    await ctx.setOffline(false);
    await page.waitForTimeout(2500);
    assert.ok((await db(page)).transactions.filter((t) => t.id.startsWith('s')).every((t) => t.category === '식사'));
    assert.equal((await pending(page)).length, 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

describe('DB 업데이트 전 (011 미적용)', () => {
  test('100자 넘는 메모는 버리지 않고 보관 + 안내, 011 실행 후 자동 업로드', async () => {
    const { ctx, page, errs } = await open(env, {
      path: '#list',
      init: ["if(!sessionStorage.getItem('__m100set')){sessionStorage.setItem('__memo100','1');sessionStorage.setItem('__m100set','1')}"],
    });
    await addTx(page, 8800, '가'.repeat(150));
    await addTx(page, 8900, '짧은메모');
    let d = await db(page);
    assert.ok(!d.transactions.some((t) => t.amount === 8800));
    assert.ok(d.transactions.some((t) => t.amount === 8900));
    assert.equal((await pending(page)).length, 1);
    assert.match(await page.innerText('.notice:has-text("DB 업데이트")'), /011_\*\.sql/);
    await page.evaluate(() => sessionStorage.removeItem('__memo100')); // = 011 실행
    await page.reload();
    await page.waitForSelector('.nav-tabs');
    await page.waitForTimeout(2000);
    d = await db(page);
    const row = d.transactions.filter((t) => t.amount === 8800);
    assert.equal(row.length, 1);
    assert.equal(row[0].memo.length, 150);
    assert.equal((await pending(page)).length, 0);
    assert.equal(await page.locator('.notice:has-text("DB 업데이트")').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
