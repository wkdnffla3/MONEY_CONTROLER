// push-notify Edge Function 테스트 (Deno 대신 Node, web-push·Supabase 는 가짜)
// 실행: npm run test:edge
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(root, 'tests/.build/edge/fn.mjs');
const mock = (f) => pathToFileURL(path.join(here, f)).href;
await build({
  entryPoints: [path.join(root, 'supabase/functions/push-notify/index.ts')], bundle: true, format: 'esm', outfile: out, logLevel: 'warning',
  plugins: [{ name: 'npm-alias', setup(b) {
    b.onResolve({ filter: /^npm:web-push/ }, () => ({ path: mock('webpush-mock.mjs'), external: true }));
    b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: mock('supa-mock.mjs'), external: true }));
  } }],
});
const env = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.c', WEBHOOK_SECRET: 's3cret', SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
const { db } = await import(mock('supa-mock.mjs'));
const { sent } = await import(mock('webpush-mock.mjs'));
await import(pathToFileURL(out).href);
const call = (body, secret = 's3cret', method = 'POST') => handler(new Request('http://x/', { method, headers: secret ? { 'x-webhook-secret': secret } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined })).then(async (r) => ({ status: r.status, body: await r.json() }));
const L = 'ledger-a', L2 = 'ledger-b';
db.settings.push({ user_id: L, members: [{ id: 'm1', name: '민지', color: 0 }, { id: 'm2', name: '준호', color: 1 }], budget: 400000 });
db.ledger_members.push({ user_id: 'acct-writer', ledger_id: L, person_id: 'm2' }, { user_id: 'acct-noperson', ledger_id: L, person_id: null });
const sub = (id, ledger, dev, prefs = {}) => ({ id, user_id: ledger, device_id: dev, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'p', auth: 'a', prefs });
db.push_subscriptions.push(sub('s1', L, 'dev1'), sub('s2', L, 'dev2'), sub('s3', L, 'dev3', { tx: false }), sub('gone1', L, 'dev4'), sub('s5', L2, 'dev5'));
const rec = { id: 't1', user_id: L, type: 'expense', amount: 12000, category: '식비', memo: '점심', member_id: 'm1', device_id: 'dev1' };

// 보안
assert.equal((await call({}, null)).status, 401);
assert.equal((await call({}, 's3cre')).status, 401);
assert.equal((await call({}, 's3cret-x')).status, 401);
assert.equal((await call(null, 's3cret', 'GET')).status, 405);
console.log('ok 1. 비밀 값 없거나 틀리면 401, GET 405');

// 새 내역 → 같은 가계부 다른 기기만, 꺼둔 기기 제외, 만료 구독 삭제
let r = await call({ type: 'INSERT', table: 'transactions', record: rec });
assert.equal(r.status, 200);
assert.deepEqual(r.body, { sent: 1, skipped: 2, removed: 1 });
assert.equal(sent.length, 1);
assert.equal(sent[0].endpoint, 'https://fcm.googleapis.com/fcm/send/s2');
assert.equal(sent[0].msg.title, '민지님이 지출을 추가했어요');
assert.equal(sent[0].msg.body, '식비 12,000원 · 점심');
assert.ok(!db.push_subscriptions.some((s) => s.id === 'gone1'));
assert.match(sent[0].opts.topic, /^[A-Za-z0-9_-]{1,32}$/);
console.log('ok 2. 새 내역: 입력 기기·꺼둔 기기 제외, 다른 가계부 제외, 만료 구독 삭제 →', JSON.stringify(r.body));

// 무시해야 하는 것
for (const body of [
  { type: 'UPDATE', table: 'transactions', record: rec },
  { type: 'INSERT', table: 'settings', record: { id: 'x', user_id: L } },
  { type: 'INSERT', table: 'transactions', record: { ...rec, id: 'rec-r-2026-11' } },
  { type: 'INSERT', table: 'transactions', record: { ...rec, user_id: 5 } },
]) { r = await call(body); assert.equal(r.status, 200); assert.ok(r.body.skipped); }
assert.equal((await call('not json')).status, 200); // 문자열 JSON → 무시
console.log('ok 3. 수정·다른 테이블·반복 내역·이상한 값은 보내지 않음');

