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

console.log('notify unit tests: all passed');
