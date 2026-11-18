// 전체 백업·복원: 파일 받기, 빠진 것만 되살리기, 덮어쓰기, 다른 가계부 백업, 잘못된 파일, 014 전, 오프라인, 나눠 보내기
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup, open, menu, seedScript, settings, tx, db, norm } from './helpers.mjs';

const env = setup();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-backup-'));
const rows = (n, pre = 's') => Array.from({ length: n }, (_, i) => tx(pre + i, { amount: 1000 + i, memo: '메모' + i, created_at: i }));
const fav = { id: 'f1', label: '커피', type: 'expense', amount: 4500, category: '카페·간식', memo: '', memberId: null, cardId: null, tags: [] };
const base = () => seedScript({
  transactions: rows(25),
  settingsRow: settings({ budget: 500000, recurring: [{ id: 'r1', type: 'expense', amount: 50000, category: '주거·통신', memo: '통신비', memberId: null, day: 5, start: '2026-01', end: null, last: '2026-11', active: true }] }),
  extra: { shopping_items: [{ id: 'i1', user_id: 'u1', name: '우유', qty: 2, price: 2500, category: '식비', member_id: null, memo: '', checked: false, status: 'todo', paid: null, tx_id: null, bought_at: null, created_at: 1 }] },
});

async function downloadBackup(page, name) {
  await menu(page, '백업·복원');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.backup button:has-text("백업 파일 받기")')]);
  const file = path.join(dir, name);
  await dl.saveAs(file);
  return { file, suggested: dl.suggestedFilename(), json: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
const editDb = (page, fn) => page.evaluate((src) => {
  const d = JSON.parse(sessionStorage.getItem('__fakedb'));
  // eslint-disable-next-line no-new-func
  new Function('d', src)(d);
  sessionStorage.setItem('__fakedb', JSON.stringify(d));
}, `(${fn})(d)`);
async function reopen(page) {
  await page.reload();
  await page.waitForSelector('.nav-tabs');
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('.install-banner')?.remove());
}
async function chooseFile(page, file) {
  await menu(page, '백업·복원');
  await page.setInputFiles('.backup input[type=file]', file);
  await page.waitForTimeout(300);
}

describe('백업 파일 받기', () => {
  test('내역·장보기·설정이 모두 들어간 JSON, 마지막 백업 표시, "백업 권장" 표시가 사라짐', async () => {
    const { ctx, page, errs } = await open(env, { seed: base() });
    await page.click('button[aria-label="설정 메뉴"]');
    assert.equal(await page.locator('.menu-list .due-badge:has-text("백업 권장")').count(), 1);
    await page.click('.menu-list button:has-text("백업·복원")');
    assert.match(norm(await page.innerText('.bk-last')), /아직 없음/);
    await page.click('.sheet button[aria-label="닫기"]');
    const { json, suggested } = await downloadBackup(page, 'b1.json');
    assert.match(suggested, /^가계부-백업-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(json.format, 'ledger-backup');
    assert.equal(json.version, 1);
    assert.equal(json.ledgerId, 'u1');
    assert.equal(json.transactions.length, 25);
    assert.equal(json.items.length, 1);
    assert.equal(json.settings.budget, 500000);
    assert.equal(json.settings.recurring[0].id, 'r1');
    assert.ok(!JSON.stringify(json).includes('user_id')); // 계정 ID 칸은 안 넣음 (가계부 ID만)
    assert.match(norm(await page.innerText('.bk-last')), /오늘/);
    await page.click('.sheet button[aria-label="닫기"]');
    await page.click('button[aria-label="설정 메뉴"]');
    assert.equal(await page.locator('.menu-list .due-badge').count(), 0);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

describe('복원', () => {
  test('지운 내역 되살리기(빠진 것만): 미리 보기 숫자, 지금 바뀐 내용은 그대로, 요청 1번', async () => {
    const { ctx, page, errs } = await open(env, { seed: base() });
    const { file } = await downloadBackup(page, 'b2.json');
    await page.click('.sheet button[aria-label="닫기"]');
    // 다른 기기에서 2건 지우고 1건 수정한 상황
    await editDb(page, (d) => { d.transactions = d.transactions.filter((t) => t.id !== 's3' && t.id !== 's4'); d.transactions.find((t) => t.id === 's5').amount = 777; d.shopping_items = []; });
    await reopen(page);
    await chooseFile(page, file);
    const pv = norm(await page.innerText('.bk-preview'));
    assert.ok(pv.includes('새로 추가 2건') && pv.includes('이미 있음 23건') && pv.includes('내용이 다른 1건'), pv);
    assert.ok(pv.includes('장보기: 새로 추가 1개'), pv);
    assert.ok(pv.includes('설정: 바뀌는 것 없음'), pv);
    await page.click('.bk-preview button:has-text("복원하기")');
    await page.waitForSelector('.bk-done');
    assert.match(norm(await page.innerText('.bk-done')), /내역 2건 추가 · 장보기 1개 추가/);
    const d = await db(page);
    assert.ok(d.transactions.some((t) => t.id === 's3') && d.transactions.some((t) => t.id === 's4'));
    assert.equal(d.transactions.find((t) => t.id === 's5').amount, 777);
    assert.equal(d.shopping_items.length, 1);
    assert.equal(d.restoreCalls, 2); // 내역 1번 + 장보기 1번
    assert.equal(d.transactions.length, 25);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('백업 때로 덮어쓰기: 바뀐 내역·설정이 백업 값으로', async () => {
    const { ctx, page, errs } = await open(env, { seed: base() });
    const { file } = await downloadBackup(page, 'b3.json');
    await page.click('.sheet button[aria-label="닫기"]');
    await editDb(page, (d) => { d.transactions.find((t) => t.id === 's5').amount = 777; d.settings[0].budget = 1; });
    await reopen(page);
    await chooseFile(page, file);
    await page.click('.bk-mode label:has-text("백업 때로 덮어쓰기")');
    assert.ok(norm(await page.innerText('.bk-preview')).includes('설정: 월 예산'));
    await page.click('.bk-preview button:has-text("복원하기")');
    await page.waitForSelector('.bk-done');
    await page.waitForTimeout(1500); // 설정은 보관 목록으로 올라감
    const d = await db(page);
    assert.equal(d.transactions.find((t) => t.id === 's5').amount, 1005);
    assert.equal(d.settings[0].budget, 500000);
    assert.match(norm(await page.innerText('.bk-done')), /1건 되돌림/);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('설정은 빠진 것만 더함 (즐겨찾기 추가, 지금 예산은 유지)', async () => {
    const { ctx, page } = await open(env, { seed: seedScript({ transactions: rows(3) }) });
    const file = path.join(dir, 'b4.json');
    fs.writeFileSync(file, JSON.stringify({ format: 'ledger-backup', version: 1, ledgerId: 'u1', exportedAt: new Date().toISOString(),
      settings: { budget: 999, favorites: [fav] }, transactions: [], items: [] }));
    await editDb(page, (d) => { d.settings[0].budget = 300000; });
    await reopen(page);
    await chooseFile(page, file);
    assert.ok(norm(await page.innerText('.bk-preview')).includes('설정: 즐겨찾기'));
    await page.click('.bk-preview button:has-text("복원하기")');
    await page.waitForSelector('.bk-done');
    await page.waitForTimeout(1500);
    const d = await db(page);
    assert.deepEqual(d.settings[0].favorites.map((f) => f.id), ['f1']);
    assert.equal(d.settings[0].budget, 300000);
    await ctx.close();
  });

  test('다른 가계부의 백업 → 새 ID로 추가, 같은 파일을 다시 넣어도 중복 없음', async () => {
    const { ctx, page, errs } = await open(env, { seed: seedScript({ transactions: rows(2, 'mine') }) });
    const file = path.join(dir, 'b5.json');
    fs.writeFileSync(file, JSON.stringify({ format: 'ledger-backup', version: 1, ledgerId: 'other-ledger', exportedAt: new Date().toISOString(), settings: {},
      transactions: [{ id: 'mine0', type: 'expense', amount: 5000, category: '식비', memo: '다른가계부', date: '2026-10-01' }, { id: 'zz', type: 'income', amount: 9000, category: '월급', memo: '', date: '2026-10-25' }],
      items: [{ id: 'it', name: '휴지', qty: 1, price: 0, category: '생활용품', memo: '', checked: false, status: 'bought', paid: 5000, txId: 'zz', boughtAt: '2026-10-25' }] }));
    await chooseFile(page, file);
    assert.match(norm(await page.innerText('.bk-preview')), /다른 가계부.*새 내역으로 추가/);
    await page.click('.bk-preview button:has-text("복원하기")');
    await page.waitForSelector('.bk-done');
    let d = await db(page);
    assert.equal(d.transactions.length, 4);
    assert.equal(d.transactions.find((t) => t.id === 'mine0').memo, '메모0'); // 원래 내역 그대로
    const added = d.transactions.filter((t) => t.id.startsWith('rb-'));
    assert.equal(added.length, 2);
    const item = d.shopping_items.find((i) => i.name === '휴지');
    assert.ok(item.id.startsWith('rb-') && added.some((t) => t.id === item.tx_id)); // 장보기 연결도 새 ID로
    await page.click('.sheet button[aria-label="닫기"]');
    await chooseFile(page, file);
    assert.equal(norm(await page.innerText('.bk-preview button.btn:not(.ghost)')), '되살릴 것이 없어요');
    d = await db(page);
    assert.equal(d.transactions.length, 4);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('700건은 300건씩 나눠 보냄', async () => {
    const { ctx, page } = await open(env, { seed: seedScript({ transactions: [] }) });
    const file = path.join(dir, 'b6.json');
    fs.writeFileSync(file, JSON.stringify({ format: 'ledger-backup', version: 1, ledgerId: 'u1', settings: {}, items: [],
      transactions: Array.from({ length: 700 }, (_, i) => ({ id: 'big' + i, type: 'expense', amount: 100 + i, category: '식비', memo: '', date: '2026-09-01', createdAt: i })) }));
    await chooseFile(page, file);
    await page.click('.bk-preview button:has-text("복원하기")');
    await page.waitForSelector('.bk-done', { timeout: 15000 });
    const d = await db(page);
    assert.equal(d.transactions.length, 700);
    assert.equal(d.restoreCalls, 3);
    await ctx.close();
  });
});

describe('복원할 수 없는 경우', () => {
  test('잘못된 파일 → 안내만, 아무것도 안 바뀜', async () => {
    const { ctx, page } = await open(env, { seed: seedScript({ transactions: rows(2) }) });
    const bad1 = path.join(dir, 'bad1.json'); fs.writeFileSync(bad1, '날짜,금액\n2026-01-01,1000');
    const bad2 = path.join(dir, 'bad2.json'); fs.writeFileSync(bad2, JSON.stringify({ hello: 1 }));
    const bad3 = path.join(dir, 'bad3.json'); fs.writeFileSync(bad3, JSON.stringify({ format: 'ledger-backup', version: 99 }));
    const bad4 = path.join(dir, 'bad4.json');
    fs.writeFileSync(bad4, JSON.stringify({ format: 'ledger-backup', version: 1, ledgerId: 'u1', settings: { budget: -5 },
      transactions: [{ id: 'ok1', type: 'expense', amount: 10, category: '식비', date: '2026-10-01' }, { id: 'x', type: 'expense', amount: 0, category: '식비', date: '2026-10-01' }, { id: 'y', type: 'hack', amount: 1, category: '식비', date: 'x' }], items: [] }));
    await chooseFile(page, bad1);
    assert.match(await page.innerText('.backup .err'), /JSON 형식이 아님/);
    await page.setInputFiles('.backup input[type=file]', bad2);
    await page.waitForTimeout(200);
    assert.match(await page.innerText('.backup .err'), /가계부 백업 파일이 아니에요/);
    await page.setInputFiles('.backup input[type=file]', bad3);
    await page.waitForTimeout(200);
    assert.match(await page.innerText('.backup .err'), /더 새로운 버전/);
    await page.setInputFiles('.backup input[type=file]', bad4);
    await page.waitForTimeout(200);
    const pv = norm(await page.innerText('.bk-preview'));
    assert.ok(pv.includes('새로 추가 1건') && pv.includes('건너뛰는 항목: 내역 2건, 설정 1개'), pv);
    assert.equal((await db(page)).transactions.length, 2);
    await ctx.close();
  });

  test('014 전 DB → 업데이트 안내, 오프라인 → 버튼 꺼짐', async () => {
    const { ctx, page, errs } = await open(env, { seed: seedScript({ transactions: rows(2) }), init: ["sessionStorage.setItem('__no014','1')"] });
    const file = path.join(dir, 'b7.json');
    fs.writeFileSync(file, JSON.stringify({ format: 'ledger-backup', version: 1, ledgerId: 'u1', settings: {}, items: [],
      transactions: [{ id: 'n1', type: 'expense', amount: 10, category: '식비', date: '2026-10-01' }] }));
    await chooseFile(page, file);
    await page.click('.bk-preview button:has-text("복원하기")');
    await page.waitForTimeout(600);
    assert.match(await page.innerText('.backup .err'), /014_restore_backup\.sql/);
    assert.ok(!(await db(page)).transactions.some((t) => t.id === 'n1'));
    await ctx.setOffline(true);
    await page.waitForTimeout(300);
    assert.ok(await page.isDisabled('.bk-preview button:has-text("복원하기")'));
    assert.match(norm(await page.innerText('.bk-preview')), /인터넷에 연결되면/);
    await ctx.setOffline(false);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
