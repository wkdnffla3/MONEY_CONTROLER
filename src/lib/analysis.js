/**
 * 분석·검색·달력 계산 (화면과 분리된 순수 함수)
 */
import { daysInMonth, pad, prevMonth, ymKey } from './format.js';

const sumBy = (list, type) => list.reduce((a, t) => a + (t.type === type ? Number(t.amount) || 0 : 0), 0);
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

// ---------------- 지난달 대비 ----------------
/**
 * 이번 달(ym)과 지난달 지출 비교.
 * 보고 있는 달이 진행 중이면(today가 그 달) 공정하게 "같은 날짜까지"끼리 비교함.
 * 반환: { curTotal, prevTotal, diff, pct, partial, cutoffDay, up:[...], down:[...] }
 *   up/down 항목: { name, cur, prev, diff, pct }  (금액 변화가 큰 순, 최대 3개)
 */
export function compareMonths(allTx, ym, today = new Date()) {
  const p = prevMonth(ym);
  const isCurrent = today.getFullYear() === ym.y && today.getMonth() + 1 === ym.m;
  const cutoffCur = isCurrent ? today.getDate() : daysInMonth(ym.y, ym.m);
  const cutoffPrev = isCurrent ? Math.min(today.getDate(), daysInMonth(p.y, p.m)) : daysInMonth(p.y, p.m);
  const kCur = ymKey(ym.y, ym.m), kPrev = ymKey(p.y, p.m);
  const day = (t) => Number(t.date.slice(8, 10));
  const cur = allTx.filter((t) => t.type !== 'income' && t.date?.startsWith(kCur) && day(t) <= cutoffCur);
  const prev = allTx.filter((t) => t.type !== 'income' && t.date?.startsWith(kPrev) && day(t) <= cutoffPrev);

  const byCat = new Map();
  for (const [list, key] of [[cur, 'cur'], [prev, 'prev']]) {
    for (const t of list) {
      if (!byCat.has(t.category)) byCat.set(t.category, { name: t.category, cur: 0, prev: 0 });
      byCat.get(t.category)[key] += Number(t.amount) || 0;
    }
  }
  const cats = [...byCat.values()].map((c) => ({ ...c, diff: c.cur - c.prev, pct: pct(c.cur, c.prev) }));
  const curTotal = cats.reduce((a, c) => a + c.cur, 0);
  const prevTotal = cats.reduce((a, c) => a + c.prev, 0);
  return {
    curTotal, prevTotal, diff: curTotal - prevTotal, pct: pct(curTotal, prevTotal),
    partial: isCurrent, cutoffDay: cutoffCur,
    up: cats.filter((c) => c.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 3),
    down: cats.filter((c) => c.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 3),
  };
}

// ---------------- 연간 리포트 ----------------
/**
 * 1년 요약. options: { members, cards } (이름 표시용)
 * 반환: { year, months[12]:{m,inc,exp}, inc, exp, net, rate, prev:{inc,exp}, incPct, expPct,
 *         maxMonth, categories:[{name, amount, share}], top:[내역 5개], byMember, byTag, byCard, count }
 */
export function yearReport(allTx, year, { members = [], cards = [] } = {}) {
  const inYear = allTx.filter((t) => typeof t.date === 'string' && t.date.startsWith(`${year}-`));
  const prevYear = allTx.filter((t) => typeof t.date === 'string' && t.date.startsWith(`${year - 1}-`));
  const months = Array.from({ length: 12 }, (_, i) => {
    const k = `${year}-${pad(i + 1)}`;
    const list = inYear.filter((t) => t.date.startsWith(k));
    return { m: i + 1, inc: sumBy(list, 'income'), exp: sumBy(list, 'expense') };
  });
  const inc = sumBy(inYear, 'income'), exp = sumBy(inYear, 'expense');
  const prev = { inc: sumBy(prevYear, 'income'), exp: sumBy(prevYear, 'expense') };
  const expenses = inYear.filter((t) => t.type !== 'income');

  const group = (keyOf, nameOf) => {
    const m = new Map();
    for (const t of expenses) {
      for (const k of keyOf(t)) {
        if (!m.has(k)) m.set(k, { key: k, name: nameOf(k), amount: 0, count: 0 });
        const g = m.get(k); g.amount += t.amount; g.count += 1;
      }
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount).map((g) => ({ ...g, share: exp ? g.amount / exp : 0 }));
  };
  const memberName = (id) => members.find((x) => x.id === id)?.name || '공동';
  const cardName = (id) => (id === 'cash' ? '현금·기타' : cards.find((x) => x.id === id)?.name || '삭제된 카드');

  const withData = months.filter((x) => x.exp > 0);
  return {
    year, months, inc, exp, net: inc - exp, rate: inc > 0 ? Math.round(((inc - exp) / inc) * 100) : null,
    prev, incPct: pct(inc, prev.inc), expPct: pct(exp, prev.exp),
    maxMonth: withData.length ? withData.reduce((a, b) => (b.exp > a.exp ? b : a)) : null,
    categories: group((t) => [t.category], (k) => k),
    top: [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 5),
    byMember: members.length ? group((t) => [members.some((x) => x.id === t.memberId) ? t.memberId : 'shared'], memberName) : [],
    byTag: group((t) => t.tags || [], (k) => k),
    byCard: cards.length ? group((t) => [t.cardId && cards.some((c) => c.id === t.cardId) ? t.cardId : 'cash'], cardName) : [],
    count: inYear.length,
  };
}

