// 브라우저 테스트 공통 도우미: 정적 서버, 크로미움, 시드 데이터, 가짜 DB 읽기
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { after, before } from 'node:test';
import { chromium } from 'playwright';
import { OUT } from './build.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain' };

function serve(dir) {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(dir, p);
    if (!f.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

/** 테스트 파일마다 한 번: 서버 + 브라우저. 반환 객체의 url·browser 는 before 이후에 채워짐 */
export function setup() {
  const env = { url: '', browser: null };
  let srv;
  before(async () => {
    if (!fs.existsSync(path.join(OUT, 'index.html'))) throw new Error('먼저 빌드하세요: node tests/e2e/build.mjs (npm run test:e2e 는 자동)');
    srv = await serve(OUT);
    env.url = `http://localhost:${srv.address().port}/`;
    env.browser = await chromium.launch();
  });
  after(async () => { await env.browser?.close(); srv?.close(); });
  return env;
}

export const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const tx = (id, o = {}) => ({ id, user_id: 'u1', type: 'expense', amount: 1000, category: '식비', memo: '', date: today(), member_id: null, tags: [], card_id: null, inst_months: 1, created_at: 1, ...o });
export const settings = (o = {}) => ({ user_id: 'u1', budget: 0, members: [], recurring: [], categories: null, cat_budgets: {}, cards: [], favorites: [], dismissed_subs: [], ...o });

/** 가짜 DB 초기값. 탭을 처음 열 때 한 번만 들어감 (새로고침해도 유지) */
export function seedScript({ transactions = [], settingsRow = settings(), extra = {} } = {}) {
  const db = { writes: 0, shopping_items: [], ledger_members: [], ledger_invites: [], push_subscriptions: [], activity_log: [], tx_comments: [], transactions, settings: [settingsRow], ...extra };
  return `(() => { if (sessionStorage.getItem('__fakedb')) return; sessionStorage.setItem('__fakedb', ${JSON.stringify(JSON.stringify(db))}); })()`;
}

/** 새 창(컨텍스트)으로 앱 열기. errs 에 페이지 오류가 쌓임 */
export async function open(env, { seed = seedScript(), width = 390, path: p = '', init = [], contextOptions = {}, beforeGoto } = {}) {
  const ctx = await env.browser.newContext({ viewport: { width, height: 844 }, ...contextOptions });
  ctx.setDefaultTimeout(8000);
  await ctx.route('**fonts.g**', (r) => r.abort());
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(seed);
  for (const s of init) await page.addInitScript(s);
  if (beforeGoto) await beforeGoto(page);
  await page.goto(env.url + p);
  await page.waitForSelector('.nav-tabs');
  await settle(page);
  await page.evaluate(() => document.querySelector('.install-banner')?.remove());
  return { ctx, page, errs };
}

/** 필요할 때 불러오는 화면(.screen-loading)이 다 뜰 때까지 */
export async function settle(page, ms = 400) {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => !document.querySelector('.screen-loading'), null, { timeout: 5000 });
}

export async function tab(page, name) {
  await page.click(`.nav-tabs button:has-text("${name}")`);
  await settle(page, 250);
}

export async function menu(page, item) {
  await page.click('button[aria-label="설정 메뉴"]');
  await page.click(`.menu-list button:has-text("${item}")`);
  await settle(page, 300);
}

export async function addTx(page, amount, memo) {
  await page.click('.fab');
  await page.waitForSelector('.sheet');
  await page.fill('.sheet .amount-input input', String(amount));
  await page.fill('.sheet input[id$="-memo"]', memo);
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(600);
}

export const db = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('__fakedb')));
export const pending = (page, ledger = 'u1') => page.evaluate((l) => JSON.parse(localStorage.getItem('ledger.outbox.' + l) || '[]'), ledger);
export const norm = (s) => s.replace(/\s+/g, ' ').trim();