// 장보기 물품
sent.length = 0;
r = await call({ type: 'INSERT', table: 'shopping_items', record: { id: 'i1', user_id: L, name: '우유', qty: 1, price: 0, status: 'todo', device_id: 'dev9' } });
assert.deepEqual(r.body, { sent: 3, skipped: 0, removed: 0 });
assert.equal(sent[0].msg.title, '다른 기기에서 장보기에 추가했어요');
console.log('ok 4. 장보기 물품 추가 → 같은 가계부 기기 전체 (내역 알림 끈 기기도 받음)');

// 리포트
sent.length = 0;
const today = new Date();
const kst = new Date(today.getTime() + 9 * 3600e3);
const dow = (kst.getUTCDay() + 6) % 7;
const d = (n) => { const x = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - dow - n)); return x.toISOString().slice(0, 10); };
db.transactions.push(
  { user_id: L, type: 'expense', amount: 30000, category: '식비', date: d(3) },   // 지난주
  { user_id: L, type: 'expense', amount: 10000, category: '교통', date: d(5) },   // 지난주
  { user_id: L, type: 'expense', amount: 80000, category: '식비', date: d(10) },  // 그 전주
  { user_id: L2, type: 'expense', amount: 1, category: 'x', date: d(30) },        // 다른 가계부, 지난주 없음
);
db.push_subscriptions.push(sub('s6', L, 'dev6', { weekly: false }));
r = await call({ type: 'REPORT', period: 'week' });
assert.equal(r.status, 200);
assert.equal(r.body.ledgers, 1); assert.equal(r.body.empty, 1);
assert.equal(r.body.sent, 3); // s1 s2 s3 (s6은 주간 끔)
assert.equal(sent[0].msg.title, '지난주 지출 40,000원');
assert.equal(sent[0].msg.body, '그 전주보다 50% 줄었어요 · 가장 많이 쓴 곳 식비 30,000원');
console.log('ok 5. 주간 리포트: 가계부별 계산, 끈 기기·내역 없는 가계부 제외 →', JSON.stringify({ ...r.body, range: undefined }));
r = await call({ type: 'REPORT', period: 'month' });
assert.equal(r.status, 200);
console.log('ok 6. 월간 리포트 호출 →', JSON.stringify({ ...r.body, range: r.body.range.cur }));
{
  // 내역이 1000건을 넘어도 리포트 합계가 잘리지 않음 (지난주 1500건 × 100원)
  const before = db.transactions.length;
  for (let i = 0; i < 1500; i++) db.transactions.push({ id: `big${String(i).padStart(5, '0')}`, user_id: L, type: 'expense', amount: 100, category: '간식', date: d(4) });
  sent.length = 0;
  const rb = await call({ type: 'REPORT', period: 'week' });
  assert.equal(rb.status, 200);
  assert.equal(sent[0].msg.title, '지난주 지출 190,000원'); // 40,000 + 150,000
  db.transactions.length = before;
  console.log('ok 6b. 내역 1000건 넘어도 리포트 합계 전부');
}
{
  // 기기 시간 기준: 알림 설정의 시간대(prefs.tz)마다 "지난주"를 따로 계산, 같은 가계부는 한 번만 셈
  const { reportRange } = await import('../../supabase/functions/_shared/notifyMessage.js');
  db.push_subscriptions.push(sub('s7', L, 'dev7', { tz: 'America/Los_Angeles' }));
  sent.length = 0;
  const rt = await call({ type: 'REPORT', period: 'week' });
  assert.equal(rt.status, 200);
  assert.deepEqual(Object.keys(rt.body.ranges).sort(), ['America/Los_Angeles', 'Asia/Seoul']);
  assert.deepEqual(rt.body.ranges['America/Los_Angeles'], JSON.parse(JSON.stringify(reportRange('week', new Date(), 'America/Los_Angeles'))));
  assert.equal(rt.body.ledgers, 1); // 시간대가 둘이어도 가계부는 하나
  assert.ok(sent.some((x) => x.endpoint.endsWith('/s7')), 'LA 기기도 받음');
  db.push_subscriptions.splice(db.push_subscriptions.findIndex((x) => x.id === 's7'), 1);
  console.log('ok 6c. 리포트 기간은 기기 시간대(prefs.tz)별로');
}
assert.equal((await call({ type: 'REPORT', period: 'year' })).status, 400);
console.log('ok 7. 잘못된 period → 400');
assert.deepEqual(globalThis.__vapid, ['mailto:a@b.c', 'pub', 'priv']);
// 댓글: 쓴 사람 계정의 모든 기기 제외
sent.length = 0;
db.push_subscriptions.forEach((x) => { x.account_id = x.id === 's1' || x.id === 's2' ? 'acct-writer' : 'acct-other'; });
r = await call({ type: 'INSERT', table: 'tx_comments', record: { id: 'c1', user_id: L, tx_id: 't1', author: 'acct-writer', author_name: '준호', body: '이거 뭐야?' } });
assert.equal(r.status, 200);
assert.ok(sent.every((x) => !['https://fcm.googleapis.com/fcm/send/s1', 'https://fcm.googleapis.com/fcm/send/s2'].includes(x.endpoint)), JSON.stringify(sent.map((x) => x.endpoint)));
assert.ok(sent.length >= 1);
assert.equal(sent[0].msg.title, '준호님이 댓글을 남겼어요');
assert.equal(sent[0].msg.url, '/?tx=t1');
console.log('ok 8. 댓글: 쓴 사람 계정의 기기 모두 제외 →', JSON.stringify(r.body));
// 댓글 쓴 사람 이름은 계정 기준: 다른 이름을 보내도 그 계정의 "사람" 이름으로, 사람 연결이 없으면 "참여자", 주인은 보낸 이름
for (const [author, sentName, want] of [['acct-writer', '민지', '준호'], ['acct-noperson', '민지', '참여자'], [L, '엄마', '엄마'], ['acct-stranger', '민지', '참여자']]) {
  sent.length = 0;
  await call({ type: 'INSERT', table: 'tx_comments', record: { id: `c-${author}`, user_id: L, tx_id: 't1', author, author_name: sentName, body: '확인' } });
  assert.ok(sent.length >= 1);
  assert.equal(sent[0].msg.title, `${want}님이 댓글을 남겼어요`, author);
}
console.log('ok 8-1. 댓글 이름 바꿔치기 막음 (계정에 연결된 사람 이름 사용)');
// 실제 푸시 서비스가 아닌 주소: 보내지 않고 지움 (012 이전에 저장됐거나 조작된 값)
sent.length = 0;
for (const [id, endpoint] of [['evil1', 'https://attacker.example/collect'], ['evil2', 'https://fcm.googleapis.com.evil.io/x'], ['evil3', 'http://fcm.googleapis.com/fcm/send/x'], ['evil4', 'https://169.254.169.254/latest']]) {
  db.push_subscriptions.push({ ...sub(id, L, 'dev-' + id), endpoint, account_id: 'acct-other' });
}
db.push_subscriptions.push({ ...sub('apple1', L, 'dev-apple'), endpoint: 'https://web.push.apple.com/QGuQ', account_id: 'acct-other' });
r = await call({ type: 'INSERT', table: 'transactions', record: { ...rec, id: 't9' } });
assert.equal(r.status, 200);
assert.ok(sent.every((x) => !/attacker|evil|169\.254|^http:/.test(x.endpoint)), JSON.stringify(sent.map((x) => x.endpoint)));
assert.ok(sent.some((x) => x.endpoint.startsWith('https://web.push.apple.com/')));
assert.ok(!db.push_subscriptions.some((x) => x.id.startsWith('evil')));
assert.equal(r.body.removed, 4);
console.log('ok 9. 푸시 서비스가 아닌 주소는 보내지 않고 삭제 →', JSON.stringify(r.body));
console.log('edge function tests: all passed');
