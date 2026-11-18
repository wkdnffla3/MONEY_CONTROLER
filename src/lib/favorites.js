// 즐겨찾기를 사람별로 나누기 (즐겨찾기의 "누가" 칸 기준)
import { findMember, memberColor, SHARED_LABEL } from './members.js';

export const FAV_SHARED = 'shared';

/**
 * [{ key, label, color, items }] — 이 기기를 쓰는 사람(meId) 먼저, 그다음 사람 목록 순서, 마지막에 공동.
 * 사람을 정하지 않았거나 지워진 사람이면 공동. 빈 묶음은 뺌. 묶음 안 순서는 즐겨찾기 순서 그대로.
 */
export function groupFavorites(favorites, members = [], meId = null) {
  const keyOf = (f) => (findMember(members, f.memberId) ? f.memberId : FAV_SHARED);
  const order = [...(findMember(members, meId) ? [meId] : []), ...members.map((m) => m.id).filter((id) => id !== meId), FAV_SHARED];
  return order
    .map((key) => {
      const m = key === FAV_SHARED ? null : findMember(members, key);
      return { key, label: m ? m.name : SHARED_LABEL, color: memberColor(m), isMe: !!m && key === meId, items: favorites.filter((f) => keyOf(f) === key) };
    })
    .filter((g) => g.items.length > 0);
}

/** 같은 사람 묶음 안에서 한 칸 위(-1)/아래(+1)로. 전체 배열의 다른 사람 즐겨찾기 위치는 그대로 */
export function moveInGroup(favorites, id, dir, members = []) {
  const keyOf = (f) => (findMember(members, f.memberId) ? f.memberId : FAV_SHARED);
  const i = favorites.findIndex((f) => f.id === id);
  if (i < 0) return favorites;
  const k = keyOf(favorites[i]);
  let j = i + dir;
  while (j >= 0 && j < favorites.length && keyOf(favorites[j]) !== k) j += dir;
  if (j < 0 || j >= favorites.length) return favorites;
  const next = [...favorites];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

const VIEW_KEY = 'ledger.favView';
/** 즐겨찾기 줄 보기 설정 (기기마다): { tab: 'all' | 사람키, open: 펼침 여부 } */
export function loadFavView() {
  try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); return { tab: typeof v.tab === 'string' ? v.tab : 'all', open: !!v.open }; } catch { return { tab: 'all', open: false }; }
}
export function saveFavView(v) {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* 저장 못 해도 동작에는 문제없음 */ }
}
