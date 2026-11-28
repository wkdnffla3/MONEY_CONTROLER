// 카드 결제 문자·알림 글 → 내역 입력값 (기기 안에서만 읽음, 서버로 보내지 않음)
// 카드사마다 문구가 달라서 "금액·날짜·가맹점·카드·할부"를 따로따로 찾음. 못 찾은 칸은 비워 둠(사람이 채움)
//   예) [Web발신] 신한카드(1234)승인 홍*동 12,000원(일시불)11/27 14:23 스타벅스 누적123,456원
//       삼성1234승인 홍*동 / 12,000원 일시불 / 11/27 14:23 스타벅스 / 누적123,456원
//       KB국민카드1234승인 / 홍*동님 / 45,000원 03개월 / 11/27 09:10 / 쿠팡 / 누적...

import { pad } from './format.js';

export const MAX_PAY_TEXT = 2000;

// 금액 앞에 이 말이 붙으면 결제 금액이 아님 (누적 사용액, 잔액, 한도 등)
const NOT_AMOUNT = /(누적|잔액|한도|남은|가용|포인트|적립|사용가능|이용가능|합계|총)\s*[:：]?\s*$/;
const CARD_RE = /(KB\s?국민|국민|신한|삼성|현대|롯데|우리|하나|비씨|BC|NH\s?농협|농협|씨티|IBK|기업|카카오뱅크|카카오페이|케이뱅크|토스뱅크|토스|네이버페이|수협|광주|전북|제주|SC제일|우체국|새마을)/i;
// 가맹점 줄로 보지 않을 말
const NOT_MERCHANT = /(Web발신|국외발신|국제발신|승인|누적|잔액|한도|일시불|개월|님\b|님$|원$|카드|\d{1,2}[/.-]\d{1,2}|^\(?\d+\)?$|체크|결제\s*완료|결제\s*알림)/;

const cleanLine = (s) => s.replace(/\[[^\]]*발신\]/g, '').replace(/\s+/g, ' ').trim();

/** 승인 문자 안의 결제 금액 (누적·잔액 금액은 건너뜀). 없으면 0 */
function findAmount(text) {
  for (const m of text.matchAll(/([\d,]{1,16})\s*원/g)) {
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    if (NOT_AMOUNT.test(before)) continue;
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return 0;
}

/** 문자 속 날짜 → YYYY-MM-DD. 연도가 없으면 오늘 기준(오늘보다 한참 뒤의 날짜면 작년) */
function findDate(text, today) {
  const full = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (full) return check(Number(full[1]), Number(full[2]), Number(full[3]));
  const md = text.match(/(?:^|[^\d])(\d{1,2})[/.-](\d{1,2})(?=\s|\(|$|[^\d/.-])/m) || text.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (!md) return null;
  const m = Number(md[1]), d = Number(md[2]);
  let y = today.getFullYear();
  // 12월 문자를 1월에 읽는 경우 등: 오늘보다 31일 넘게 미래면 작년
  if (new Date(y, m - 1, d) - today > 31 * 86400000) y -= 1;
  return check(y, m, d);
}
function check(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return null;
  const last = new Date(y, m, 0).getDate();
  return d <= last ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** 할부 개월 (일시불·없으면 1) */
function findInst(text) {
  const m = text.match(/(\d{1,2})\s*개월/);
  const n = m ? Number(m[1]) : 1;
  return n >= 2 && n <= 36 ? n : 1;
}

/** 가맹점: 시각(14:23) 뒤의 글자, 없으면 금액·날짜·승인·누적이 아닌 줄 중 첫 번째 */
function findMerchant(text) {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  for (const line of lines) {
    const after = line.match(/\d{1,2}:\d{2}\s+(.+)$/);
    if (after) {
      const s = after[1].replace(/\s*(누적|잔액).*$/, '').trim();
      if (s && !/^[\d,]+\s*원/.test(s)) return s;
    }
  }
  for (const line of lines) {
    if (!NOT_MERCHANT.test(line) && /[가-힣A-Za-z]/.test(line) && line.length <= 40) return line;
  }
  return '';
}

/**
 * 결제 문자 읽기 → { ok, amount, date, inst, merchant, cardHint, cancel }
 *  ok: 금액을 찾았는지. cancel: 승인 취소 문자인지 (지출로 넣으면 안 됨)
 */
export function parsePayText(raw, today = new Date()) {
  const text = String(raw ?? '').slice(0, MAX_PAY_TEXT);
  const amount = findAmount(text);
  const card = text.match(CARD_RE);
  return {
    ok: amount > 0,
    amount,
    date: findDate(text, today),
    inst: findInst(text),
    merchant: findMerchant(text).slice(0, 40),
    cardHint: card ? card[1].replace(/\s/g, '') : '',
    cancel: /(승인\s*취소|취소\s*승인|결제\s*취소|취소되었|취소\s*완료)/.test(text),
  };
}

/** 문자 속 카드 이름 → 등록한 카드 (이름에 서로 포함되면 같은 카드로 봄). 없으면 null */
export function matchCard(cards, hint) {
  if (!hint || !Array.isArray(cards)) return null;
  const h = hint.replace(/\s/g, '').toLowerCase().replace(/^kb/, '');
  const hit = cards.find((c) => {
    const n = String(c.name || '').replace(/\s/g, '').toLowerCase().replace(/^kb/, '');
    return n && (n.includes(h) || h.includes(n));
  });
  return hit ? hit.id : null;
}

/** 지난 내역에서 같은 메모(가맹점)로 가장 최근에 쓴 지출 카테고리 → { 메모: 카테고리 } */
export function categoryByMemo(txList) {
  const out = {};
  const seen = {};
  for (const t of txList || []) {
    if (t.type === 'income' || !t.memo) continue;
    const k = t.memo.trim().toLowerCase();
    const at = `${t.date || ''}|${String(t.createdAt || 0).padStart(15, '0')}`;
    if (!seen[k] || at > seen[k]) { seen[k] = at; out[k] = t.category; }
  }
  return out;
}
