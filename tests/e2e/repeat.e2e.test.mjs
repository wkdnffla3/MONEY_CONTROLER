// "🔁 매달 반복": 새 내역에서 켜기, 이미 있는 내역에서 켜기·끄기. 다음 달 자동 기록, 빠진 달 채움, 할부·가득 참은 꺼짐
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

  test('수정 화면은 꺼진 상태로 시작, 할부·반복 100개 가득이면 꺼짐', async () => {
    const card = { id: 'c1', name: '신한', closeDay: 15, payDay: 25, color: 0 };
    const full = Array.from({ length: 100 }, (_, i) => ({ id: 'r' + i, type: 'expense', amount: 1000, category: '식비', memo: '', memberId: null, day: 1, start: '2026-01', end: null, last: '2026-11', active: true }));
    let { ctx, page } = await open(env, { path: '#list', seed: seedScript({ settingsRow: settings({ cards: [card] }), transactions: [{ id: 't1', user_id: 'u1', type: 'expense', amount: 1000, category: '식비', memo: '기존', date: '2026-11-01', member_id: null, tags: [], card_id: null, inst_months: 1, created_at: 1 }] }) });
    await page.click('.tx:has-text("기존")');
    await page.waitForSelector('.sheet');
    assert.equal(await page.locator('.sheet .repeat-toggle').getAttribute('aria-pressed'), 'false'); // 수정 화면: 반복 아닌 내역은 꺼진 상태로 보임
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

  test('일시정지했던 반복 내역을 다시 시작 → 멈춰 있던 달은 기록하지 않음', async () => {
    const rule = (id, day) => ({ id, type: 'expense', amount: 13500, category: '문화·여가', memo: '구독' + id, memberId: null, day, start: '2026-01', end: null, last: '2026-08', active: false });
    const seed = seedScript({ settingsRow: settings({ recurring: [rule('a', 5), rule('b', 25)] }) });
    const { ctx, page, errs } = await open(env, {
      seed, contextOptions: KST, beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
    });
    await page.click('button[aria-label="설정 메뉴"]');
    await page.click('.menu-list button:has-text("반복 내역")');
    await page.waitForSelector('.sheet');
    for (const name of ['구독a', '구독b']) {
      await page.locator('.sheet li', { hasText: name }).locator('button:has-text("다시 시작")').click();
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1200);
    let d = await db(page);
    // 5일 규칙: 이번 달 5일은 멈춘 동안 지나감 → 안 만듦 / 25일 규칙: 아직 안 옴 → 안 만듦
    assert.deepEqual(d.transactions.map((t) => t.memo), []);
    const byId = Object.fromEntries(d.settings[0].recurring.map((r) => [r.id, r]));
    assert.equal(byId.a.last, '2026-11');
    assert.equal(byId.b.last, '2026-10');
    assert.ok(byId.a.active && byId.b.active);
    // 25일이 되면 b 만 기록
    await page.clock.setSystemTime(new Date('2026-11-25T09:00:00+09:00'));
    await page.reload();
    await page.waitForSelector('.nav-tabs');
    await page.waitForTimeout(1500);
    d = await db(page);
    assert.deepEqual(d.transactions.map((t) => `${t.memo}:${t.date}`), ['구독b:2026-11-25']);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

describe('내역에서 반복 켜기·끄기', () => {
  const { tx } = { tx: (id, o) => ({ id, user_id: 'u1', type: 'expense', amount: 9900, category: '식비', memo: '', date: '2026-11-07', member_id: null, tags: [], card_id: null, inst_months: 1, created_at: 1, ...o }) };
  const openTx = async (page, memo) => { await page.click(`.tx:has-text("${memo}")`); await page.waitForSelector('.sheet'); };

  test('이미 있는 내역을 반복으로 → 규칙 생성(그 내역과 연결), 🔁 표시, 다음 달 자동 기록 / 다시 끄면 규칙만 지움', async () => {
    const { ctx, page, errs } = await open(env, {
      seed: seedScript({ transactions: [tx('t1', { memo: '넷플릭스' })] }), path: '#list', contextOptions: KST,
      beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
    });
    assert.equal(await page.locator('.tx:has-text("넷플릭스") .rec-mark').count(), 0);
    await openTx(page, '넷플릭스');
    const toggle = page.locator('.sheet .repeat-toggle');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await toggle.click();
    assert.match(norm(await page.innerText('.sheet .repeat-row')), /매달 7일에 자동으로 기록돼요/);
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(800);
    assert.match(norm(await page.innerText('.toast')), /🔁 매달 7일 반복 등록/);
    let d = await db(page);
    const rule = d.settings[0].recurring[0];
    assert.deepEqual({ day: rule.day, start: rule.start, last: rule.last, srcTx: rule.srcTx }, { day: 7, start: '2026-11', last: '2026-11', srcTx: 't1' });
    assert.equal(d.transactions.filter((x) => x.memo === '넷플릭스').length, 1); // 이번 달 중복 없음
    assert.equal(await page.locator('.tx:has-text("넷플릭스") .rec-mark').count(), 1);
    // 다시 열면 켜져 있음 → 끄고 저장
    await openTx(page, '넷플릭스');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.match(norm(await page.innerText('.sheet .repeat-row')), /매달 7일 반복 중/);
    await toggle.click();
    assert.match(norm(await page.innerText('.sheet .repeat-row')), /반복을 해제/);
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(800);
    assert.match(norm(await page.innerText('.toast')), /반복 해제/);
    d = await db(page);
    assert.equal(d.settings[0].recurring.length, 0);
    assert.equal(d.transactions.filter((x) => x.memo === '넷플릭스').length, 1); // 내역은 그대로
    assert.equal(await page.locator('.tx:has-text("넷플릭스") .rec-mark').count(), 0);
    assert.equal((await pending(page)).length, 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('자동 기록된 내역에서 반복 해제 → 규칙 삭제, 다음 달에 안 생김', async () => {
    const rule = { id: 'r1', type: 'expense', amount: 55000, category: '식비', memo: '통신비', memberId: null, day: 5, start: '2026-10', end: null, last: '2026-11', active: true };
    const { ctx, page, errs } = await open(env, {
      seed: seedScript({ transactions: [tx('rec-r1-2026-11', { memo: '통신비', amount: 55000, date: '2026-11-05' })], settingsRow: settings({ recurring: [rule] }) }),
      path: '#list', contextOptions: KST,
      beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
    });
    await openTx(page, '통신비');
    const toggle = page.locator('.sheet .repeat-toggle');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await toggle.click();
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(800);
    assert.equal((await db(page)).settings[0].recurring.length, 0);
    await page.clock.runFor(20 * 24 * 3600 * 1000); // 12월 8일
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(800);
    assert.equal((await db(page)).transactions.filter((x) => x.memo === '통신비').length, 1);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('반복이 가득 차도(100개) 이미 반복 중인 내역은 끌 수 있고, 아닌 내역은 켤 수 없음', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `q${i}`, type: 'expense', amount: 1000, category: '식비', memo: '', memberId: null, day: 28, start: '2026-11', end: null, last: '2026-11', active: true }));
    const { ctx, page } = await open(env, {
      seed: seedScript({ transactions: [tx('rec-q3-2026-11', { memo: '반복중' }), tx('t2', { memo: '일반' })], settingsRow: settings({ recurring: many }) }),
      path: '#list', contextOptions: KST,
      beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
    });
    await openTx(page, '일반');
    assert.equal(await page.locator('.sheet .repeat-toggle').isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await openTx(page, '반복중');
    assert.equal(await page.locator('.sheet .repeat-toggle').isDisabled(), false);
    await page.click('.sheet .repeat-toggle');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(800);
    assert.equal((await db(page)).settings[0].recurring.length, 99);
    await ctx.close();
  });
});

test('구독 발견 → 반복 등록: 반복 내역이 50개를 넘어도 100개까지 등록됨', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `q${i}`, type: 'expense', amount: 1000 + i, category: '교육', memo: `학원${i}`, memberId: null, day: 28, start: '2026-11', end: null, last: '2026-11', active: true }));
  const t = (id, date) => ({ id, user_id: 'u1', type: 'expense', amount: 14900, category: '문화·여가', memo: '유튜브', date, member_id: null, tags: [], card_id: null, inst_months: 1, created_at: 1 });
  const { ctx, page, errs } = await open(env, {
    seed: seedScript({ transactions: [t('y1', '2026-08-10'), t('y2', '2026-09-10'), t('y3', '2026-10-10'), t('y4', '2026-11-10')], settingsRow: settings({ recurring: many }) }),
    contextOptions: KST, beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }),
  });
  await page.click('.sub-finder button:has-text("반복 등록")');
  await page.waitForTimeout(800);
  assert.match(norm(await page.innerText('.toast')), /반복 내역으로 등록/);
  assert.equal((await db(page)).settings[0].recurring.length, 61);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('자정이 지나면 서버를 먼저 확인: 다른 기기가 이미 기록하고 고친 이번 달 반복 내역을 덮어쓰지 않음', async () => {
  const rule = { id: 'r1', type: 'expense', amount: 55000, category: '식비', memo: '통신비', memberId: null, day: 1, start: '2026-10', end: null, last: '2026-11', active: true };
  const { ctx, page, errs } = await open(env, {
    seed: seedScript({ settingsRow: settings({ recurring: [rule] }) }), path: '#list', contextOptions: KST,
    beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-30T23:59:00+09:00') }),
  });
  await page.waitForTimeout(500);
  // 다른 기기(먼저 자정을 넘김)가 12월 내역을 기록하고 금액을 고침 — 이 기기엔 아직 실시간 알림이 안 옴
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__fakedb'));
    db.transactions.push({ id: 'rec-r1-2026-12', user_id: 'u1', type: 'expense', amount: 61000, category: '식비', memo: '통신비(인상)', date: '2026-12-01', member_id: null, tags: [], card_id: null, inst_months: 1, created_at: 1 });
    db.settings[0].recurring = [{ ...db.settings[0].recurring[0], last: '2026-12' }];
    sessionStorage.setItem('__fakedb', JSON.stringify(db));
  });
  await page.clock.runFor(70_000);
  await page.waitForTimeout(1200);
  const d = await db(page);
  const t = d.transactions.filter((x) => x.id === 'rec-r1-2026-12');
  assert.equal(t.length, 1);
  assert.equal(t[0].amount, 61000);
  assert.equal(t[0].memo, '통신비(인상)');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('자정이 지나면(다른 기기 기록 없음) 서버를 받은 뒤 이번 달 반복 내역 기록', async () => {
  const rule = { id: 'r1', type: 'expense', amount: 55000, category: '식비', memo: '통신비', memberId: null, day: 1, start: '2026-10', end: null, last: '2026-11', active: true };
  const { ctx, page, errs } = await open(env, {
    seed: seedScript({ settingsRow: settings({ recurring: [rule] }) }), path: '#list', contextOptions: KST,
    beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-30T23:59:00+09:00') }),
  });
  await page.waitForTimeout(500);
  await page.clock.runFor(70_000);
  await page.waitForTimeout(1200);
  const d = await db(page);
  assert.equal(d.transactions.filter((x) => x.id === 'rec-r1-2026-12').length, 1);
  assert.equal(d.settings[0].recurring[0].last, '2026-12');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('이번 달 자동 기록을 다음 달 날짜로 옮겨 두면, 다음 달에 한 번 더 생기지 않음', async () => {
  const rule = { id: 'r1', type: 'expense', amount: 55000, category: '식비', memo: '통신비', memberId: null, day: 5, start: '2026-10', end: null, last: '2026-11', active: true };
  const moved = { id: 'rec-r1-2026-11', user_id: 'u1', type: 'expense', amount: 55000, category: '식비', memo: '통신비', date: '2026-12-02', member_id: null, tags: [], card_id: null, inst_months: 1, created_at: 1 };
  const { ctx, page, errs } = await open(env, {
    seed: seedScript({ transactions: [moved], settingsRow: settings({ recurring: [rule] }) }), path: '#list', contextOptions: KST,
    beforeGoto: (p) => p.clock.install({ time: new Date('2026-12-08T10:00:00+09:00') }),
  });
  await page.waitForTimeout(1200);
  const d = await db(page);
  assert.equal(d.transactions.filter((x) => x.date.startsWith('2026-12')).length, 1);
  assert.equal(d.settings[0].recurring[0].last, '2026-12'); // 규칙은 12월까지 처리한 것으로
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('반복 내역 추가: 시작 월을 지난달 이전으로 고르면 몇 개월이 한꺼번에 기록되는지 미리 알림', async () => {
  const { menu } = await import('./helpers.mjs');
  const { ctx, page, errs } = await open(env, { contextOptions: KST, beforeGoto: (p) => p.clock.install({ time: new Date('2026-11-18T10:00:00+09:00') }) });
  await menu(page, '반복 내역');
  await page.click('.sheet button:has-text("+ 반복 내역 추가")');
  await page.fill('#rr-amt', '10000');
  await page.selectOption('#rr-day', '25');
  await page.fill('#rr-start', '2026-08');
  assert.match(norm(await page.innerText('.sheet .warn-text')), /8월~10월 3개월 내역이 바로 기록돼요/);
  await page.fill('#rr-start', '2026-11');
  assert.equal(await page.locator('.sheet .warn-text').count(), 0); // 이번 달 25일은 아직
  await page.fill('#rr-start', '2026-08');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(1200);
  assert.equal((await db(page)).transactions.length, 3);
  assert.deepEqual(errs, []);
  await ctx.close();
});
