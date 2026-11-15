// 메모 속 링크 찾기 단위 테스트:  node tests/links.test.mjs
import assert from 'node:assert/strict';
import { extractLinks, hasLink } from '../../src/lib/links.js';
let l = extractLinks('영수증 https://example.com/r?id=1 확인');
assert.equal(l.length, 1); assert.equal(l[0].href, 'https://example.com/r?id=1'); assert.equal(l[0].label, 'example.com/r?id=1');
l = extractLinks('쿠팡(https://www.coupang.com/vp/1).');
assert.equal(l[0].href, 'https://www.coupang.com/vp/1'); assert.equal(l[0].label, 'coupang.com/vp/1');
assert.equal(extractLinks('javascript:alert(1) data:text/html,x ftp://a.com').length, 0);
assert.equal(extractLinks('http://a.com http://a.com https://b.kr').length, 2);
assert.ok(extractLinks('https://example.com/' + 'a'.repeat(100))[0].label.endsWith('…'));
assert.equal(extractLinks('https://한국.kr/가?x=1')[0].href.startsWith('https://xn--'), true);
assert.ok(hasLink('see HTTPS://X.COM')); assert.ok(!hasLink('그냥 메모'));
assert.equal(extractLinks(null).length, 0);
console.log('link tests: all passed');

// ===== 푸시 주소 허용 목록 (012) =====
import { isPushEndpoint } from '../../supabase/functions/_shared/notifyMessage.js';
for (const ok of [
  'https://fcm.googleapis.com/fcm/send/abc:APA91b',
  'https://android.googleapis.com/gcm/send/abc',
  'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
  'https://updates.push.services.mozilla.com:443/wpush/v1/x',
  'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
  'https://web.push.apple.com/QGuQyavXutnMH',
]) assert.equal(isPushEndpoint(ok), true, ok);
for (const bad of [
  'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.io/x', 'https://evilfcm.googleapis.com/x',
  'https://notify.windows.com/x', 'https://attacker.example/push.apple.com/x', 'https://169.254.169.254/latest',
  'https://fcm.googleapis.com', 'https://fcm.googleapis.com:8443/x', 'javascript:alert(1)', '', null, undefined, 42,
  'https://fcm.googleapis.com/' + 'a'.repeat(1100),
]) assert.equal(isPushEndpoint(bad), false, String(bad));
console.log('push endpoint allowlist ok');
