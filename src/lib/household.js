// 가계부 공유 (각자 계정으로 같은 가계부) — supabase/008_sharing_favorites.sql 의 함수 호출
import { supabase } from './supabase';

const key = (uid) => `ledger.household.${uid}`;

/** 008 전이라 함수가 없는지 */
export const isMissingFn = (e) => {
  const code = String(e?.code || '');
  return code === 'PGRST202' || code === '42883' || /could not find the function|function .* does not exist/i.test(String(e?.message || ''));
};

const CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;
/** 입력한 코드 정리: 공백·하이픈 제거, 대문자. 링크(?join=)를 붙여넣어도 코드만 꺼냄 */
export function normalizeCode(input) {
  const s = String(input || '');
  const m = s.match(/[?&]join=([A-Za-z0-9-]+)/);
  const c = (m ? m[1] : s).replace(/[\s-]/g, '').toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

/** 기기에 기억한 마지막 공유 상태 (오프라인에서도 같은 가계부를 보이게) */
export function readHousehold(uid) {
  try {
    const v = JSON.parse(localStorage.getItem(key(uid)) || 'null');
    if (v && typeof v.ledgerId === 'string' && /^[0-9a-f-]{36}$/i.test(v.ledgerId)) return v;
  } catch { /* 없음 */ }
  return null;
}
export function writeHousehold(uid, h) {
  try { if (h) localStorage.setItem(key(uid), JSON.stringify(h)); else localStorage.removeItem(key(uid)); } catch { /* 무시 */ }
}

const fromServer = (uid, d) => ({
  ledgerId: d.ledger_id,
  isOwner: d.ledger_id === uid,
  personId: d.person_id ?? null,
  people: Array.isArray(d.people) ? d.people.map((p) => ({
    userId: p.user_id, email: p.email || '', owner: !!p.owner, personId: p.person_id ?? null,
  })) : [],
  supported: true,
});

/** 서버에서 지금 공유 상태 받기. 008 전이면 내 가계부 하나로 */
export async function fetchHousehold(uid) {
  const { data, error } = await supabase.rpc('my_ledger');
  if (error) {
    if (isMissingFn(error)) return { ledgerId: uid, isOwner: true, personId: null, people: [], supported: false };
    throw error;
  }
  return fromServer(uid, data);
}

const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
};
export const createInvite = () => rpc('create_invite');
export const peekInvite = (code) => rpc('peek_invite', { p_code: code });
export const joinLedger = (code, personId, name) => rpc('join_ledger', { p_code: code, p_person: personId || null, p_name: name || null });
export const removeMember = (userId) => rpc('remove_member', { p_user: userId });
export const leaveLedger = () => rpc('leave_ledger');

const MESSAGES = {
  invalid_code: '없는 초대 코드예요. 다시 확인해 주세요.',
  expired: '초대 코드가 만료됐어요 (48시간). 새 코드를 받아 주세요.',
  used: '이미 사용된 초대 코드예요. 코드는 한 번만 쓸 수 있어요.',
  own_ledger: '내가 만든 초대 코드예요. 함께 쓸 사람에게 보내 주세요.',
  already_joined: '이미 다른 가계부에 참여 중이에요. 먼저 나간 뒤 참여해 주세요.',
  has_members: '다른 사람이 내 가계부에 참여 중이라 다른 가계부에 참여할 수 없어요. 먼저 참여자를 내보내 주세요.',
  full: '한 가계부에는 10명까지 함께 쓸 수 있어요.',
  not_member: '이 가계부의 참여자가 아니에요. 새로고침해 주세요.',
  not_signed_in: '다시 로그인해 주세요.',
};
/** 서버 오류 → 한국어 안내 (모르는 오류면 null) */
export function shareErrorText(e) {
  if (isMissingFn(e)) return 'DB 업데이트(supabase/008_sharing_favorites.sql)가 필요해요.';
  const m = String(e?.message || '');
  const hit = Object.keys(MESSAGES).find((k) => m === k || m.includes(k));
  return hit ? MESSAGES[hit] : null;
}
