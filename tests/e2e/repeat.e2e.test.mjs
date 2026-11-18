// 새 내역 입력에서 "🔁 매달 반복": 내역 + 반복 규칙을 함께 저장, 다음 달 자동 기록, 지난달 날짜면 빠진 달 채움, 할부·가득 참은 꺼짐
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, settings, db, pending, norm } from './helpers.mjs';

const env = setup();
const KST = { timezoneId: 'Asia/Seoul' };

async function fill(page, { amount, memo, date }) {
  await page.click('.fab');
  await page.waitForSelector('.sheet');
  await page.fill('.sheet .amount-input input', String(amount));
  if (memo) await page.fill('.sheet input[id$="-memo"]', memo);
  if (date) await page.fill('.sheet input[type="date"]', date);
}

describe('새 내역 → 매달 반복', () => {
  test('켜고 저장 → 내역(반복 표시) + 규칙(이번 달은 이미 기록), 다음 달이 되면 자동 기록', async () => {
    const { ctx, page, errs } = await open(env, {
      path: '#list', contextOptions: KST,
      beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
    });
    await fill(page, { amount: 55000, memo: '통신비', date: '2026-11-18' });
    const toggle = page.locator('.sheet .repeat-toggle');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await toggle.click();
    assert.match(norm(await page.innerText('.sheet .repeat-row')), /매달 18일에 자동으로 기록돼요/);
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(800);
    assert.match(norm(await page.innerText('.toast')), /🔁 매달 18일 반복 등록/);
    const d = await db(page);
    const rule = d.settings[0].recurring[0];
    assert.equal(d.settings[0].recurring.length, 1);
    assert.deepEqual({ day: rule.day, start: rule.start, last: rule.last, amount: rule.amount, memo: rule.memo, active: rule.active },
      { day: 18, start: '2026-11', last: '2026-11', amount: 55000, memo: '통신비', active: true });
    const t = d.transactions.filter((x) => x.memo === '통신비');
    assert.equal(t.length, 1); // 같은 달 중복 없음
    assert.equal(t[0].id, `rec-${rule.id}-2026-11`);
    assert.equal(await page.locator('.tx:has-text("통신비")').count(), 1);
    // 다음 달 18일
    await page.clock.setSystemTime(new Date('2026-12-18T09:00:00+09:00'));
    await page.reload();
    await page.waitForSelector('.nav-tabs');
    await page.waitForTimeout(1500);
    const ids = (await db(page)).transactions.filter((x) => x.memo === '통신비').map((x) => x.id).sort();
    assert.deepEqual(ids, [`rec-${rule.id}-2026-11`, `rec-${rule.id}-2026-12`]);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('지난달 날짜로 넣으면 "빠진 N개월도 바로 채워요" → 그 달들도 기록', async () => {
    const { ctx, page, errs } = await open(env, {
      path: '#list', contextOptions: KST,
      beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
    });
    await fill(page, { amount: 9900, memo: '음악구독', date: '2026-09-05' });
    await page.click('.sheet .repeat-toggle');
    assert.match(norm(await page.innerText('.sheet .repeat-row')), /빠진 2개월도 바로 채워요/);
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(1500);
    const d = await db(page);
    const dates = d.transactions.filter((x) => x.memo === '음악구독').map((x) => x.date).sort();
    assert.deepEqual(dates, ['2026-09-05', '2026-10-05', '2026-11-05']);
    assert.equal(d.settings[0].recurring[0].last, '2026-11');
    assert.equal((await pending(page)).length, 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('끈 채 저장하면 예전처럼 내역만, 저장 뒤 버튼은 다시 꺼짐', async () => {
    const { ctx, page } = await open(env, { path: '#list', width: 1280 });
    const form = page.locator('.side-form');
    await form.locator('.amount-input input').fill('3000');
    await form.locator('.repeat-toggle').click();
    await form.locator('.repeat-toggle').click(); // 다시 끔
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(700);
    let d = await db(page);
    assert.equal(d.settings[0].recurring.length, 0);
    assert.ok(!d.transactions[0].id.startsWith('rec-'));
    // 켜고 저장 → 다음 입력을 위해 다시 꺼짐
    await form.locator('.amount-input input').fill('4000');
    await form.locator('.repeat-toggle').click();
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(700);
    assert.equal(await form.locator('.repeat-toggle').getAttribute('aria-pressed'), 'false');
    d = await db(page);
    assert.equal(d.settings[0].recurring.length, 1);
    await ctx.close();
  });

  test('수정 화면엔 버튼 없음, 할부·반복 100개 가득이면 꺼짐', async () => {
    const card = { id: 'c1', name: '신한', closeDay: 15, payDay: 25, color: 0 };
    const full = Array.from({ length: 100 }, (_, i) => ({ id: 'r' + i, type: 'expense', amount: 1000, category: '식비', memo: '', memberId: null, day: 1, start: '2026-01', end: null, last: '2026-11', active: true }));
    let { ctx, page } = await open(env, { path: '#list', seed: seedScript({ settingsRow: settings({ cards: [card] }), transactions: [{ id: 't1', user_id: 'u1', type: 'expense', amount: 1000, category: '식비', memo: '기존', date: '2026-11-01', member_id: null, tags: [], card_id: null, inst_months: 1, created_at: 1 }] }) });
    await page.click('.tx:has-text("기존")');
    await page.waitForSelector('.sheet');
    assert.equal(await page.locator('.sheet .repeat-toggle').count(), 0);
    await page.click('.sheet button[aria-label="닫기"]');
    await fill(page, { amount: 600000 });
    await page.click('.sheet .chip:has-text("신한")');
    await page.selectOption('.sheet select[id$="-inst"]', '3');
    assert.ok(await page.isDisabled('.sheet .repeat-toggle'));
    assert.match(norm(await page.innerText('.sheet .repeat-row')), /할부는 반복으로 등록할 수 없어요/);
    await ctx.close();
    ({ ctx, page } = await open(env, { path: '#list', seed: seedScript({ settingsRow: settings({ recurring: full }) }) }));
    await fill(page, { amount: 1000 });
    assert.ok(await page.isDisabled('.sheet .repeat-toggle'));
    assert.match(norm(await page.innerText('.sheet .repeat-row')), /가득 찼어요 \(최대 100개\)/);
    await ctx.close();
  });

  test('51번째부터: 015 실행 후엔 바로 저장, 015 전엔 기기에 보관 + 015 안내 → 실행하면 자동으로 올라감', async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({ id: 'r' + i, type: 'expense', amount: 1000, category: '식비', memo: '', memberId: null, day: 1, start: '2026-01', end: null, last: '2026-11', active: true }));
    const seed = seedScript({ settingsRow: settings({ recurring: fifty }) });
    // 015 전
    let { ctx, page, errs } = await open(env, { path: '#list', seed, init: ["if(!sessionStorage.getItem('__set015')){sessionStorage.setItem('__no015','1');sessionStorage.setItem('__set015','1')}"] });
    await fill(page, { amount: 7000, memo: '51번째' });
    assert.ok(!(await page.isDisabled('.sheet .repeat-toggle')));
    await page.click('.sheet .repeat-toggle');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(1200);
    let d = await db(page);
    assert.equal(d.settings[0].recurring.length, 50); // 서버는 아직 50개
    assert.ok(d.transactions.some((t) => t.memo === '51번째')); // 내역은 저장됨
    assert.equal((await pending(page)).filter((o) => o.kind === 'recurring').length, 1); // 규칙은 보관 중
    assert.match(await page.innerText('.notice:has-text("DB 업데이트")'), /015_\*\.sql/);
    await page.evaluate(() => sessionStorage.removeItem('__no015')); // = 015 실행
    await page.reload();
    await page.waitForSelector('.nav-tabs');
    await page.waitForTimeout(1500);
    d = await db(page);
    assert.equal(d.settings[0].recurring.length, 51);
    assert.equal((await pending(page)).length, 0);
    assert.equal(await page.locator('.notice:has-text("DB 업데이트")').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

