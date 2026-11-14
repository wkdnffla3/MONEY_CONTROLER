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
    && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)
    && (t.memberId == null || isStr(t.memberId, 64))
    && (t.tags == null || isValidTags(t.tags))
    && (t.cardId == null || isStr(t.cardId, 64))
    && (t.inst == null || (Number.isInteger(t.inst) && t.inst >= 1 && t.inst <= 36));
}

/** 태그: 최대 5개, 각 1~12자, 중복 없음 */
export const MAX_TAGS = 5;
export const MAX_TAG_LEN = 12;
export function isValidTags(tags) {
  return Array.isArray(tags) && tags.length <= MAX_TAGS
    && tags.every((x) => isStr(x, MAX_TAG_LEN) && !!x.trim()) && new Set(tags).size === tags.length;
}

/** 신용카드: 최대 10개 { id, name(1~16자), payDay(1~31), closeDay(1~31), color } */
export function isValidCards(list) {
  if (!Array.isArray(list) || list.length > 10) return false;
  const ids = new Set();
  for (const c of list) {
    if (!c || typeof c !== 'object' || !isStr(c.id, 40) || ids.has(c.id)) return false;
    if (!isStr(c.name, 16) || !c.name.trim()) return false;
    for (const k of ['payDay', 'closeDay']) if (!Number.isInteger(c[k]) || c[k] < 1 || c[k] > 31) return false;
    if (!Number.isInteger(c.color) || c.color < 0 || c.color > 99) return false;
    ids.add(c.id);
  }
  return true;
}

/** 함께 쓰는 사람 목록: 최대 10명, 이름 1~12자, id 중복 없음 */
export function isValidMembers(list) {
  if (!Array.isArray(list) || list.length > 10) return false;
  const ids = new Set();
  for (const m of list) {
    if (!m || typeof m !== 'object' || !isStr(m.id, 64) || ids.has(m.id)) return false;
    if (!isStr(m.name, 12) || !m.name.trim()) return false;
    if (!Number.isInteger(m.color) || m.color < 0 || m.color > 99) return false;
    ids.add(m.id);
  }
  return true;
}

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const isYm = (v) => typeof v === 'string' && YM.test(v);

/** 반복 내역 규칙: 최대 50개 */
export function isValidRecurring(list) {
  if (!Array.isArray(list) || list.length > 50) return false;
  const ids = new Set();
  for (const r of list) {
    if (!r || typeof r !== 'object' || !isStr(r.id, 40) || ids.has(r.id)) return false;
    if (!(r.type === 'expense' || r.type === 'income') || !isAmount(r.amount, 1) || !isStr(r.category, 20)) return false;
    if (typeof (r.memo ?? '') !== 'string' || (r.memo ?? '').length > 100) return false;
    if (!(r.memberId == null || isStr(r.memberId, 64))) return false;
    if (!Number.isInteger(r.day) || r.day < 1 || r.day > 31) return false;
    if (!isYm(r.start) || !(r.end == null || isYm(r.end)) || !(r.last == null || isYm(r.last))) return false;
    if (typeof r.active !== 'boolean') return false;
    ids.add(r.id);
  }
  return true;
}

/** 사용자 카테고리: null(기본값 사용) 또는 { expense: [...], income: [...] }, 종류별 1~30개 */
export function isValidCategories(c) {
  if (c == null) return true;
  if (typeof c !== 'object') return false;
  for (const type of ['expense', 'income']) {
    const list = c[type];
    if (!Array.isArray(list) || list.length < 1 || list.length > 30) return false;
    const names = new Set();
    for (const x of list) {
      if (!x || typeof x !== 'object' || !isStr(x.name, 20) || !x.name.trim() || names.has(x.name)) return false;
      if (!isStr(x.icon, 8)) return false;
      names.add(x.name);
    }
  }
  return true;
}

/** 카테고리별 예산: { 카테고리명: 금액 }, 최대 60개 */
export function isValidCatBudgets(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  const entries = Object.entries(b);
  return entries.length <= 60 && entries.every(([k, v]) => isStr(k, 20) && isAmount(v, 1));
}

/**
 * 설정형 작업 종류 → 검사 함수, DB 칸 이름, 기본값.
 * 내역 ID가 없고, 같은 종류끼리는 마지막 것만 남게 합쳐짐.
 */
export const SETTINGS = {
  budget:     { column: 'budget',      valid: (v) => isAmount(v, 0),  empty: 0 },
  members:    { column: 'members',     valid: isValidMembers,         empty: [] },
  recurring:  { column: 'recurring',   valid: isValidRecurring,       empty: [] },
  categories: { column: 'categories',  valid: isValidCategories,      empty: null },
  catBudgets: { column: 'cat_budgets', valid: isValidCatBudgets,      empty: {} },
  cards:      { column: 'cards',       valid: isValidCards,           empty: [] },
};
const isSetting = (kind) => Object.prototype.hasOwnProperty.call(SETTINGS, kind);
const cleanSetting = (kind, v) => (SETTINGS[kind].valid(v) ? v : SETTINGS[kind].empty);
export const sanitizeSetting = cleanSetting;
export const sanitizeMembers = (v) => cleanSetting('members', v);

