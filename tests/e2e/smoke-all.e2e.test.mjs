// 모든 탭·설정 화면을 휴대폰·PC 너비에서 열어 보고 오류·가로 넘침이 없는지 (데이터가 많고 지운 카드·사람·카테고리가 섞인 상태)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, seedScript, settings, tx, menu, tab } from './helpers.mjs';
const env = setup();
const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
const ym = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
const rows = Array.from({ length: 80 }, (_, i) => tx('s' + i, {
  amount: 1000 * (i + 1) * (i % 7 ? 1 : 1000), memo: i % 5 ? `메모${i} 아주 긴 메모가 들어가면 어떻게 보이는지 확인하는 문장입니다` : '',
  category: ['식비', '교통', '없어진카테고리', '쇼핑'][i % 4], date: `${ym}-${p2((i % 28) + 1)}`,
  member_id: ['m1', 'gone', null][i % 3], card_id: ['k1', 'gonecard', null][i % 3], inst_months: i % 3 === 0 ? 3 : 1, tags: i % 6 ? [] : ['여행', '명절'],
  type: i % 9 === 0 ? 'income' : 'expense',
}));
const seed = seedScript({
  transactions: rows,
  settingsRow: settings({
    members: [{ id: 'm1', name: '민지', color: 0 }, { id: 'm2', name: '아주긴이름사람', color: 1 }],
    cards: [{ id: 'k1', name: '삼성', payDay: 14, closeDay: 31, color: 2 }], budget: 500000, cat_budgets: { 식비: 100000, 없어진카테고리: 5000 },
    favorites: [{ id: 'f1', label: '점심', type: 'expense', amount: 9000, category: '식비', memo: '', memberId: 'gone', cardId: 'gonecard', tags: [] }],
    recurring: [{ id: 'r1', type: 'expense', amount: 55000, category: '없어진카테고리', memo: '통신', memberId: 'gone', day: 31, start: '2026-01', end: null, last: ym, active: false }],
  }),
});
const ITEMS = ['가계부 공유', '즐겨찾기', '변경 기록', '반복 내역', '카테고리 편집', '카테고리별 예산', '신용카드', '상세 검색', '알림', '월 예산', '함께 쓰는 사람', '백업·복원', 'CSV 내보내기', '계정·개인정보'];

for (const width of [320, 360, 1280]) {
  test(`모든 화면 열기 (${width}px)`, async () => {
    const { ctx, page, errs } = await open(env, { seed, width });
    const overflow = async (where) => {
      const w = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(w <= 1, `${where}: 가로 넘침 ${w}px`);
    };
    for (const t of ['가계부', '내역', '장보기', '리포트']) {
      await tab(page, t);
      await page.waitForTimeout(250);
      if (process.env.DBG) console.log(t, JSON.stringify(await page.evaluate(() => { const W = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > W + 1 && ![...e.children].some((c) => c.getBoundingClientRect().right > W + 1)).slice(0, 12).map((e) => `${e.tagName}.${e.className} r=${Math.round(e.getBoundingClientRect().right)}`); })));
      await overflow(`탭 ${t}`);
      if (t === '리포트') {
        for (const r of await page.locator('.share-row').all()) { await r.click(); await page.waitForTimeout(30); }
        await overflow('리포트 펼침');
      }
    }
    const sheetFits = async (where) => {
      const w = await page.evaluate(() => { const s = document.querySelector('.sheet'); return s ? s.scrollWidth - s.clientWidth : 0; });
      if (w > 1) console.log(where, JSON.stringify(await page.evaluate(() => { const S = document.querySelector('.sheet'); const R = S.getBoundingClientRect().right; return [...S.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > R + 1 && ![...e.children].some((c) => c.getBoundingClientRect().right > R + 1)).slice(0, 8).map((e) => `${e.tagName}.${e.className} r=${Math.round(e.getBoundingClientRect().right)}/${Math.round(R)}`); })));
      assert.ok(w <= 1, `${where}: 시트 안 가로 넘침 ${w}px`);
      await overflow(where);
    };
    await tab(page, '내역');
    await page.click('.tx >> nth=1');
    await page.waitForSelector('.sheet');
    await page.selectOption('.sheet select[id$="-inst"]', '6').catch(() => {});
    await sheetFits('수정 시트');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    if (await page.locator('.fab').isVisible()) {
      await page.click('.fab');
      await page.waitForSelector('.sheet');
      await page.fill('.sheet .amount-input input', '9999999999');
      await page.click('.sheet .repeat-toggle');
      await sheetFits('새 내역 시트');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
    await tab(page, '장보기');
    await page.fill('.quick-add input >> nth=0', '아주아주긴이름의물품입니다정말길어요');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await overflow('장보기 추가 후');
    await page.click('.shop-row >> nth=0').catch(() => {});
    if (await page.locator('.sheet').count()) { await sheetFits('물품 시트'); await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
    for (const name of ITEMS) {
      await menu(page, name);
      await page.waitForTimeout(250);
      await overflow(`설정 ${name}`);
      if (process.env.DBG) console.log(name, JSON.stringify(await page.evaluate(() => { const S = document.querySelector('.sheet'); if (!S) return []; const R = S.getBoundingClientRect().right; return [...S.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > R + 1 && ![...e.children].some((c) => c.getBoundingClientRect().right > R + 1)).slice(0, 8).map((e) => `${e.tagName}.${e.className} r=${Math.round(e.getBoundingClientRect().right)}/${Math.round(R)}`); })));
      const sheetOverflow = await page.evaluate(() => { const s = document.querySelector('.sheet'); return s ? s.scrollWidth - s.clientWidth : 0; });
      assert.ok(sheetOverflow <= 1, `설정 ${name}: 시트 안 가로 넘침 ${sheetOverflow}px`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
    assert.deepEqual(errs, []);
    await ctx.close();
  });
}
