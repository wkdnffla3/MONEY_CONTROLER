// 푸시 켜기: 브라우저가 대답하지 않아도 "처리 중…"에서 멈추지 않고 단계·이유를 보여 줌, 앱 안 브라우저 안내
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, menu, db } from './helpers.mjs';
const env = setup();

// 가짜 푸시 API. mode: 'ok' | 'perm-hang' | 'sub-hang'
const fakePush = (mode) => `(() => {
  const mode = ${JSON.stringify(mode)};
  let perm = 'default';
  window.Notification = function () {};
  Object.defineProperty(window.Notification, 'permission', { get: () => perm });
  window.Notification.requestPermission = () => mode === 'perm-hang' ? new Promise(() => {}) : Promise.resolve(perm = 'granted');
  window.PushManager = function () {};
  const mk = (ep) => ({ endpoint: ep, unsubscribe: async () => { sub = null; sessionStorage.removeItem('__pushsub'); return true; },
    toJSON: () => ({ endpoint: ep, keys: { p256dh: 'p', auth: 'a' } }) });
  let sub = sessionStorage.getItem('__pushsub') ? mk(sessionStorage.getItem('__pushsub')) : null; // 새로고침해도 남는 구독
  const pushManager = {
    getSubscription: async () => sub,
    subscribe: () => mode === 'sub-hang' ? new Promise(() => {}) : Promise.resolve((sessionStorage.setItem('__pushsub', 'https://fcm.googleapis.com/fcm/send/abc'), sub = mk('https://fcm.googleapis.com/fcm/send/abc'))),
  };
  const reg = { pushManager, showNotification: async () => {} };
  Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => reg, ready: Promise.resolve(reg), register: async () => reg, addEventListener() {}, controller: null } });
})();`;

async function openNotify(page) { await menu(page, '알림'); await page.waitForSelector('.notify-settings .ns-badge:not(.ns-checking)'); }

test('정상: 단계를 거쳐 켜짐', async () => {
  const { ctx, page, errs } = await open(env, { init: [fakePush('ok')] });
  await openNotify(page);
  await page.click('.notify-settings button:has-text("푸시 켜기")');
  await page.waitForSelector('.notify-settings button:has-text("푸시 끄기")', { timeout: 5000 });
  assert.equal((await db(page)).push_subscriptions?.length ?? 1, 1);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('권한 창에 대답이 없으면 → 단계 표시, 제한 시간 뒤 이유 안내 (멈추지 않음)', async () => {
  const { ctx, page, errs } = await open(env, { init: [fakePush('perm-hang')], beforeGoto: (p) => p.clock.install() });
  await openNotify(page);
  await page.click('.notify-settings button:has-text("푸시 켜기")');
  await page.waitForTimeout(100);
  assert.match(await page.innerText('.notify-settings [role="status"]'), /알림 권한 확인 중/);
  await page.clock.runFor(46000);
  await page.waitForTimeout(200);
  assert.match(await page.innerText('.notify-settings .err'), /주소창 옆의 🔔/);
  assert.equal(await page.locator('.notify-settings button:has-text("푸시 켜기")').isEnabled(), true);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('푸시 서비스 연결이 안 되면 → 제한 시간 뒤 이유 안내', async () => {
  const { ctx, page, errs } = await open(env, { init: [fakePush('sub-hang')], beforeGoto: (p) => p.clock.install() });
  await openNotify(page);
  await page.click('.notify-settings button:has-text("푸시 켜기")');
  await page.waitForTimeout(100);
  await page.clock.runFor(1000);
  assert.match(await page.innerText('.notify-settings [role="status"]'), /푸시 서비스에 연결 중/);
  await page.clock.runFor(21000);
  await page.waitForTimeout(200);
  assert.match(await page.innerText('.notify-settings .err'), /푸시 서비스에 연결하지 못했어요/);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('카카오톡 안 브라우저 → 켜기 버튼 대신 다른 브라우저로 열라는 안내', async () => {
  const { ctx, page, errs } = await open(env, { init: [fakePush('ok')], contextOptions: { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 KAKAOTALK 10.4.0' } });
  await openNotify(page);
  assert.match(await page.innerText('.notify-settings'), /앱 안 브라우저에서는 웹 푸시를 켤 수 없어요/);
  assert.equal(await page.locator('.notify-settings button:has-text("푸시 켜기")').count(), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('삼성 인터넷: 미리 설정 안내, 권한 창이 안 뜨면 20초 뒤 삼성 설정 방법', async () => {
  const ua = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36';
  const { ctx, page, errs } = await open(env, { init: [fakePush('perm-hang')], contextOptions: { userAgent: ua }, beforeGoto: (p) => p.clock.install() });
  await openNotify(page);
  assert.match(await page.innerText('.notify-settings'), /삼성 인터넷: 권한 창이 안 뜨면/);
  await page.click('.notify-settings button:has-text("푸시 켜기")');
  await page.clock.runFor(21000);
  await page.waitForTimeout(200);
  assert.match(await page.innerText('.notify-settings .err'), /애플리케이션 → 삼성 인터넷 → 알림 허용/);
  assert.deepEqual(errs, []);
  await ctx.close();
});


const subOf = (page) => page.evaluate(async () => !!(await (await navigator.serviceWorker.getRegistration()).pushManager.getSubscription()));
test('로그인했는데 이 브라우저의 푸시 구독이 내 계정 것이 아니면(다른 계정이 로그아웃 없이 떠남) 해제', async () => {
  const { seedScript } = await import('./helpers.mjs');
  const { ctx, page, errs } = await open(env, { seed: seedScript(), init: ["sessionStorage.setItem('__pushsub', 'https://fcm.googleapis.com/fcm/send/someone-else')", fakePush('ok')] });
  await page.waitForTimeout(800);
  assert.equal(await subOf(page), false);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('내 계정 구독이면 그대로', async () => {
  const { seedScript } = await import('./helpers.mjs');
  const ep = 'https://fcm.googleapis.com/fcm/send/mine';
  const seed = seedScript({ extra: { push_subscriptions: [{ id: 'ps1', user_id: 'u1', account_id: 'u1', device_id: 'd', endpoint: ep, p256dh: 'p', auth: 'a', prefs: {} }] } });
  const { ctx, page, errs } = await open(env, { seed, init: [`sessionStorage.setItem('__pushsub', '${ep}')`, fakePush('ok')] });
  await page.waitForTimeout(800);
  assert.equal(await subOf(page), true);
  assert.deepEqual(errs, []);
  await ctx.close();
});
