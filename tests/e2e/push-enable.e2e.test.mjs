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
  let sub = null;
  const pushManager = {
    getSubscription: async () => sub,
    subscribe: () => mode === 'sub-hang' ? new Promise(() => {}) : Promise.resolve(sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc', unsubscribe: async () => { sub = null; return true; },
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }),
    }),
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
