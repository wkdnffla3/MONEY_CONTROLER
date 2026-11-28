// 오프라인 앱(서비스 워커): 첫 방문 직후 오프라인에서도 모든 탭이 열림, 매니페스트, 바로가기
// 테스트 빌드는 PROD=false 라 앱이 서비스 워커를 직접 등록하지 않으므로, 여기서 public/sw.js 를 등록해 확인합니다.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, open, tab, seedScript, tx } from './helpers.mjs';
import { OUT } from './build.mjs';

const env = setup();
const seed = seedScript({ transactions: [tx('a1', { memo: '오프라인확인' })] });

describe('오프라인 앱', () => {
  test('첫 방문에서 화면 파일을 모두 저장 → 오프라인 새로고침해도 모든 탭이 열림', async () => {
    const { ctx, page, errs } = await open(env, { seed });
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForSelector('.nav-tabs');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cached = await page.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
      return out;
    });
    const chunks = cached.filter((p) => /\/assets\/chunk-.*\.js$/.test(p));
    assert.ok(cached.includes('/'), JSON.stringify(cached));
    assert.ok(chunks.length >= 3, `나뉜 화면 파일 ${chunks.length}개만 저장됨`);

    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('.nav-tabs');
    for (const t of ['내역', '장보기', '리포트', '가계부']) {
      await tab(page, t);
      assert.equal(await page.locator('.screen-error').count(), 0, `오프라인에서 ${t} 탭 오류`);
    }
    await tab(page, '내역');
    assert.equal(await page.locator('.tx:has-text("오프라인확인")').count(), 1);
    await ctx.setOffline(false);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('새 버전을 받으면 예전 빌드 파일은 캐시에서 지움 (배포할 때마다 쌓이지 않게), 오프라인은 그대로', async () => {
    const { ctx, page, errs } = await open(env, { seed });
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForTimeout(800);
    // 예전 배포의 파일이 남아 있는 상황
    await page.evaluate(async () => {
      const k = (await caches.keys()).find((x) => x.startsWith('ledger-assets-'));
      const c = await caches.open(k);
      await c.put('/assets/chunk-OLDDEPLOY1.js', new Response('// old', { headers: { 'Content-Type': 'text/javascript' } }));
      await c.put('/assets/index-OLDDEPLOY.css', new Response('', { headers: { 'Content-Type': 'text/css' } }));
    });
    // 새로 배포된 상황: index.html 내용이 바뀜 → 새 화면을 받으면서 정리
    const htmlPath = path.join(OUT, 'index.html');
    const original = fs.readFileSync(htmlPath, 'utf8');
    fs.writeFileSync(htmlPath, original.replace('</body>', '<!-- deploy 2 --></body>'));
    try {
      await page.reload();
      await page.waitForSelector('.nav-tabs');
      await page.waitForTimeout(1500);
    } finally {
      fs.writeFileSync(htmlPath, original);
    }
    const cached = await page.evaluate(async () => {
      const k = (await caches.keys()).find((x) => x.startsWith('ledger-assets-'));
      return (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname);
    });
    assert.ok(!cached.some((p) => p.includes('OLDDEPLOY')), JSON.stringify(cached));
    assert.ok(cached.includes('/assets/index.js'));
    assert.ok(cached.filter((p) => /chunk-.*\.js$/.test(p)).length >= 3);
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('.nav-tabs');
    for (const t of ['내역', '장보기', '리포트']) {
      await tab(page, t);
      assert.equal(await page.locator('.screen-error').count(), 0, t);
    }
    await ctx.setOffline(false);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('매니페스트: 이름·홈 화면 모드·아이콘·내역 바로가기', async () => {
    const { ctx, page } = await open(env, { seed });
    const m = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.length >= 2);
    assert.ok((m.shortcuts || []).some((s) => s.url.includes('#list')));
    for (const icon of m.icons) assert.equal(await page.evaluate((u) => fetch(u).then((r) => r.status), icon.src), 200, icon.src);
    await ctx.close();
  });

  test('공유 대상(share_target): 서비스 워커가 공유 글을 서버로 보내지 않고 받아 앱으로 넘김', async () => {
    const { ctx, page, errs } = await open(env, { seed });
    const m = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
    assert.deepEqual(m.share_target, { action: '/share-target', method: 'POST', enctype: 'multipart/form-data', params: { title: 'title', text: 'text', url: 'url' } });
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForSelector('.nav-tabs');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    // 서비스 워커가 가로채면 서버 대신 "/?share=1 로 넘김"(redirect) 응답이 오고, 글은 이 기기 캐시에만 있음
    // (테스트 서버에는 /share-target 이 없어서, 서버까지 갔다면 redirect 가 아니라 다른 응답이 옴)
    const res = await page.evaluate(async () => {
      const fd = new FormData();
      fd.append('text', '삼성1234승인 홍*동\n8,500원 일시불\n11/26 12:05 김밥천국');
      const r = await fetch('/share-target', { method: 'POST', body: fd, redirect: 'manual' });
      const c = await (await caches.open('ledger-share')).match('/__shared-text');
      return { type: r.type, saved: c ? await c.text() : null };
    });
    assert.equal(res.type, 'opaqueredirect'); // /?share=1 로 넘김
    assert.match(res.saved, /8,500원/);
    // 앱이 공유 주소로 열리면 입력 창을 채우고 받은 글을 지움
    await page.goto(env.url + '?share=1');
    await page.waitForSelector('.sheet .amount-input input');
    assert.equal(await page.inputValue('.sheet .amount-input input'), '8,500');
    assert.equal(await page.evaluate(async () => !!(await (await caches.open('ledger-share')).match('/__shared-text'))), false);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test('바로가기 ?action=add → 내역 추가 창', async () => {
    const { ctx, page } = await open(env, { seed, path: '?action=add' });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.sheet h3:has-text("내역 추가")').count(), 1);
    await ctx.close();
  });
});
