// 설정 충돌 자동 합치기 (017)
// 두 기기가 같은 설정 칸(즐겨찾기·카드·반복 내역·사람 목록·카테고리별 예산·숨긴 구독 제안)을 동시에 바꿨을 때,
// 서로 다른 항목(또는 같은 항목의 다른 칸)을 바꿨으면 둘 다 살려서 합침. 같은 칸을 서로 다르게 바꿨을 때만 충돌.
//   base   = 내가 바꾸기 전에 본 값
//   mine   = 내가 저장하려던 값
//   theirs = 지금 서버 값 (다른 기기가 바꾼 것)
// 결과: { ok: true, value } 또는 { ok: false } (사용자에게 물어봐야 함)

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 객체 하나를 칸별로 합침 (id 같은 항목) */
function mergeObject(base, mine, theirs) {
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(mine || {}), ...Object.keys(theirs || {})]);
  const out = {};
  for (const k of keys) {
    const b = base?.[k], m = mine?.[k], t = theirs?.[k];
    let v;
    if (same(m, b)) v = t;            // 나는 안 바꿈 → 서버 값
    else if (same(t, b) || same(t, m)) v = m; // 서버는 안 바꿈(또는 같게 바꿈) → 내 값
    else return null;                 // 둘 다 다르게 바꿈
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** id 가 있는 항목 목록 합치기 (순서: 서버 순서 기준, 내가 순서를 바꿨고 서버는 안 바꿨으면 내 순서) */
export function mergeList(base, mine, theirs) {
  if (!Array.isArray(base) || !Array.isArray(mine) || !Array.isArray(theirs)) return { ok: false };
  const idOf = (x) => x?.id;
  if (![...base, ...mine, ...theirs].every((x) => typeof idOf(x) === 'string')) return { ok: false };
  const B = new Map(base.map((x) => [x.id, x]));
  const M = new Map(mine.map((x) => [x.id, x]));
  const T = new Map(theirs.map((x) => [x.id, x]));
  const result = new Map();
  for (const id of new Set([...T.keys(), ...M.keys(), ...B.keys()])) {
    const b = B.get(id), m = M.get(id), t = T.get(id);
    if (!b) {                                   // 새로 생긴 항목
      if (m && t && !same(m, t)) return { ok: false }; // 같은 ID를 서로 다르게 추가 (거의 없음)
      result.set(id, m || t);
    } else if (!m && !t) {                      // 둘 다 지움
    } else if (!m) {                            // 내가 지움
      if (!same(t, b)) return { ok: false };    // 그사이 서버에서 고친 걸 지우려 함
    } else if (!t) {                            // 서버에서 지움
      if (!same(m, b)) return { ok: false };    // 서버에서 지운 걸 내가 고침
    } else {
      const v = mergeObject(b, m, t);
      if (!v) return { ok: false };
      result.set(id, v);
    }
  }
  // 순서
  const order = (list) => list.map(idOf).filter((id) => result.has(id));
  const bo = order(base), mo = order(mine), to = order(theirs);
  const iChangedOrder = !same(mo.filter((id) => B.has(id)), bo.filter((id) => M.has(id)));
  const theyChangedOrder = !same(to.filter((id) => B.has(id)), bo.filter((id) => T.has(id)));
  if (iChangedOrder && theyChangedOrder) return { ok: false };
  const primary = iChangedOrder ? mo : to;
  const rest = [...(iChangedOrder ? to : mo), ...result.keys()];
  const ids = [...new Set([...primary, ...rest])];
  return { ok: true, value: ids.map((id) => result.get(id)) };
}

/** 문자열 목록(집합) 합치기: 내가 넣은 것·뺀 것을 서버 값에 적용 */
export function mergeSet(base, mine, theirs) {
  if (![base, mine, theirs].every(Array.isArray)) return { ok: false };
  const added = mine.filter((x) => !base.includes(x));
  const removed = base.filter((x) => !mine.includes(x));
  const value = [...theirs.filter((x) => !removed.includes(x)), ...added.filter((x) => !theirs.includes(x))];
  return { ok: true, value };
}

/** 키-값 객체 합치기 (카테고리별 예산) */
export function mergeMap(base, mine, theirs) {
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (![base, mine, theirs].every(isObj)) return { ok: false };
  const v = mergeObject(base, mine, theirs);
  return v ? { ok: true, value: v } : { ok: false };
}

const BY_KIND = {
  favorites: mergeList, cards: mergeList, recurring: mergeList, members: mergeList,
  dismissedSubs: mergeSet, catBudgets: mergeMap,
};
export const canMerge = (kind) => !!BY_KIND[kind];

/** 설정 칸 충돌 합치기. 합칠 수 없는 칸(예산 금액, 카테고리 목록)이면 { ok: false } */
export function mergeSetting(kind, base, mine, theirs) {
  const f = BY_KIND[kind];
  if (!f || base === undefined) return { ok: false };
  if (same(mine, theirs)) return { ok: true, value: theirs };
  return f(base, mine, theirs);
}
