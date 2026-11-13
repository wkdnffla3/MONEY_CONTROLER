// 한 계정을 여러 명이 함께 쓸 때의 "사람" 관련 도우미
export const MAX_MEMBERS = 10;
export const MAX_NAME = 12;
export const SHARED = 'shared'; // 사람을 정하지 않은 내역 = 공동
export const SHARED_LABEL = '공동';

const COLOR_VARS = ['--c1', '--c3', '--c2', '--c4', '--c5', '--c6', '--c7', '--c8', '--c9', '--c10'];
export const COLOR_COUNT = COLOR_VARS.length;
export const colorVar = (i) => `var(${COLOR_VARS[((i % COLOR_COUNT) + COLOR_COUNT) % COLOR_COUNT]})`;
export const memberColor = (m) => (m ? colorVar(m.color) : 'var(--c11)');

export const findMember = (members, id) => (id ? members.find((m) => m.id === id) || null : null);

/** 내역의 담당 키: 등록된 사람이면 그 id, 아니면(비었거나 삭제된 사람) 공동 */
export const ownerKey = (members, t) => (findMember(members, t.memberId) ? t.memberId : SHARED);

/** 보기 필터 적용: 'all' | SHARED | 사람 id */
export function filterByOwner(list, members, who) {
  if (who === 'all') return list;
  return list.filter((t) => ownerKey(members, t) === who);
}

/**
 * 사람별 합계. 등록 순서대로, 마지막에 공동(내역이 있을 때만).
 * 반환: { rows: [{ key, name, color, exp, inc, count }], totalExp, totalInc }
 */
export function summarizeByMember(list, members) {
  const rows = members.map((m) => ({ key: m.id, name: m.name, color: memberColor(m), exp: 0, inc: 0, count: 0 }));
  const shared = { key: SHARED, name: SHARED_LABEL, color: memberColor(null), exp: 0, inc: 0, count: 0 };
  const byKey = new Map(rows.map((r) => [r.key, r]));
  let totalExp = 0, totalInc = 0;
  for (const t of list) {
    const row = byKey.get(ownerKey(members, t)) || shared;
    const a = Number(t.amount) || 0;
    if (t.type === 'income') { row.inc += a; totalInc += a; } else { row.exp += a; totalExp += a; }
    row.count += 1;
  }
  if (shared.count > 0) rows.push(shared);
  // 비율: 반올림 오차로 합이 99%·101%가 되지 않게, 버린 소수점이 큰 순서로 1%씩 보정 (최대 잔여 방식)
  const pcts = sharePercents(rows.map((r) => r.exp), totalExp);
  rows.forEach((r, i) => { r.pct = pcts[i]; });
  return { rows, totalExp, totalInc };
}

/** 정수 퍼센트 배열을 만들되 합이 정확히 100이 되게 함 (total이 0이면 모두 0) */
export function sharePercents(values, total) {
  if (!total) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; floors[i] += 1; left -= 1; }
  return floors;
}

// ---- 이 기기를 쓰는 사람 (기기마다 따로 기억, 입력할 때 자동 선택) ----
const meKey = (uid) => `ledger.me.${uid}`;
export const getMe = (uid) => { try { return localStorage.getItem(meKey(uid)) || null; } catch { return null; } };
export const setMe = (uid, id) => {
  try { if (id) localStorage.setItem(meKey(uid), id); else localStorage.removeItem(meKey(uid)); } catch { /* 무시 */ }
};
