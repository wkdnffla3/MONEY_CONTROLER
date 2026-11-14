// 알림 문구·방해 금지 시간·VAPID 키 생성 단위 테스트:  node tests/notify.test.mjs
import assert from 'node:assert/strict';
import { createECDH, createSign, createPublicKey, createVerify } from 'node:crypto';
import {
  buildNotification, inQuietHours, normalizePrefs, shouldSend, whoText, DEFAULT_PREFS,
} from '../supabase/functions/_shared/notifyMessage.js';
import { generateVapidKeys } from '../scripts/gen-vapid.mjs';

const members = [{ id: 'm1', name: '민지', color: 0 }, { id: 'm2', name: '준호', color: 1 }];
const tx = (o) => ({ id: 'abc', user_id: 'u', type: 'expense', amount: 12000, category: '식비', memo: '점심', member_id: 'm1', ...o });

// 1. 내역 추가
let n = buildNotification({ table: 'transactions', record: tx(), members });
assert.equal(n.kind, 'tx');
assert.equal(n.title, '민지님이 지출을 추가했어요');
assert.equal(n.body, '식비 12,000원 · 점심');
assert.equal(n.url, '/');
assert.equal(n.tag, 'tx-abc');
n = buildNotification({ table: 'transactions', record: tx({ type: 'income', member_id: null, memo: '', amount: 3000000, category: '월급' }), members });
assert.equal(n.title, '다른 기기에서 수입을 추가했어요');
assert.equal(n.body, '월급 3,000,000원');
// 삭제된 사람 id → 다른 기기
assert.equal(whoText(members, 'gone'), '다른 기기에서');

// 2. 반복 내역·수정·삭제는 알리지 않음
assert.equal(buildNotification({ table: 'transactions', record: tx({ id: 'rec-r1-2026-11' }), members }), null);
assert.equal(buildNotification({ table: 'transactions', type: 'UPDATE', record: tx(), members }), null);
assert.equal(buildNotification({ table: 'transactions', type: 'DELETE', record: tx(), members }), null);
assert.equal(buildNotification({ table: 'settings', record: { id: 'x' } }), null);
assert.equal(buildNotification({ table: 'transactions', record: null }), null);
assert.equal(buildNotification({ table: 'transactions', record: { id: 5 } }), null);

// 3. 장보기 결제 확정 (shop- 내역)
n = buildNotification({ table: 'transactions', record: tx({ id: 'shop-p1', member_id: 'm2', memo: '장보기 · 우유 외 2개', amount: 15800 }), members });
assert.equal(n.kind, 'purchase');
assert.equal(n.title, '준호님이 장보기 결제를 확정했어요');
assert.equal(n.url, '/#shopping');

// 4. 장보기 물품 추가 / 구매완료 줄은 무시
n = buildNotification({ table: 'shopping_items', record: { id: 'i1', name: '우유', qty: 2, price: 2400, status: 'todo', member_id: 'm1' }, members });
assert.equal(n.kind, 'shop');
assert.equal(n.title, '민지님이 장보기에 추가했어요');
assert.equal(n.body, '우유 ×2 · 약 4,800원');
n = buildNotification({ table: 'shopping_items', record: { id: 'i2', name: '두부', qty: 1, price: 0, status: 'todo' }, members });
assert.equal(n.body, '두부');
assert.equal(buildNotification({ table: 'shopping_items', record: { id: 'i3', name: 'x', status: 'bought' } }), null);

// 5. 긴 메모·이름 자르기, 줄바꿈 정리
n = buildNotification({ table: 'transactions', record: tx({ memo: `가${'나'.repeat(80)}\n줄` }), members });
assert.ok(n.body.length < 70 && n.body.endsWith('…'));

// 6. 설정 정리
const p = normalizePrefs({ tx: false, quiet: true, quietStart: '25:00', quietEnd: '06:30', tz: 'Mars/Base', inapp: 'yes' });
assert.equal(p.tx, false); assert.equal(p.quiet, true);
assert.equal(p.quietStart, DEFAULT_PREFS.quietStart); assert.equal(p.quietEnd, '06:30');
assert.equal(p.tz, 'Asia/Seoul'); assert.equal(p.inapp, true);
assert.deepEqual(normalizePrefs(null), { ...DEFAULT_PREFS });

// 7. 방해 금지 시간 (서울 기준, 자정 넘김)
const at = (h, m = 0) => new Date(Date.UTC(2026, 10, 14, h - 9, m)); // KST h:m
const q = { quiet: true, quietStart: '23:00', quietEnd: '07:00', tz: 'Asia/Seoul' };
assert.equal(inQuietHours(q, at(23, 30)), true);
assert.equal(inQuietHours(q, at(3)), true);
assert.equal(inQuietHours(q, at(7)), false);
assert.equal(inQuietHours(q, at(12)), false);
assert.equal(inQuietHours({ ...q, quietStart: '13:00', quietEnd: '14:00' }, at(13, 30)), true);
assert.equal(inQuietHours({ ...q, quiet: false }, at(3)), false);
// 시간대: 서울 낮 12시 = 뉴욕 밤 10시(방해 금지 전), 서울 13:30 = 뉴욕 23:30(방해 금지)
assert.equal(inQuietHours({ ...q, tz: 'America/New_York' }, at(12)), false);
assert.equal(inQuietHours({ ...q, tz: 'America/New_York' }, at(13, 30)), true);

