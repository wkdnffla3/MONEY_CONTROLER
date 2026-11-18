// 개인정보 처리방침(#privacy, 로그인 없이), 회원가입 안내, 계정·개인정보 화면, 회원 탈퇴
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, menu, seedScript, settings, tx, db, norm } from './helpers.mjs';

const env = setup();

async function openSignedOut(path = '') {
  const ctx = await env.browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**fonts.g**', (r) => r.abort());
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(seedScript());
  await page.addInitScript("sessionStorage.setItem('__signedOut','1')");
  await page.goto(env.url + path);
  return { ctx, page, errs };
}

describe('개인정보 처리방침', () => {
  test('로그인 화면 아래 링크 → 처리방침, 돌아가기 → 로그인 화면', async () => {
    const { ctx, page, errs } = await openSignedOut();
    await page.waitForSelector('.auth');
    await page.click('.auth-foot a:has-text("개인정보 처리방침")');
    await page.waitForSelector('.privacy-page h1');
    const text = norm(await page.innerText('.privacy-page'));
    for (const must of ['처리하는 개인정보와 목적', '보관 기간과 파기', '처리 위탁과 국외 이전', 'Supabase', 'Vercel', '제28조의8', '만 14세 미만', '개인정보 보호책임자', '회원 탈퇴']) {
      assert.ok(text.includes(must), `처리방침에 "${must}" 없음`);
    }
    await page.click('.privacy-page .privacy-back');
    await page.waitForSelector('.auth');
    assert.ok(!page.url().includes('#privacy'));
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('주소 #privacy 로 바로 열기 (로그인 없이)', async () => {
    const { ctx, page } = await openSignedOut('#privacy');
    await page.waitForSelector('.privacy-page h1');
    assert.equal(norm(await page.innerText('.privacy-page h1')), '개인정보 처리방침');
    await ctx.close();
  });

  test('회원가입 화면에 처리방침 안내·만 14세 이상 (동의 체크박스는 없음)', async () => {
    const { ctx, page } = await openSignedOut();
    await page.waitForSelector('.auth');
    assert.equal(await page.locator('.auth-legal').count(), 0); // 로그인 탭엔 없음
    await page.click('.auth button[role="tab"]:has-text("회원가입")');
    const legal = norm(await page.innerText('.auth-legal'));
    assert.ok(legal.includes('개인정보 처리방침') && legal.includes('만 14세 이상'), legal);
    assert.equal(await page.locator('.auth form input[type="checkbox"]').count(), 0);
    await ctx.close();
  });
});

describe('계정·개인정보', () => {
  test('로그인 후 메뉴 → 계정 이메일·처리방침 링크', async () => {
    const { ctx, page, errs } = await open(env);
    await menu(page, '계정·개인정보');
    assert.equal(norm(await page.innerText('.account-panel .acc-email')), 'me@example.com');
    await page.click('.account-panel a:has-text("개인정보 처리방침")');
    await page.waitForSelector('.privacy-page');
    await page.click('.privacy-page .privacy-close');
    await page.waitForSelector('.nav-tabs');
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('회원 탈퇴: "탈퇴" 입력해야 버튼이 켜짐 → 서버 데이터·이 기기 사본 삭제 → 로그인 화면', async () => {
    const { ctx, page, errs } = await open(env, { seed: seedScript({ transactions: [tx('t1', { memo: '지워질내역' })], settingsRow: settings({ budget: 100000 }) }) });
    await menu(page, '계정·개인정보');
    await page.click('.account-panel button:has-text("회원 탈퇴")');
    const go = page.locator('.del-box button:has-text("탈퇴하기")');
    assert.ok(await go.isDisabled());
    assert.match(norm(await page.innerText('.del-box')), /가계부 전체.*바로 지워져요/);
    await page.fill('#del-word', '탈 퇴');
    assert.ok(await go.isDisabled());
    await page.fill('#del-word', '탈퇴');
    await go.click();
    await page.waitForSelector('.auth', { timeout: 8000 });
    const d = await db(page);
    assert.deepEqual(d.deletedAccounts, ['u1']);
    assert.equal(d.transactions.length, 0);
    const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ledger.') && /u1/.test(k)));
    assert.deepEqual(left, []); // 이 기기의 가계부 사본·보낼 목록도 지움
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('공유 가계부 참여자 탈퇴 안내 / 참여자가 있는 주인은 탈퇴 대신 공유 열기', async () => {
    // 참여자(u2)
    let { ctx, page } = await open(env, {
      seed: seedScript({ extra: { ledger_members: [{ user_id: 'u2', ledger_id: 'u1', person_id: null }] } }),
      init: ["sessionStorage.setItem('__uid','u2')"],
    });
    await menu(page, '계정·개인정보');
    await page.click('.account-panel button:has-text("회원 탈퇴")');
    assert.match(norm(await page.innerText('.del-box')), /공유 가계부에 입력한 내역은 그 가계부에 남아요/);
    await ctx.close();
    // 주인(u1)
    ({ ctx, page } = await open(env, { seed: seedScript({ extra: { ledger_members: [{ user_id: 'u2', ledger_id: 'u1', person_id: null }] } }) }));
    await menu(page, '계정·개인정보');
    assert.equal(await page.locator('.account-panel button:has-text("회원 탈퇴")').count(), 0);
    assert.match(norm(await page.innerText('.account-panel')), /다른 사람이 내 가계부에 참여 중이라 지금은 탈퇴할 수 없어요/);
    await page.click('.account-panel button:has-text("가계부 공유 열기")');
    await page.waitForSelector('.share-panel');
    await ctx.close();
  });

  test('016 전 DB → 업데이트 안내, 아무것도 안 지워짐', async () => {
    const { ctx, page, errs } = await open(env, { seed: seedScript({ transactions: [tx('t1')] }), init: ["sessionStorage.setItem('__no016','1')"] });
    await menu(page, '계정·개인정보');
    await page.click('.account-panel button:has-text("회원 탈퇴")');
    await page.fill('#del-word', '탈퇴');
    await page.click('.del-box button:has-text("탈퇴하기")');
    await page.waitForTimeout(500);
    assert.match(await page.innerText('.account-panel .err'), /016_delete_account\.sql/);
    assert.equal((await db(page)).transactions.length, 1);
    assert.equal(await page.locator('.nav-tabs').count(), 1);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
