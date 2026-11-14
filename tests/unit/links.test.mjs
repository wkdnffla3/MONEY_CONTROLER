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