// 8. 보낼지 결정
assert.equal(shouldSend('tx', {}, at(12)), true);
assert.equal(shouldSend('tx', { tx: false }, at(12)), false);
assert.equal(shouldSend('shop', { tx: false }, at(12)), true);
assert.equal(shouldSend('tx', q, at(2)), false);
assert.equal(shouldSend('weird', {}, at(12)), false);

// 9. VAPID 키: 공개키 65바이트(0x04로 시작), 비밀키 32바이트, 실제로 한 쌍이라 서명·검증이 됨
for (let i = 0; i < 30; i += 1) {
  const { publicKey, privateKey } = generateVapidKeys();
  const pub = Buffer.from(publicKey, 'base64url'), priv = Buffer.from(privateKey, 'base64url');
  assert.equal(pub.length, 65); assert.equal(pub[0], 4); assert.equal(priv.length, 32);
  assert.match(publicKey, /^[A-Za-z0-9_-]+$/);
  const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(priv);
  assert.ok(ecdh.getPublicKey().equals(pub));
}
// JWK 로 만들어 ES256 서명 검증 (web-push 가 하는 일과 같음)
{
  const { publicKey, privateKey } = generateVapidKeys();
  const pub = Buffer.from(publicKey, 'base64url');
  const jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url'), d: privateKey };
  const sig = createSign('SHA256').update('hello').sign({ key: jwk, format: 'jwk' });
  const { d, ...pubJwk } = jwk;
  assert.ok(createVerify('SHA256').update('hello').verify(createPublicKey({ key: pubJwk, format: 'jwk' }), sig));
}



// 10. 리포트 기간 (서울 기준)
{
  const { reportRange, buildReport } = await import('../supabase/functions/_shared/notifyMessage.js');
  // 2026-11-16(월) 오전 9시 KST = 00:00 UTC
  const mon = new Date(Date.UTC(2026, 10, 16, 0, 0));
  assert.deepEqual(reportRange('week', mon), { cur: { start: '2026-11-09', end: '2026-11-15' }, prev: { start: '2026-11-02', end: '2026-11-08' } });
  // 일요일 밤 11시 KST 에 돌려도 "지난주"는 그 전 주
  assert.equal(reportRange('week', new Date(Date.UTC(2026, 10, 15, 14, 0))).cur.start, '2026-11-02');
  // UTC로는 아직 일요일(15일 23:30)이지만 서울은 월요일 08:30 → 지난주 = 9~15일
  assert.equal(reportRange('week', new Date(Date.UTC(2026, 10, 15, 23, 30))).cur.start, '2026-11-09');
  const dec1 = new Date(Date.UTC(2026, 11, 1, 0, 0));
  assert.deepEqual(reportRange('month', dec1), { cur: { start: '2026-11-01', end: '2026-11-30', month: 11 }, prev: { start: '2026-10-01', end: '2026-10-31' } });
  const jan1 = new Date(Date.UTC(2027, 0, 1, 0, 0));
  assert.deepEqual(reportRange('month', jan1).cur, { start: '2026-12-01', end: '2026-12-31', month: 12 });
  assert.equal(reportRange('month', new Date(Date.UTC(2028, 2, 1, 0, 0))).cur.end, '2028-02-29'); // 윤년
  assert.throws(() => reportRange('day', mon));

  // 11. 리포트 문구
  const r = reportRange('week', mon);
  const txs = [
    { type: 'expense', amount: 120000, category: '식비', date: '2026-11-10' },
    { type: 'expense', amount: 80000, category: '교통', date: '2026-11-15' },
    { type: 'income', amount: 50000, category: '용돈', date: '2026-11-12' },
    { type: 'expense', amount: 250000, category: '식비', date: '2026-11-03' }, // 그 전주
    { type: 'expense', amount: 999999, category: '쇼핑', date: '2026-11-16' }, // 이번 주 → 제외
  ];
  let w = buildReport({ period: 'week', range: r, txs });
  assert.equal(w.kind, 'weekly');
  assert.equal(w.title, '지난주 지출 200,000원');
  assert.equal(w.body, '그 전주보다 20% 줄었어요 · 가장 많이 쓴 곳 식비 120,000원');
  assert.equal(w.tag, 'weekly-2026-11-09');
  assert.equal(buildReport({ period: 'week', range: r, txs: txs.slice(3) }), null); // 지난주 내역 없음 → 안 보냄
  w = buildReport({ period: 'week', range: r, txs: txs.slice(0, 2) }); // 비교 대상 없음
  assert.equal(w.body, '가장 많이 쓴 곳 식비 120,000원');
  const mr = reportRange('month', dec1);
  const m = buildReport({ period: 'month', range: mr, budget: 400000, txs: [
    { type: 'expense', amount: 300000, category: '식비', date: '2026-11-05' },
    { type: 'income', amount: 3000000, category: '월급', date: '2026-11-25' },
    { type: 'expense', amount: 300000, category: '식비', date: '2026-10-05' },
  ] });
  assert.equal(m.title, '11월 지출 300,000원');
  assert.equal(m.body, '그 전달과 비슷해요 · 수입 3,000,000원 · 예산의 75% · 가장 많이 쓴 곳 식비 300,000원');
  assert.equal(m.url, '/#report');
  assert.equal(shouldSend('weekly', { weekly: false }), false);
  assert.equal(shouldSend('monthly', {}), true);
  console.log('report unit tests: all passed');
}
console.log('notify unit tests: all passed');
