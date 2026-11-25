// 즐겨찾기: 사람별로 나눠 보기(나 먼저), 탭으로 한 사람만, 펼치기로 전부 보기(기기에 기억), 편집 화면도 사람별
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, settings, db, norm } from './helpers.mjs';

const env = setup();
const members = [{ id: 'm1', name: '민지', color: 0 }, { id: 'm2', name: '준호', color: 1 }];
const fav = (id, label, memberId, amount = 1000) => ({ id, label, type: 'expense', amount, category: '식비', memo: '', memberId, cardId: null, tags: [] });
const favorites = [
  ...Array.from({ length: 6 }, (_, i) => fav('a' + i, '민지' + i, 'm1')),
  ...Array.from({ length: 5 }, (_, i) => fav('b' + i, '준호' + i, 'm2')),
  fav('s1', '공동장보기', null, 0),
];
const seed = seedScript({ settingsRow: settings({ members, favorites }) });
const asJunho = "localStorage.setItem('ledger.me.u1','m2')"; // 이 기기를 쓰는 사람 = 준호

describe('즐겨찾기 사람별 보기', () => {
  test("'공동' 묶음 즐겨찾기 → 공동으로 기록 (바로 저장·입력창 모두), 사람 묶음은 그 사람", async () => {
    const f2 = [fav('a0', '민지점심', 'm1'), fav('s2', '공동관리비', null), fav('s1', '공동장보기', null, 0), fav('g1', '지운사람', 'gone')];
    const { ctx, page, errs } = await open(env, { seed: seedScript({ settingsRow: settings({ members, favorites: f2 }) }), init: [asJunho] });
    const bar = page.locator('.fav-bar');
    await bar.locator('button:has-text("공동관리비")').click();
    await page.waitForTimeout(600);
    await bar.locator('button:has-text("지운사람")').click();
    await page.waitForTimeout(600);
    await bar.locator('button:has-text("민지점심")').click();
    await page.waitForTimeout(600);
    const d = (await db(page)).transactions;
    assert.deepEqual(d.map((t) => t.member_id).sort(), [null, null, 'm1'].sort());
    await bar.locator('button:has-text("공동장보기")').click(); // 금액 없음 → 입력창
    await page.waitForSelector('.sheet');
    assert.equal(await page.locator('.sheet .chip[aria-pressed="true"]:has-text("공동")').count(), 1);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('나(준호) 묶음 먼저, 묶음 이름·개수, 탭으로 한 사람만', async () => {
    const { ctx, page, errs } = await open(env, { seed, init: [asJunho] });
    const bar = page.locator('.fav-bar');
    assert.deepEqual((await bar.locator('.fav-glabel').allInnerTexts()).map(norm), ['준호 (나)', '민지', '공동']);
    assert.deepEqual((await bar.locator('.fav-tabs .chip').allInnerTexts()).map(norm), ['전체 12', '준호 (나) 5', '민지 6', '공동 1']);
    assert.equal(norm(await bar.locator('.fav-group').first().locator('.fav-chip .fl').first().innerText()), '준호0');
    await bar.locator('.fav-tabs .chip:has-text("민지")').click();
    assert.equal(await bar.locator('.fav-chip').count(), 6);
    assert.equal(await bar.locator('.fav-glabel').count(), 0);
    // 다시 열어도 고른 탭 유지
    await page.reload();
    await page.waitForSelector('.fav-bar');
    assert.equal(await page.locator('.fav-bar .fav-chip').count(), 6);
    assert.equal(await page.locator('.fav-tabs .chip[aria-pressed="true"]').innerText().then(norm), '민지 6');
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('펼치기: 접힌 상태는 한 줄(옆으로 넘김), 펼치면 모든 버튼이 화면 안에 보임', async () => {
    const { ctx, page, errs } = await open(env, { seed, init: [asJunho] });
    const bar = page.locator('.fav-bar');
    const visibleCount = () => page.evaluate(() => {
      const card = document.querySelector('.fav-bar').getBoundingClientRect();
      return [...document.querySelectorAll('.fav-bar .fav-chip')].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left >= card.left - 1 && r.right <= card.right + 1;
      }).length;
    });
    const before = await visibleCount();
    assert.ok(before < 12, `접힌 상태에서 ${before}개 보임`);
    await bar.locator('button:has-text("펼치기")').click();
    assert.equal(await visibleCount(), 12);
    assert.equal(await bar.locator('button[aria-expanded="true"]').innerText().then(norm), '접기 ▴');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 390);
    // 다시 열어도 펼친 상태 유지, 펼친 채로 눌러도 바로 저장
    await page.reload();
    await page.waitForSelector('.fav-bar.open');
    await page.locator('.fav-chip:has-text("민지5")').click();
    await page.waitForTimeout(700);
    const t = (await db(page)).transactions.find((x) => x.amount === 1000);
    assert.equal(t.member_id, 'm1');
    await page.locator('.fav-bar button:has-text("접기")').click();
    assert.equal(await page.locator('.fav-bar.open').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('사람을 안 정했으면 묶음 없이 예전처럼 한 줄', async () => {
    const { ctx, page } = await open(env, { seed: seedScript({ settingsRow: settings({ favorites: [fav('x', '커피', null), fav('y', '버스', null)] }) }) });
    assert.equal(await page.locator('.fav-tabs').count(), 0);
    assert.equal(await page.locator('.fav-glabel').count(), 0);
    assert.equal(await page.locator('.fav-chip').count(), 2);
    await ctx.close();
  });
});

describe('PC에서 옆으로 넘기기', () => {
  const many = seedScript({ settingsRow: settings({ members, favorites: Array.from({ length: 20 }, (_, i) => fav('p' + i, '항목' + i, 'm1', 1000 + i)) }) });
  const row = '.fav-bar .fav-chips';
  const left = (page) => page.$eval(row, (el) => el.scrollLeft);

  test('마우스 휠로 옆으로, 줄 끝에서는 화면이 세로로', async () => {
    const { ctx, page, errs } = await open(env, { seed: many, width: 1280 });
    const box = await page.locator(row).boundingBox();
    await page.mouse.move(box.x + 50, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(200);
    assert.ok(await left(page) >= 250, `휠 뒤 scrollLeft ${await left(page)}`);
    assert.equal(await page.evaluate(() => window.scrollY), 0); // 줄이 넘어가는 동안 화면은 그대로
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 400); // 끝까지
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => window.scrollY) > 0, '끝에 닿으면 화면이 내려가야 함');
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('마우스로 끌어서 넘기기 → 저장 안 됨, 그냥 누르면 저장', async () => {
    const { ctx, page, errs } = await open(env, { seed: many, width: 1280 });
    const box = await page.locator(row).boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 300, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, y, { steps: 5 });
    await page.mouse.move(box.x + 60, y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.ok(await left(page) >= 200, `끈 뒤 scrollLeft ${await left(page)}`);
    assert.equal((await db(page)).transactions.length, 0); // 끌기는 클릭이 아님
    await page.locator('.fav-chip:has-text("항목5")').click();
    await page.waitForTimeout(700);
    assert.equal((await db(page)).transactions.length, 1);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('마우스를 올리면 ◀ ▶ 버튼, 누르면 넘어감 (처음엔 ◀ 없음)', async () => {
    const { ctx, page, errs } = await open(env, { seed: many, width: 1280 });
    await page.hover(row);
    await page.waitForTimeout(300); // 버튼이 서서히 나타남
    assert.equal(await page.locator('.fav-bar .hs-btn.left').count(), 0);
    const right = page.locator('.fav-bar .hs-btn.right').last();
    assert.equal(await right.evaluate((b) => getComputedStyle(b).opacity), '1');
    await right.click();
    await page.waitForTimeout(700);
    assert.ok(await left(page) > 100);
    assert.equal(await page.locator('.fav-bar .hs-btn.left').count(), 1);
    // 펼치면 넘길 필요 없음 → 버튼 없음
    await page.click('.fav-bar button:has-text("펼치기")');
    assert.equal(await page.locator('.fav-bar .hs-btn').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('휴대폰(터치)에서는 ◀ ▶ 버튼이 안 보임', async () => {
    const { ctx, page } = await open(env, { seed: many, contextOptions: { hasTouch: true, isMobile: true } });
    const btn = page.locator('.fav-bar .hs-btn.right');
    if (await btn.count()) assert.equal(await btn.first().evaluate((b) => getComputedStyle(b).display), 'none');
    await ctx.close();
  });
});

describe('즐겨찾기 편집', () => {
  test('사람별로 나뉜 목록, 묶음 안에서만 순서 바꾸기, 새로 만들면 "누가"가 나', async () => {
    const { ctx, page, errs } = await open(env, { seed, init: [asJunho] });
    await page.click('.fav-bar button:has-text("편집")');
    await page.waitForSelector('.fav-manager');
    assert.deepEqual((await page.locator('.fav-manager .fav-glabel').allInnerTexts()).map(norm), ['준호 (나) · 5개', '민지 · 6개', '공동 · 1개']);
    // 민지 묶음의 첫 항목 ▲ 는 꺼져 있음 (다른 사람 묶음으로 못 넘어감)
    assert.ok(await page.isDisabled('button[aria-label="민지0 위로"]'));
    await page.click('button[aria-label="민지1 위로"]');
    await page.waitForTimeout(800);
    const order = (await db(page)).settings[0].favorites.map((f) => f.id);
    assert.deepEqual(order.slice(0, 2), ['a1', 'a0']);
    assert.deepEqual(order.slice(6), ['b0', 'b1', 'b2', 'b3', 'b4', 's1']);
    await page.click('.fav-manager button:has-text("새 즐겨찾기")');
    await page.waitForSelector('.fav-form');
    assert.equal(norm(await page.locator('.fav-form .chip[aria-pressed="true"]:has(.dot)').innerText()), '준호');
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