// ---------------- 고급 검색 ----------------
/**
 * filters: { from:'YYYY-MM-DD'|'', to, type:'all'|'expense'|'income', categories:[], who:'all'|'shared'|id,
 *            tags:[] (모두 포함), card:'all'|'cash'|id, min, max (0/빈값=제한 없음), q:'키워드' }
 * 반환: { list (최신순), count, inc, exp }
 */
export function searchTx(allTx, f, members = []) {
  const q = (f.q || '').trim().toLowerCase();
  const isMember = (id) => members.some((m) => m.id === id);
  const list = allTx.filter((t) => {
    if (typeof t.date !== 'string') return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.type && f.type !== 'all' && t.type !== f.type) return false;
    if (f.categories?.length && !f.categories.includes(t.category)) return false;
    if (f.who && f.who !== 'all') {
      const owner = isMember(t.memberId) ? t.memberId : 'shared';
      if (owner !== f.who) return false;
    }
    if (f.tags?.length && !f.tags.every((tag) => (t.tags || []).includes(tag))) return false;
    if (f.card && f.card !== 'all') {
      if (f.card === 'cash' ? !!t.cardId : t.cardId !== f.card) return false;
    }
    if (f.min && t.amount < f.min) return false;
    if (f.max && t.amount > f.max) return false;
    if (q) {
      const hay = `${t.memo || ''} ${t.category} ${(t.tags || []).join(' ')} ${members.find((m) => m.id === t.memberId)?.name || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
  return { list, count: list.length, inc: sumBy(list, 'income'), exp: sumBy(list, 'expense') };
}

/** 지금까지 쓴 태그 (많이 쓴 순) */
export function allTags(allTx) {
  const m = new Map();
  for (const t of allTx) for (const tag of t.tags || []) m.set(tag, (m.get(tag) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

// ---------------- 달력 ----------------
/** 그 달의 달력 칸: 주 단위 배열, 빈칸은 null. 칸 { day, date, exp, inc, count } */
export function calendarMonth(list, ym) {
  const days = daysInMonth(ym.y, ym.m);
  const firstWd = new Date(ym.y, ym.m - 1, 1).getDay();
  const cells = Array.from({ length: days }, (_, i) => ({ day: i + 1, date: `${ymKey(ym.y, ym.m)}-${pad(i + 1)}`, exp: 0, inc: 0, count: 0 }));
  for (const t of list) {
    const d = Number(t.date?.slice(8, 10));
    if (!t.date?.startsWith(ymKey(ym.y, ym.m)) || !cells[d - 1]) continue;
    const c = cells[d - 1];
    if (t.type === 'income') c.inc += t.amount; else c.exp += t.amount;
    c.count += 1;
  }
  const grid = [...Array(firstWd).fill(null), ...cells];
  while (grid.length % 7) grid.push(null);
  const weeks = [];
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7));
  return { weeks, maxExp: Math.max(0, ...cells.map((c) => c.exp)) };
}

// ---------------- 지난 구매가 (장보기) ----------------
export const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '');

/** 구매 완료 물품에서 이름별 가장 최근 단가 { 정규화이름: { unit, date, name } } */
export function lastPrices(items) {
  const out = {};
  for (const i of items) {
    if (i.status !== 'bought' || !i.paid) continue;
    const key = normalizeName(i.name);
    const unit = Math.round(i.paid / (i.qty || 1));
    const date = i.boughtAt || '';
    if (!out[key] || date > out[key].date || (date === out[key].date && (i.createdAt || 0) > (out[key].createdAt || 0))) {
      out[key] = { unit, date, name: i.name, createdAt: i.createdAt || 0 };
    }
  }
  return out;
}
