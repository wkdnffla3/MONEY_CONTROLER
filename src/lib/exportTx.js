import { toCsv } from './csv.js';
import { isRecurringTxId } from './recurring.js';
import { isShoppingTxId } from './shopping.js';

/**
 * 내역 목록 → CSV 문자열 (내보내기·검색 결과 공통)
 * 사람·카드를 등록했을 때만 그 열을 넣음. 태그 열은 태그가 하나라도 있을 때만.
 */
export function buildTxCsv(rows, { members = [], cards = [] } = {}) {
  const hasTags = rows.some((t) => t.tags && t.tags.length);
  const header = [
    '날짜', '구분', '카테고리', '금액', '메모',
    ...(members.length ? ['누가'] : []),
    ...(hasTags ? ['태그'] : []),
    ...(cards.length ? ['결제수단', '할부'] : []),
    '출처',
  ];
  const body = rows.map((t) => [
    t.date,
    t.type === 'income' ? '수입' : '지출',
    t.category,
    t.amount,
    t.memo || '',
    ...(members.length ? [members.find((m) => m.id === t.memberId)?.name || '공동'] : []),
    ...(hasTags ? [(t.tags || []).map((x) => `#${x}`).join(' ')] : []),
    ...(cards.length ? [
      cards.find((c) => c.id === t.cardId)?.name || (t.type === 'income' ? '' : '현금·기타'),
      t.cardId && (t.inst || 1) > 1 ? `${t.inst}개월` : '',
    ] : []),
    isRecurringTxId(t.id) ? '반복' : isShoppingTxId(t.id) ? '장보기' : '',
  ]);
  return toCsv(header, body);
}
