// 공유 가계부 참여, 댓글, 변경 기록·되살리기
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, menu, tab, addTx, seedScript, settings, tx, db, norm } from './helpers.mjs';

const env = setup();
const people = settings({ members: [{ id: 'm1', name: '민지', color: 0 }, { id: 'm2', name: '준호', color: 1 }] });
const close = async (page) => {
  while (await page.locator('.sheet button[aria-label="닫기"]').count()) { await page.click('.sheet button[aria-label="닫기"]'); await page.waitForTimeout(250); }
};
const asUser = async (page, uid, p = '') => {
  await page.evaluate((u) => sessionStorage.setItem('__uid', u), uid);
  await page.goto(env.url + p);
  await page.waitForSelector('.nav-tabs');
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector('.install-banner')?.remove());
};
const comment = (txId, id, body, author = 'u2', name = '준호') =>
  ({ id, user_id: 'u1', tx_id: txId, author, author_name: name, body, created_at: new Date().toISOString() });

describe('공유 가계부', () => {
  test('초대 코드 → 다른 계정이 링크로 참여 → 같은 내역을 보고 함께 입력', async () => {
    const { ctx, page, errs } = await open(env, { seed: seedScript({ transactions: [tx('a1', { amount: 12000, memo: '공유점심', member_id: 'm1' })], settingsRow: people }) });
    await menu(page, '가계부 공유');
    await page.click('button:has-text("초대 코드 만들기")');
    const shown = norm(await page.innerText('.invite-code'));
    assert.match(shown, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const code = shown.replace('-', '');
    await close(page);

    await asUser(page, 'u2');
    await tab(page, '내역');
    assert.equal(await page.locator('.tx:has-text("공유점심")').count(), 0); // 참여 전엔 안 보임
    await asUser(page, 'u2', `?join=${code}`);
    await page.waitForSelector('.share-panel');
    assert.equal(await page.inputValue('input[aria-label="초대 코드"]'), code);
    assert.ok(!page.url().includes('join='));
    await page.click('.share-panel button:has-text("확인")');
    await page.waitForSelector('.join-confirm');
    assert.match(norm(await page.innerText('.join-confirm')), /me\*\*\*@example\.com님의 가계부/);
    await page.click('.join-confirm label:has-text("준호") input');
    await page.click('button:has-text("참여하기")');
    await page.waitForTimeout(1000);
    assert.match(norm(await page.innerText('.share-panel')), /공유 가계부에 참여 중/);
    await close(page);
    await tab(page, '내역');
    assert.equal(await page.locator('.tx:has-text("공유점심")').count(), 1);
    await addTx(page, 3000, '준호커피');
    const row = (await db(page)).transactions.find((t) => t.memo === '준호커피');
    assert.equal(row.user_id, 'u1'); // 공유 가계부(주인 ID)에 저장
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

describe('댓글', () => {
  const seed = seedScript({ transactions: [tx('t1', { amount: 12000, memo: '점심' })], settingsRow: people, extra: { ledger_members: [{ user_id: 'u2', ledger_id: 'u1', person_id: 'm2' }] } });

  test('쓰기 → 목록 💬, 다른 사람 댓글 알림 → 누르면 그 내역, 내 댓글만 삭제', async () => {
    const { ctx, page, errs } = await open(env, { seed, path: '#list' });
    await page.click('.tx:has-text("점심")');
    await page.waitForSelector('.comments');
    await page.fill('input[aria-label="댓글 입력"]', '회사 근처 국밥');
    await page.click('.comment-form button');
    await page.waitForTimeout(600);
    const c = (await db(page)).tx_comments;
    assert.equal(c.length, 1);
    assert.equal(c[0].author, 'u1');
    await close(page);
    assert.equal(norm(await page.locator('.tx:has-text("점심") .cm-mark').innerText()), '💬 1');

    await page.evaluate((m) => window.__rt('tx_comments', { eventType: 'INSERT', new: m }), comment('t1', 'rc1', '맛있었어?'));
    await page.waitForTimeout(300);
    const banner = norm(await page.innerText('.notify-banner'));
    assert.ok(banner.includes('준호님이 댓글을 남겼어요') && banner.includes('맛있었어?'), banner);
    await page.click('.notify-banner .nb-main');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.sheet h3:has-text("내역 수정")').count(), 1);
    assert.ok(norm(await page.innerText('.comment-list')).includes('맛있었어?'));

    await page.evaluate((m) => window.__rt('tx_comments', { eventType: 'INSERT', new: m }), comment('t1', 'rc2', '내꺼', 'u1', 'me'));
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.notify-banner').count(), 0); // 내 댓글은 알림 없음

    assert.equal(await page.locator('.comment-list .cm-del').count(), 2); // 내 댓글 2개에만
    await page.locator('.comment-list li.mine .cm-del').first().click();
    await page.waitForTimeout(500);
    assert.equal((await db(page)).tx_comments.filter((x) => x.author === 'u1').length, 0);

    await ctx.setOffline(true);
    await page.waitForTimeout(300);
    assert.ok(await page.isDisabled('input[aria-label="댓글 입력"]'));
    await ctx.setOffline(false);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('푸시 알림 링크(?tx=)로 열면 그 내역이 열림', async () => {
    const { ctx, page } = await open(env, { seed, path: '?tx=t1' });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.sheet h3:has-text("내역 수정")').count(), 1);
    assert.ok(!page.url().includes('tx='));
    await ctx.close();
  });
});

describe('변경 기록', () => {
  test('수정 기록 "이전으로", 댓글 달린 내역 삭제 → 되살리면 같은 ID·댓글 그대로', async () => {
    const { ctx, page, errs } = await open(env, { path: '#list', seed: seedScript({ settingsRow: people }) });
    await addTx(page, 8800, '댓글테스트');
    const id = (await db(page)).transactions.find((t) => t.memo === '댓글테스트').id;
    // 메모 수정 → 변경 기록에서 이전으로
    await page.click('.tx:has-text("댓글테스트")');
    await page.waitForSelector('.sheet');
    await page.fill('.sheet input[id$="-memo"]', '댓글테스트(오타)');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(600);
    await menu(page, '변경 기록');
    await page.waitForSelector('.activity');
    assert.ok(norm(await page.locator('.act').first().innerText()).includes('메모 댓글테스트 → 댓글테스트(오타)'));
    await page.locator('.act').first().locator('button:has-text("이전으로")').click();
    await page.locator('.act').first().locator('button:has-text("되돌리기")').click();
    await page.waitForTimeout(700);
    await close(page);
    assert.equal((await db(page)).transactions.find((t) => t.id === id).memo, '댓글테스트');

    // 댓글 2개 (내 것 + 다른 사람 것)
    await page.click('.tx:has-text("댓글테스트")');
    await page.waitForSelector('.comments');
    await page.fill('input[aria-label="댓글 입력"]', '첫 번째 댓글');
    await page.click('.comment-form button');
    await page.waitForTimeout(500);
    await page.evaluate((m) => { const d = JSON.parse(sessionStorage.getItem('__fakedb')); d.tx_comments.push(m); sessionStorage.setItem('__fakedb', JSON.stringify(d)); },
      comment(id, 'rcx', '두 번째 댓글'));
    await page.evaluate((m) => window.__rt('tx_comments', { eventType: 'INSERT', new: m }), comment(id, 'rcx', '두 번째 댓글'));
    await page.waitForTimeout(300);
    if (await page.locator('.notify-banner').count()) await page.click('.notify-banner .nb-close');
    assert.equal(await page.locator('.comment-list li').count(), 2);
    await page.click('.sheet .btn.danger');
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.tx:has-text("댓글테스트")').count(), 0);
    assert.equal((await db(page)).tx_comments.filter((c) => c.tx_id === id).length, 2); // 댓글은 DB에 남음

    await menu(page, '변경 기록');
    await page.waitForSelector('.activity');
    const row = page.locator('.act:has-text("댓글테스트"):has-text("지출 삭제")').first();
    await row.locator('button:has-text("되살리기")').click();
    await row.locator('.btn.primary:has-text("되살리기")').click();
    await page.waitForTimeout(800);
    await close(page);
    const back = (await db(page)).transactions.filter((t) => t.id === id);
    assert.equal(back.length, 1);
    assert.equal(back[0].amount, 8800);
    assert.equal(norm(await page.locator('.tx:has-text("댓글테스트") .cm-mark').innerText()), '💬 2');
    await page.click('.tx:has-text("댓글테스트")');
    await page.waitForSelector('.comments');
    assert.deepEqual((await page.locator('.comment-list li p').allInnerTexts()).map(norm), ['첫 번째 댓글', '두 번째 댓글']);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
