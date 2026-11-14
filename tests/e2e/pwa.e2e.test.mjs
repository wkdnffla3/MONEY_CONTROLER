// 오프라인 앱(서비스 워커): 첫 방문 직후 오프라인에서도 모든 탭이 열림, 매니페스트, 바로가기
// 테스트 빌드는 PROD=false 라 앱이 서비스 워커를 직접 등록하지 않으므로, 여기서 public/sw.js 를 등록해 확인합니다.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, tab, seedScript, tx } from './helpers.mjs';

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

  test('매니페스트: 이름·홈 화면 모드·아이콘·내역 바로가기', async () => {
    const { ctx, page } = await open(env, { seed });
    const m = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.length >= 2);
    assert.ok((m.shortcuts || []).some((s) => s.url.includes('#list')));
    for (const icon of m.icons) assert.equal(await page.evaluate((u) => fetch(u).then((r) => r.status), icon.src), 200, icon.src);
    await ctx.close();
  });

  test('바로가기 ?action=add → 내역 추가 창', async () => {
    const { ctx, page } = await open(env, { seed, path: '?action=add' });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.sheet h3:has-text("내역 추가")').count(), 1);
    await ctx.close();
  });
});