/** 장보기 물품 */
export function isValidItem(i) {
  return !!i && typeof i === 'object'
    && isStr(i.name, 40) && !!i.name.trim()
    && Number.isInteger(i.qty) && i.qty >= 1 && i.qty <= 999
    && Number.isSafeInteger(i.price) && i.price >= 0 && i.price <= MAX_AMOUNT
    && isStr(i.category, 20)
    && (i.memberId == null || isStr(i.memberId, 64))
    && typeof (i.memo ?? '') === 'string' && (i.memo ?? '').length <= 100
    && typeof i.checked === 'boolean'
    && (i.status === 'todo' || i.status === 'bought')
    && (i.paid == null || isAmount(i.paid, 1))
    && (i.txId == null || isStr(i.txId, 64))
    && (i.boughtAt == null || (typeof i.boughtAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.boughtAt)));
}

export function isValidOp(o) {
  if (!o || typeof o !== 'object' || !isStr(String(o.opId ?? ''), 64)) return false;
  if (o.kind === 'upsert') return isStr(o.id, 64) && isValidTx(o.data);
  if (o.kind === 'delete') return isStr(o.id, 64);
  if (o.kind === 'item') return isStr(o.id, 64) && isValidItem(o.data);
  if (o.kind === 'itemDel') return isStr(o.id, 64);
  if (isSetting(o.kind)) return SETTINGS[o.kind].valid(o.value);
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
  const items = c.items && typeof c.items === 'object'
    ? Object.fromEntries(Object.entries(c.items).filter(([id, i]) => isStr(id, 64) && isValidItem(i))) : {};
  const out = { tx, items };
  for (const k of Object.keys(SETTINGS)) out[k] = cleanSetting(k, c[k]);
  return out;
};
export const writeCache = (uid, state, remember) => {
  const kind = remember ? 'local' : 'session';
  remove(cKey(uid));
  const data = { tx: state.tx, items: state.items, savedAt: Date.now() };
  for (const k of Object.keys(SETTINGS)) data[k] = state[k];
  return write(cKey(uid), data, kind);
};
export const EMPTY_STATE = Object.freeze({ tx: {}, items: {}, ...Object.fromEntries(Object.entries(SETTINGS).map(([k, d]) => [k, d.empty])) });

/** 로그아웃 시 이 기기에서 해당 사용자의 가계부 데이터 삭제 */
export const clearUserData = (uid) => { remove(cKey(uid)); remove(qKey(uid)); };

// ---------- 목록 정리 ----------
/** 새 작업을 목록에 넣으면서 같은 대상에 대한 이전 작업을 지움 */
/** 두 작업이 같은 대상을 바꾸는지 (같은 내역 ID, 또는 같은 종류의 설정) */
// 대상 키: 설정은 종류별, 내역은 tx:ID, 장보기 물품은 item:ID (서로 섞이지 않게)
const targetKey = (o) => (isSetting(o.kind) ? `set:${o.kind}`
  : o.kind === 'item' || o.kind === 'itemDel' ? `item:${o.id}` : `tx:${o.id}`);
export const sameTarget = (a, b) => targetKey(a) === targetKey(b);

export function coalesce(queue, op) {
  return [...queue.filter((o) => !sameTarget(o, op)), op];
}

/** 목록에서 특정 작업 하나만 제거 (보내는 동안 합쳐져서 이미 없으면 그대로) */
export const removeOp = (queue, opId) => queue.filter((o) => o.opId !== opId);

/** 서버에서 받은 상태 { tx, budget, members, ... } 위에 아직 못 보낸 작업을 덮어서 화면용 상태를 만듦 */
export function applyQueue(state, queue) {
  const next = { ...EMPTY_STATE, ...state, tx: { ...state.tx }, items: { ...(state.items || {}) } };
  for (const op of queue) {
    if (op.kind === 'upsert') next.tx[op.id] = op.data;
    else if (op.kind === 'delete') delete next.tx[op.id];
    else if (op.kind === 'item') next.items[op.id] = op.data;
    else if (op.kind === 'itemDel') delete next.items[op.id];
    else if (isSetting(op.kind)) next[op.kind] = op.value;
  }
  return next;
}

/**
 * DB에 아직 새 칸이 없을 때(업데이트 SQL 미실행) 나는 오류인가.
 * 42703 = 없는 칸, PGRST204 = API가 칸을 모름. 데이터를 버리지 않고 보관해야 함.
 */
export function isSchemaError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  // 42703/PGRST204 = 없는 칸, 42P01/PGRST205 = 없는 테이블(005 전 장보기)
  return code === '42703' || code === 'PGRST204' || code === '42P01' || code === 'PGRST205'
    || /column .* does not exist|could not find the .* column|relation .* does not exist|could not find the table/i.test(String(err.message || ''));
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
  // DB 업데이트 전 → 업데이트되면 성공하므로 보관 후 재시도
  if (isSchemaError(err)) return true;
  // Postgres 오류 코드(22xxx 데이터, 23xxx 제약, 42xxx 문법)와 PostgREST 요청 오류는 영구 실패
  if (/^(22|23|42)[0-9A-Z]{3}$/.test(code) || /^PGRST[12]\d\d$/.test(code)) return false;
  if (status !== null) {
    if (status === 0 || status === 408 || status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
  }
  return true;
}
