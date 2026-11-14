// 변경 기록 읽기와 화면용 문장 만들기 (기록은 DB 트리거가 남김 — supabase/010_history_comments.sql)
import { supabase } from './supabase';
import { won } from './format';

export const PAGE = 40;
export async function fetchActivity(ledgerId, before) {
  let q = supabase.from('activity_log').select('id,actor,table_name,row_id,action,before,after,created_at').eq('user_id', ledgerId);
  if (before) q = q.lt('id', before);
  const { data, error } = await q.order('id', { ascending: false }).limit(PAGE);
  if (error) throw error;
  return data || [];
}

const TX_FIELDS = [
  ['amount', '금액', (v) => won(Number(v) || 0)],
  ['type', '구분', (v) => (v === 'income' ? '수입' : '지출')],
  ['category', '카테고리'],
  ['memo', '메모', (v) => v || '(없음)'],
  ['date', '날짜'],
  ['member_id', '누가'],
  ['tags', '태그', (v) => (Array.isArray(v) && v.length ? v.map((x) => `#${x}`).join(' ') : '(없음)')],
  ['card_id', '결제수단'],
  ['inst_months', '할부', (v) => (Number(v) > 1 ? `${v}개월` : '일시불')],
];
const ITEM_FIELDS = [['name', '이름'], ['qty', '수량'], ['price', '예상 단가', (v) => won(Number(v) || 0)], ['category', '카테고리'], ['memo', '메모', (v) => v || '(없음)']];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * 기록 한 줄 → 화면 문장. 장보기 "담기/빼기"처럼 사소한 바뀜은 null (목록에서 숨김)
 * ctx: { uid, people, members, cards, txExists(id), itemExists(id) }
 */
export function describe(e, ctx) {
  const who = whoName(e, ctx);
  const isTx = e.table_name === 'transactions';
  const row = e.after || e.before || {};
  const memberName = (id) => ctx.members.find((m) => m.id === id)?.name || (id ? '(삭제된 사람)' : '공동');
  const cardName = (id) => (id ? ctx.cards.find((c) => c.id === id)?.name || '(삭제된 카드)' : '현금·체크');
  const fmtField = (k, f, v) => (k === 'member_id' ? memberName(v) : k === 'card_id' ? cardName(v) : f ? f(v) : String(v ?? ''));

  if (isTx) {
    const kind = row.type === 'income' ? '수입' : '지출';
    const summary = `${row.category} ${won(Number(row.amount) || 0)}${row.memo ? ` · ${row.memo}` : ''}`;
    if (e.action === 'insert') {
      const auto = String(e.row_id).startsWith('rec-') ? ' (반복 자동)' : String(e.row_id).startsWith('shop-') ? ' (장보기 결제)' : '';
      return { who, verb: `${kind} 추가${auto}`, summary, date: row.date, diffs: [], restore: null };
    }
    if (e.action === 'delete') {
      return { who, verb: `${kind} 삭제`, summary, date: row.date, diffs: [], restore: ctx.txExists(e.row_id) ? null : 'restore' };
    }
    const diffs = TX_FIELDS.filter(([k]) => !same(e.before?.[k], e.after?.[k]))
      .map(([k, label, f]) => ({ label, from: fmtField(k, f, e.before?.[k]), to: fmtField(k, f, e.after?.[k]) }));
    if (!diffs.length) return null;
    return { who, verb: `${kind} 수정`, summary, date: row.date, diffs, restore: ctx.txExists(e.row_id) ? 'revert' : null };
  }

  // 장보기
  const name = `${row.name}${Number(row.qty) > 1 ? ` ×${row.qty}` : ''}`;
  if (e.action === 'insert') return { who, verb: '장보기 추가', summary: name, diffs: [], restore: null };
  if (e.action === 'delete') return { who, verb: '장보기 삭제', summary: name, diffs: [], restore: ctx.itemExists(e.row_id) ? null : 'restore' };
  if (e.before?.status !== e.after?.status) {
    return { who, verb: e.after?.status === 'bought' ? '구매 완료' : '다시 살 것으로', summary: name, diffs: [], restore: null };
  }
  const diffs = ITEM_FIELDS.filter(([k]) => !same(e.before?.[k], e.after?.[k]))
    .map(([k, label, f]) => ({ label, from: fmtField(k, f, e.before?.[k]), to: fmtField(k, f, e.after?.[k]) }));
  if (!diffs.length) return null; // 장바구니 담기·빼기 등
  return { who, verb: '장보기 수정', summary: name, diffs, restore: ctx.itemExists(e.row_id) ? 'revert' : null };
}

export function whoName(e, ctx) {
  if (!e.actor) return '자동';
  if (e.actor === ctx.uid) return '나';
  const p = ctx.people.find((x) => x.userId === e.actor);
  const person = p?.personId && ctx.members.find((m) => m.id === p.personId)?.name;
  if (person) return person;
  if (p?.email) return p.email.split('@')[0];
  return '다른 사람';
}
