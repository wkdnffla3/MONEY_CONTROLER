/**
 * 오프라인 보낼 목록(outbox)
 *
 * 중복 저장을 막는 원칙
 *  1) 내역 ID는 저장 버튼을 누를 때 기기에서 한 번 만들고, 다시 보낼 때도 같은 ID를 씀.
 *     서버에는 upsert(있으면 덮어쓰기)로 보내므로 몇 번을 다시 보내도 한 줄만 남음.
 *  2) 같은 내역에 대한 작업은 목록에서 하나로 합침 (마지막 수정만, 추가 후 삭제면 삭제만).
 *  3) 삭제·예산 저장도 여러 번 실행해도 결과가 같은 작업이라 재전송해도 안전함.
 *
 * 작업(op) 형태
 *  { opId, kind: 'upsert', id, data }   내역 추가·수정
 *  { opId, kind: 'delete', id }         내역 삭제
 *  { opId, kind: 'budget', value }      월 예산
 */

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() ??
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// ---------- 값 검사 ----------
// 기기 저장소는 손상되거나 조작될 수 있으므로, 읽을 때마다 형식을 확인하고 이상한 항목은 버림
export const MAX_AMOUNT = 9_999_999_999;
const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isAmount = (v, min) => Number.isSafeInteger(v) && v >= min && v <= MAX_AMOUNT;

export function isValidTx(t) {
  return !!t && typeof t === 'object'
    && (t.type === 'expense' || t.type === 'income')
    && isAmount(t.amount, 1)
    && isStr(t.category, 20)
    && typeof (t.memo ?? '') === 'string' && (t.memo ?? '').length <= 100
    && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
}

export function isValidOp(o) {
  if (!o || typeof o !== 'object' || !isStr(String(o.opId ?? ''), 64)) return false;
  if (o.kind === 'upsert') return isStr(o.id, 64) && isValidTx(o.data);
  if (o.kind === 'delete') return isStr(o.id, 64);
  if (o.kind === 'budget') return isAmount(o.value, 0);
  return false;
}

// ---------- 저장소 (사용자별) ----------
// 보낼 목록: 항상 localStorage (탭을 닫아도 남아야 하므로)
// 받은 내역 캐시: 자동 로그인 ON → localStorage, OFF → sessionStorage (공용 PC에서 탭을 닫으면 지워지게)
const qKey = (uid) => `ledger.outbox.${uid}`;
const cKey = (uid) => `ledger.cache.${uid}`;
const store = (kind) => { try { return kind === 'session' ? sessionStorage : localStorage; } catch { return null; } };

const read = (key, fallback, kind = 'local') => {
  try { const v = store(kind)?.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const write = (key, value, kind = 'local') => {
  try { store(kind).setItem(key, JSON.stringify(value)); return true; } catch { return false; }
};
const remove = (key) => {
  for (const kind of ['local', 'session']) { try { store(kind)?.removeItem(key); } catch { /* 무시 */ } }
};

export const readQueue = (uid) => {
  const q = read(qKey(uid), []);
  return Array.isArray(q) ? q.filter(isValidOp) : [];
};
/**
 * 성공하면 true. 저장 공간이 꽉 찼으면 다시 받을 수 있는 내역 캐시를 지워 공간을 만든 뒤 한 번 더 시도.
 * 그래도 실패하면 false (호출한 쪽이 메모리 목록으로 계속 진행).
 */
export const writeQueue = (uid, q) => {
  if (write(qKey(uid), q)) return true;
  remove(cKey(uid));
  return write(qKey(uid), q);
};
export const queueStorageKey = qKey;

/** 마지막으로 받은 내역 (오프라인에서 새로고침해도 보이도록) */
export const readCache = (uid) => {
  const c = read(cKey(uid), null, 'session') || read(cKey(uid), null, 'local');
  if (!c || typeof c !== 'object' || !c.tx || typeof c.tx !== 'object') return null;
  const tx = Object.fromEntries(Object.entries(c.tx).filter(([id, t]) => isStr(id, 64) && isValidTx(t)));
  return { tx, budget: isAmount(c.budget, 0) ? c.budget : 0 };
};
export const writeCache = (uid, tx, budget, remember) => {
  const kind = remember ? 'local' : 'session';
  remove(cKey(uid));
  return write(cKey(uid), { tx, budget, savedAt: Date.now() }, kind);
};

/** 로그아웃 시 이 기기에서 해당 사용자의 가계부 데이터 삭제 */
export const clearUserData = (uid) => { remove(cKey(uid)); remove(qKey(uid)); };

// ---------- 목록 정리 ----------
/** 새 작업을 목록에 넣으면서 같은 대상에 대한 이전 작업을 지움 */
export function coalesce(queue, op) {
  const sameTarget = (o) =>
    op.kind === 'budget' ? o.kind === 'budget' : (o.kind === 'upsert' || o.kind === 'delete') && o.id === op.id;
  return [...queue.filter((o) => !sameTarget(o)), op];
}

/** 목록에서 특정 작업 하나만 제거 (보내는 동안 합쳐져서 이미 없으면 그대로) */
export const removeOp = (queue, opId) => queue.filter((o) => o.opId !== opId);

/** 서버에서 받은 데이터 위에 아직 못 보낸 작업을 덮어서 화면용 상태를 만듦 */
export function applyQueue(tx, budget, queue) {
  const next = { ...tx };
  let b = budget;
  for (const op of queue) {
    if (op.kind === 'upsert') next[op.id] = op.data;
    else if (op.kind === 'delete') delete next[op.id];
    else if (op.kind === 'budget') b = op.value;
  }
  return { tx: next, budget: b };
}

// ---------- 오류 분류 ----------
/**
 * 다시 보내면 성공할 수 있는 오류인가?
 *  - 네트워크 끊김, 서버 일시 장애(5xx), 요청 과다(429), 로그인 토큰 만료 → 다시 시도
 *  - 데이터 자체가 잘못됨(형식·제약 위반), 권한 없음 → 다시 보내도 실패하므로 버림
 */
export function isRetryable(err) {
  if (!err) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String(err.message || err);
  const code = String(err.code || '');
  const status = err.status == null ? null : Number(err.status); // 없으면 null (0으로 오해하지 않게)
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|aborted/i.test(msg)) return true;
  if (/jwt|token/i.test(msg) || code === 'PGRST301' || code === 'PGRST303') return true;
  // 권한 오류(42501)·401·403은 대부분 로그인 만료 때문 → 사용자 데이터를 버리지 않고 다시 로그인되면 재전송
  if (code === '42501' || err.status === 401 || err.status === 403) return true;
  // Postgres 오류 코드(22xxx 데이터, 23xxx 제약, 42xxx 문법)와 PostgREST 요청 오류는 영구 실패
  if (/^(22|23|42)[0-9A-Z]{3}$/.test(code) || /^PGRST[12]\d\d$/.test(code)) return false;
  if (status !== null) {
    if (status === 0 || status === 408 || status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
  }
  return true;
}
