// 카드 결제 문자 읽기 (lib/payText.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayText, matchCard, categoryByMemo } from '../../src/lib/payText.js';

const today = new Date(2026, 10, 28); // 2026-11-28

test('신한: 한 줄 문자', () => {
  const r = parsePayText('[Web발신]\n신한카드(1234)승인 홍*동 12,000원(일시불)11/27 14:23 스타벅스 누적123,456원', today);
  assert.deepEqual(r, { ok: true, amount: 12000, date: '2026-11-27', inst: 1, merchant: '스타벅스', cardHint: '신한', cancel: false });
});

test('삼성: 여러 줄, 누적 금액은 건너뜀', () => {
  const r = parsePayText('[Web발신]\n삼성1234승인 홍*동\n8,500원 일시불\n11/26 12:05 김밥천국 강남점\n누적1,234,000원', today);
  assert.equal(r.amount, 8500);
  assert.equal(r.date, '2026-11-26');
  assert.equal(r.merchant, '김밥천국 강남점');
  assert.equal(r.cardHint, '삼성');
});

test('KB국민: 할부, 가맹점이 따로 한 줄', () => {
  const r = parsePayText('KB국민카드1234승인\n홍*동님\n450,000원 03개월\n11/27 09:10\n쿠팡\n누적1,000,000원', today);
  assert.equal(r.amount, 450000);
  assert.equal(r.inst, 3);
  assert.equal(r.merchant, '쿠팡');
  assert.equal(r.cardHint, 'KB국민');
});

test('현대: 누적 앞 공백, 연도 있는 날짜', () => {
  const r = parsePayText('현대카드 M 승인\n홍*동\n33,000원 일시불\n2026.11.25 19:40 배달의민족\n누적 210,000원', today);
  assert.equal(r.amount, 33000);
  assert.equal(r.date, '2026-11-25');
  assert.equal(r.merchant, '배달의민족');
});

test('간편결제 알림 (날짜 없음 → null, 가맹점은 글자 줄)', () => {
  const r = parsePayText('결제 완료\n스마일카페\n4,800원', today);
  assert.equal(r.ok, true);
  assert.equal(r.amount, 4800);
  assert.equal(r.date, null);
  assert.equal(r.merchant, '스마일카페');
});

test('취소 문자 표시, 금액 없는 글은 ok=false', () => {
  assert.equal(parsePayText('신한카드(1234)승인취소 홍*동 12,000원 11/27 14:23 스타벅스', today).cancel, true);
  const none = parsePayText('오늘 날씨가 좋네요', today);
  assert.equal(none.ok, false);
  assert.equal(none.amount, 0);
  assert.equal(parsePayText(null, today).ok, false);
});

test('연말 문자를 연초에 읽으면 작년 날짜, 없는 날짜는 null', () => {
  assert.equal(parsePayText('삼성 승인 10,000원 12/31 23:50 편의점', new Date(2027, 0, 2)).date, '2026-12-31');
  assert.equal(parsePayText('삼성 승인 10,000원 02/30 10:00 편의점', today).date, null);
});

test('등록한 카드와 맞추기, 지난 내역으로 카테고리 추천', () => {
  const cards = [{ id: 'k1', name: '삼성 taptap' }, { id: 'k2', name: 'KB 국민' }, { id: 'k3', name: '신한' }];
  assert.equal(matchCard(cards, '삼성'), 'k1');
  assert.equal(matchCard(cards, 'KB국민'), 'k2');
  assert.equal(matchCard(cards, '신한'), 'k3');
  assert.equal(matchCard(cards, '롯데'), null);
  assert.equal(matchCard(cards, ''), null);
  const by = categoryByMemo([
    { type: 'expense', memo: '스타벅스', category: '식비', date: '2026-10-01', createdAt: 1 },
    { type: 'expense', memo: '스타벅스', category: '카페·간식', date: '2026-11-01', createdAt: 2 },
    { type: 'income', memo: '월급', category: '월급', date: '2026-11-01' },
  ]);
  assert.equal(by['스타벅스'], '카페·간식');
  assert.equal(by['월급'], undefined);
});
