import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRemember, supabase } from '../lib/supabase';
import {
  EMPTY_STATE, SETTINGS, applyQueue, clearUserData, coalesce, isMemoLimitError, isValidOp, isRetryable, isSchemaError, newId, queueStorageKey, renameOps, readCache,
  readQueue, rebase, removeOp, sameTarget, sanitizeSetting, setVer, verKey, withBase, writeCache, writeQueue,
} from '../lib/outbox';
import { planRecurring, ymOf } from '../lib/recurring';
import { planPurchase } from '../lib/shopping';
import { useOnline } from './useOnline';
import { getDeviceId, isOwn, markOwn } from '../lib/device';
import { isMissingFn } from '../lib/household';
import { fetchAll } from '../lib/fetchAll';
import { canMerge, mergeSetting } from '../lib/merge';

export { newId };

// DB 줄 → 앱 형식 (변경 기록에서 되살릴 때도 씀)
export const fromRow = (r) => ({
  type: r.type,
  amount: Number(r.amount),
  category: r.category,
  memo: r.memo || '',
  date: r.date,
  memberId: r.member_id ?? null,
  tags: Array.isArray(r.tags) ? r.tags : [],
  cardId: r.card_id ?? null,
  inst: Number(r.inst_months) || 1,
  createdAt: Number(r.created_at) || 0,
});

// level: 0 = 최신(006까지), 1 = 006 전(태그·카드 칸 없음), 2 = 003 전(member_id 칸도 없음).
// 없는 칸은 기본값일 때만 빼고 보냄 → 값이 있는 내역은 실패해서 보관됐다가 DB 업데이트 후 올라감
const hasExtra = (t) => (t.tags && t.tags.length > 0) || !!t.cardId || (t.inst || 1) > 1;
const toRow = (id, userId, t, level, device) => {
  const row = {
    id,
    user_id: userId,
    type: t.type,
    amount: t.amount,
    category: t.category,
    memo: t.memo,
    date: t.date,
    created_at: t.createdAt,
  };
  if (level <= 1 || t.memberId) row.member_id = t.memberId ?? null;
  if (level === 0 || hasExtra(t)) {
    row.tags = t.tags || [];
    row.card_id = t.cardId ?? null;
    row.inst_months = t.inst || 1;
  }
  if (device) row.device_id = device; // 007 적용 후: 어느 기기에서 입력했는지 (알림에서 내 기기 제외용)
  return row;
};

const TX_COLS = 'id,type,amount,category,memo,date,created_at';
// 내역 칸 묶음: DB 단계별로 최신부터 시도
const TX_COL_SETS = [`${TX_COLS},member_id,tags,card_id,inst_months`, `${TX_COLS},member_id`, TX_COLS];
const ITEM_COLS = 'id,name,qty,price,category,member_id,memo,checked,status,paid,tx_id,bought_at,created_at';

export const fromItemRow = (r) => ({
  name: r.name,
  qty: Number(r.qty) || 1,
  price: Number(r.price) || 0,
  category: r.category,
  memberId: r.member_id ?? null,
  memo: r.memo || '',
  checked: !!r.checked,
  status: r.status === 'bought' ? 'bought' : 'todo',
  paid: r.paid == null ? null : Number(r.paid),
  txId: r.tx_id ?? null,
  boughtAt: r.bought_at ?? null,
  createdAt: Number(r.created_at) || 0,
});
const toItemRow = (id, userId, i, device) => ({
  ...(device ? { device_id: device } : {}),
  id, user_id: userId, name: i.name, qty: i.qty, price: i.price, category: i.category, member_id: i.memberId ?? null,
  memo: i.memo || '', checked: i.checked, status: i.status, paid: i.paid ?? null, tx_id: i.txId ?? null,
  bought_at: i.boughtAt ?? null, created_at: i.createdAt,
});
// 설정 칸: DB 업데이트 단계별로 있는 칸이 다름. 최신부터 시도해서 되는 것으로 불러옴
const SETTINGS_COL_SETS = [
  ['budget', 'members', 'recurring', 'categories', 'cat_budgets', 'cards', 'favorites', 'dismissed_subs'], // 010 적용
  ['budget', 'members', 'recurring', 'categories', 'cat_budgets', 'cards', 'favorites'], // 008 적용
  ['budget', 'members', 'recurring', 'categories', 'cat_budgets', 'cards'], // 006 적용
  ['budget', 'members', 'recurring', 'categories', 'cat_budgets'], // 004 적용
  ['budget', 'members'],                                           // 003 적용
  ['budget'],                                                      // 처음 스키마
];
const KIND_BY_COLUMN = Object.fromEntries(Object.entries(SETTINGS).map(([k, d]) => [d.column, k]));

const RETRY_DELAYS = [3000, 10000, 30000, 60000];
const SEND_TIMEOUT_MS = 10000; // 응답이 이보다 늦으면 실패로 보고 나중에 다시 보냄 (같은 ID라 중복 없음)
const LOCK_RETRY_MS = 1500;    // 다른 탭이 전송 중일 때 다시 확인하는 간격

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => resolve({ error: { message: 'timeout: 서버 응답 없음' } }), ms)),
]);

// ---- 버전 확인(017) 도우미 ----
// 다른 기기가 먼저 고쳤다는 서버 오류 (설정 저장 함수 save_setting)
const isVersionConflict = (e) => !!e && (String(e.code) === 'LV409' || /version_conflict/.test(String(e.message || '')));
// 서버 줄과 보내려던 내용이 같은지 (같으면 "내가 이미 올린 것"이 응답만 못 받은 경우 → 성공으로 봄)
const TX_SAME_KEYS = ['type', 'amount', 'category', 'memo', 'date', 'member_id', 'tags', 'card_id', 'inst_months', 'created_at'];
const ITEM_SAME_KEYS = ['name', 'qty', 'price', 'category', 'member_id', 'memo', 'checked', 'status', 'paid', 'tx_id', 'bought_at', 'created_at'];
const norm = (v) => (v === undefined ? null : typeof v === 'number' ? v : (typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v));
const sameRow = (a, b, keys) => keys.every((k) => !(k in b) || JSON.stringify(norm(a[k])) === JSON.stringify(norm(b[k])));
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// 같은 대상(같은 내역 ID, 또는 예산)에 대한 작업이 아직 목록에 남아 있는지
const hasPendingFor = (queue, op) => queue.some((o) => sameTarget(o, op));

/**
 * 로그인한 사용자의 내역과 예산 — 오프라인 우선.
 *
 * 모든 저장은 먼저 "보낼 목록"(outbox, localStorage)에 들어가고 화면에 바로 반영된 뒤,
 * 온라인이면 즉시, 오프라인이면 연결되는 순간 순서대로 서버에 올라감.
 * 중복 방지 원리는 lib/outbox.js 맨 위 설명 참고.
 */
// device_id 칸이 없다는(007 전) 오류인지
const isDeviceColError = (e) => isSchemaError(e) && /device_id/.test(String(e?.message || ''));
// 실시간으로 받은 변경 중 알림 대상(다른 기기에서 새로 추가한 내역·물품)만 골라냄
const remoteInsert = (table, payload) => {
  if (payload?.eventType !== 'INSERT' || !payload.new || typeof payload.new.id !== 'string') return null;
  const record = payload.new;
  if (record.device_id && record.device_id === getDeviceId()) return null; // 이 기기에서 입력
  if (isOwn(record.id)) return null; // 007 전이라 device_id가 없을 때: 이 기기에서 방금 저장한 ID
  return { table, type: 'INSERT', record };
};

// userId = 지금 보는 가계부 ID (내 가계부면 내 계정 ID, 공유 가계부에 참여 중이면 그 가계부 ID)
// accountId = 로그인한 계정 ID (전송 전 로그인 확인용)
export function useLedger(userId, { onRemote, accountId, onForbidden, onConflict } = {}) {
  const online = useOnline();
  const onRemoteRef = useRef(onRemote);
  onRemoteRef.current = onRemote;
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const onForbiddenRef = useRef(onForbidden);
  onForbiddenRef.current = onForbidden;
  const onConflictRef = useRef(onConflict);
  onConflictRef.current = onConflict;
  const verRef = useRef(null);         // 017(버전 칸) 있는지: null 모름, true/false
  const saveFnRef = useRef(true);      // 017 save_setting 함수 있는지
  // 내가 올린 저장의 버전 이동 기록 { 대상: [[보낸 base, 새 버전], ...] } — 내 저장끼리 충돌로 보지 않게
  // (수정 창을 연 순간엔 앞 저장이 아직 안 올라가 옛 버전을 봤어도, 그 사이 올라간 게 내 것이면 이어서 계산)
  const ownMoves = useRef(new Map());
  const deviceColRef = useRef(true); // device_id 칸이 있는지 (없으면 빼고 보냄)
  const renameFnRef = useRef(true);     // 013(rename_category 함수) 있는지. 없다고 확인되면 false
  const recurBlockedRef = useRef(false); // 반복 내역 51개 이상이 015 전 DB(50개 제한)에 걸려 보관 중인지
  const memoBlockedRef = useRef(false); // 긴 메모가 예전 DB 제한에 걸려 보관 중인지 (011 안내)
  const [server, setServer] = useState(EMPTY_STATE); // 서버(또는 캐시)에서 받은 상태 { tx, budget, members }
  const [schemaOutdated, setSchemaOutdated] = useState(false); // DB 업데이트 필요
  const [schemaNeed, setSchemaNeed] = useState(null);           // 먼저 실행할 업데이트 파일 번호
  const [serverLoaded, setServerLoaded] = useState(false);     // 이번 접속에서 서버 데이터를 한 번 이상 받았는지
  const [today, setToday] = useState(() => new Date().toDateString()); // 날짜가 바뀌면 반복 내역 확인
  const [loadedDay, setLoadedDay] = useState(null); // 서버 데이터를 마지막으로 받은 날 (반복 내역은 오늘 받은 데이터로만 판단)
  const [queue, setQueue] = useState([]);                       // 아직 못 보낸 작업
  const [status, setStatus] = useState('idle');                 // idle | loading | ok | error
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [storageFull, setStorageFull] = useState(false);

  const memQueue = useRef([]);         // 메모리에 둔 보낼 목록 (기기 저장이 실패해도 이 탭에서는 유지)
  const storageBroken = useRef(false); // 기기 저장소에 쓰기 실패한 적이 있으면 메모리 목록을 기준으로 함
  const serverRef = useRef(EMPTY_STATE);
  const legacyRef = useRef(0); // 내역 칸 단계: 0 최신, 1 006 전, 2 003 전 (toRow 참고)
  const lockTimer = useRef(null);
  const flushPromise = useRef(null);
  const retryTimer = useRef(null);
  const retryStep = useRef(0);
  const sentLog = useRef([]);          // 최근 전송 완료한 작업 (불러오기와 겹칠 때 보정용)
  const failed = useRef(new Map());    // opId → 영구 실패 오류
  const loadSeq = useRef(0);
  const activeLedger = useRef(userId); // 지금 보고 있는 가계부 (전환 직후 이전 가계부의 늦은 응답이 섞이지 않게)
  const loadedFor = useRef(null);      // 이번 접속에서 서버 데이터를 받은 가계부

  // ---- 보낼 목록 읽기/쓰기 ----
  // 평소: 기기 저장소가 기준 (다른 탭과 공유)
  // 저장 실패 후: 오래된 기기 목록 대신 메모리 목록을 기준으로 해서 새 입력이 사라지지 않게 함
  const getQ = useCallback(() => {
    if (!userId) return [];
    if (storageBroken.current) return memQueue.current;
    return readQueue(userId);
  }, [userId]);

  const setQ = useCallback((q) => {
    memQueue.current = q;
    const ok = writeQueue(userId, q);
    if (!ok && !storageBroken.current) { storageBroken.current = true; setStorageFull(true); }
    if (ok && storageBroken.current) { storageBroken.current = false; setStorageFull(false); }
    setQueue(q);
  }, [userId]);

  // 서버 상태를 바꿀 때마다 기기 캐시도 갱신 (오프라인에서 다시 열어도 최신 내역이 보이게)
  const updateServer = useCallback((next) => {
    if (activeLedger.current !== userId) return; // 다른 가계부로 바뀐 뒤 도착한 이전 가계부의 결과
    serverRef.current = next;
    setServer(next);
    if (userId) writeCache(userId, next, getRemember());
  }, [userId]);

  // ---- 서버에서 불러오기 ----
  const load = useCallback(async () => {
    if (!userId || !supabase) return;
    const seq = ++loadSeq.current;
    const startedAt = Date.now();
    setStatus((s) => (s === 'ok' ? 'ok' : 'loading'));
    let txRes, stRes, itRes, txLevel = 0, setLevel = 0, noItemsTable = false, noDeviceCol = false;
    try {
      // 내역: member_id 칸이 없으면(003 전) 예전 칸만으로
      const loadTx = async () => {
        let r;
        for (let i = 0; i < TX_COL_SETS.length; i += 1) {
          r = await fetchAll(() => supabase.from('transactions').select(TX_COL_SETS[i] + (verRef.current ? ',version' : '')));
          if (!isSchemaError(r.error)) { txLevel = i; return r; }
        }
        return r;
      };
      // 설정: 최신 칸 묶음부터 시도
      const loadSettings = async () => {
        for (let i = 0; i < SETTINGS_COL_SETS.length; i += 1) {
          const cols = [...SETTINGS_COL_SETS[i], ...(verRef.current && i === 0 ? ['ver'] : [])];
          const r = await supabase.from('settings').select(cols.join(',')).maybeSingle();
          if (!isSchemaError(r.error)) { setLevel = i; return r; }
        }
        return { data: null, error: null };
      };
      // 장보기: 테이블이 없으면(005 전) 기기에 있던 목록을 그대로 둠
      const loadItems = async () => {
        const r = await fetchAll(() => supabase.from('shopping_items').select(ITEM_COLS + (verRef.current ? ',version' : '')));
        if (isSchemaError(r.error)) { noItemsTable = true; return { data: null, error: null }; }
        return r;
      };
      // 007(기기 ID 칸) 적용 여부: 없는 칸을 고르면 오류가 나는 것으로 확인 (줄은 가져오지 않음)
      const probeDevice = async () => {
        const r = await supabase.from('transactions').select('device_id').eq('id', '__probe__');
        noDeviceCol = isSchemaError(r.error);
      };
      // 017(버전 칸) 적용 여부: 한 번 확인되면 다시 묻지 않음
      if (verRef.current !== true) {
        const r = await supabase.from('transactions').select('version').eq('id', '__probe__');
        verRef.current = !r.error ? true : isSchemaError(r.error) ? false : null;
      }
      [txRes, stRes, itRes] = await Promise.all([loadTx(), loadSettings(), loadItems(), probeDevice().catch(() => {})]);
    } catch (e) {
      txRes = { error: e };
    }
    if (seq !== loadSeq.current) return; // 더 최근 불러오기가 있음
    if (txRes.error) {
      // 오프라인이면 캐시를 그대로 보여주고 오류로 치지 않음
      if (isRetryable(txRes.error)) { setStatus((s) => (s === 'loading' ? 'ok' : s)); return; }
      setError(txRes.error);
      setStatus('error');
      return;
    }
    legacyRef.current = txLevel;
    // 아직 실행하지 않은 DB 업데이트 중 가장 앞 번호 (예: '006')
    const need = [
      txLevel === 2 ? '003' : txLevel === 1 ? '006' : null,
      ['', '010', '008', '006', '004', '003'][setLevel] || null,
      noItemsTable ? '005' : null,
      noDeviceCol ? '007' : null,
      memoBlockedRef.current ? '011' : null,
      recurBlockedRef.current ? '015' : null,
      renameFnRef.current ? null : '013',
      verRef.current === false ? '017' : null, // 버전 확인(동시에 고칠 때 덮어쓰기 방지) — 없어도 예전처럼 동작
    ].filter(Boolean).sort()[0] || null;
    if (noDeviceCol) deviceColRef.current = false;
    setSchemaNeed(need);
    setSchemaOutdated(!!need);
    const items = itRes?.data && !itRes.error
      ? Object.fromEntries(itRes.data.map((r) => [r.id, fromItemRow(r)]))
      : serverRef.current.items || {}; // 못 받았으면 기존 목록 유지
    const next = { ...EMPTY_STATE, tx: Object.fromEntries(txRes.data.map((r) => [r.id, fromRow(r)])), items };
    for (const [col, val] of Object.entries(stRes?.data || {})) {
      const kind = KIND_BY_COLUMN[col];
      if (kind) next[kind] = sanitizeSetting(kind, kind === 'budget' ? Number(val) || 0 : val);
    }
    // 서버 버전 표 (017 이후에만. 없으면 예전처럼 확인 없이 저장)
    if (verRef.current) {
      const ver = {};
      for (const r of txRes.data) if (r.version != null) ver[`tx:${r.id}`] = Number(r.version);
      if (itRes?.data && !itRes.error) for (const r of itRes.data) if (r.version != null) ver[`item:${r.id}`] = Number(r.version);
      else for (const [k, v] of Object.entries(serverRef.current._ver || {})) if (k.startsWith('item:')) ver[k] = v;
      const sv = stRes?.data?.ver;
      for (const [kind, d] of Object.entries(SETTINGS)) ver[`set:${kind}`] = Number(sv?.[d.column]) || 0;
      next._ver = ver;
    }
    // 불러오는 사이에 전송이 끝난 작업은 응답에 빠져 있을 수 있으니 덧씌움
    const lateLog = sentLog.current.filter((x) => x.at >= startedAt);
    if (activeLedger.current !== userId) return;
    let merged = applyQueue(next, lateLog.map((x) => x.op));
    for (const x of lateLog) merged = setVer(merged, x.op, x.version);
    updateServer(merged);
    loadedFor.current = userId;
    setError(null);
    setStatus('ok');
    setServerLoaded(true);
    setLoadedDay(new Date().toDateString());
  }, [userId, updateServer]);

  // ---- 작업 하나 전송 ----
  // 결과: { error } | { version } (017: 새 서버 버전, 지웠으면 null) | { conflict: 'changed'|'deleted' }
  const send = useCallback(async (op) => {
    try {
      const device = deviceColRef.current && getDeviceId();
      const checked = verRef.current === true && op.base !== undefined; // 버전 확인해서 저장
      // 내역·물품: 버전 조건을 붙여 추가/수정/삭제
      if (checked && (op.kind === 'upsert' || op.kind === 'item' || op.kind === 'delete' || op.kind === 'itemDel')) {
        const isTx = op.kind === 'upsert' || op.kind === 'delete';
        const table = isTx ? 'transactions' : 'shopping_items';
        const cols = isTx ? TX_COL_SETS[legacyRef.current] : ITEM_COLS;
        const keys = isTx ? TX_SAME_KEYS : ITEM_SAME_KEYS;
        const fetchRow = async () => {
          const r = await withTimeout(Promise.resolve(supabase.from(table).select(`${cols},version`).eq('id', op.id)), SEND_TIMEOUT_MS);
          return r.error ? { error: r.error } : { row: (r.data || [])[0] || null };
        };
        if (op.kind === 'delete' || op.kind === 'itemDel') {
          if (op.base === null) return await withTimeout(Promise.resolve(supabase.from(table).delete().eq('id', op.id)), SEND_TIMEOUT_MS);
          const r = await withTimeout(Promise.resolve(supabase.from(table).delete().eq('id', op.id).eq('version', op.base).select('id')), SEND_TIMEOUT_MS);
          if (r.error) return r;
          if ((r.data || []).length) return { error: null, version: null };
          const f = await fetchRow(); // 0줄: 이미 지워졌거나(괜찮음) 다른 기기가 고침(충돌)
          if (f.error) return f;
          return f.row ? { conflict: 'changed', row: f.row } : { error: null, version: null };
        }
        const row = isTx ? toRow(op.id, userId, op.data, legacyRef.current, device) : toItemRow(op.id, userId, op.data, device);
        if (op.base === null) {
          const r = await withTimeout(Promise.resolve(supabase.from(table).insert(row).select('version')), SEND_TIMEOUT_MS);
          if (!r.error) return { error: null, version: Number(r.data?.[0]?.version) || 1 };
          if (String(r.error.code) !== '23505') return r;
          // 같은 ID가 이미 있음: 내가 먼저 보낸 게 응답만 못 받은 거면 성공, 다른 기기가 만든 거면 충돌
          const f = await fetchRow();
          if (f.error) return f;
          if (f.row && sameRow(f.row, row, keys)) return { error: null, version: Number(f.row.version) };
          return { conflict: 'changed', row: f.row };
        }
        const { id: _id, user_id: _u, ...patch } = row;
        const r = await withTimeout(Promise.resolve(supabase.from(table).update(patch).eq('id', op.id).eq('version', op.base).select('version')), SEND_TIMEOUT_MS);
        if (r.error) return r;
        if ((r.data || []).length) return { error: null, version: Number(r.data[0].version) };
        const f = await fetchRow(); // 0줄: 다른 기기가 고쳤거나 지움 (내가 보낸 게 이미 반영된 거면 성공)
        if (f.error) return f;
        if (!f.row) return { conflict: 'deleted' };
        if (sameRow(f.row, row, keys)) return { error: null, version: Number(f.row.version) };
        return { conflict: 'changed', row: f.row };
      }
      // 설정: save_setting 함수로 칸 하나만 버전 확인해서 저장
      if (checked && SETTINGS[op.kind] && saveFnRef.current) {
        const col = SETTINGS[op.kind].column;
        const r = await withTimeout(Promise.resolve(supabase.rpc('save_setting', { p_col: col, p_value: op.value, p_base: op.base })), SEND_TIMEOUT_MS);
        if (!r.error) return { error: null, version: Number(r.data) || 0 };
        if (isMissingFn(r.error)) { saveFnRef.current = false; }
        else if (isVersionConflict(r.error)) {
          const f = await withTimeout(Promise.resolve(supabase.from('settings').select(`${col},ver`).maybeSingle()), SEND_TIMEOUT_MS);
          if (f.error) return f;
          const cur = op.kind === 'budget' ? Number(f.data?.[col]) || 0 : f.data?.[col];
          const curVer = Number(f.data?.ver?.[col]) || 0;
          if (sameValue(cur, op.value)) return { error: null, version: curVer };
          // 서로 다른 항목을 바꿨으면 자동으로 합쳐서 다시 저장 (예: 두 기기에서 즐겨찾기를 하나씩 추가)
          if (canMerge(op.kind) && op.prev !== undefined) {
            const m = mergeSetting(op.kind, sanitizeSetting(op.kind, op.prev), op.value, sanitizeSetting(op.kind, cur));
            if (m.ok && SETTINGS[op.kind].valid(m.value)) {
              const r2 = await withTimeout(Promise.resolve(supabase.rpc('save_setting', { p_col: col, p_value: m.value, p_base: curVer })), SEND_TIMEOUT_MS);
              if (!r2.error) return { error: null, version: Number(r2.data) || 0, value: m.value };
              if (!isVersionConflict(r2.error)) return r2;
            }
          }
          return { conflict: 'changed' };
        } else return r;
      }
      let req;
      if (op.kind === 'upsert') req = supabase.from('transactions').upsert(toRow(op.id, userId, op.data, legacyRef.current, device));
      else if (op.kind === 'delete') req = supabase.from('transactions').delete().eq('id', op.id);
      else if (op.kind === 'item') req = supabase.from('shopping_items').upsert(toItemRow(op.id, userId, op.data, device));
      else if (op.kind === 'itemDel') req = supabase.from('shopping_items').delete().eq('id', op.id);
      // 카테고리 이름 변경: 이 가계부에서 그 이름을 쓰는 내역을 서버가 한 번에 바꿈 (요청 1번, 다른 칸은 그대로)
      // 다시 보내도 이미 바뀐 뒤라 아무 일도 없어서 안전.
      // 013 이후: DB 함수 rename_category → 변경 기록에 내역마다 남기지 않아 빠름.
      // 013 전(함수 없음): 예전처럼 직접 UPDATE 하고 업데이트 안내
      else if (op.kind === 'renameCat') {
        if (renameFnRef.current) {
          const r = await withTimeout(Promise.resolve(
            supabase.rpc('rename_category', { p_type: op.type, p_from: op.from, p_to: op.to })), SEND_TIMEOUT_MS);
          if (!isMissingFn(r.error)) return r;
          renameFnRef.current = false;
          setSchemaNeed((n) => (!n || n > '013' ? '013' : n));
          setSchemaOutdated(true);
        }
        req = supabase.from('transactions').update({ category: op.to })
          .eq('user_id', userId).eq('type', op.type).eq('category', op.from);
      }
      else if (SETTINGS[op.kind]) req = supabase.from('settings').upsert({ user_id: userId, [SETTINGS[op.kind].column]: op.value });
      else return { error: null };
      // 응답이 끝없이 안 오면(불안정한 와이파이 등) 전송 전체가 멈추지 않도록 제한 시간을 둠
      return await withTimeout(Promise.resolve(req), SEND_TIMEOUT_MS);
    } catch (e) {
      return { error: e };
    }
  }, [userId]);

  const scheduleRetry = useCallback((fn) => {
    clearTimeout(retryTimer.current);
    const delay = RETRY_DELAYS[Math.min(retryStep.current, RETRY_DELAYS.length - 1)];
    retryStep.current += 1;
    retryTimer.current = setTimeout(fn, delay);
  }, []);

  // ---- 보낼 목록 비우기 (순서대로, 한 번에 하나씩) ----
  const flush = useCallback(() => {
    if (!userId || !supabase) return Promise.resolve();
    if (flushPromise.current) return flushPromise.current; // 이미 보내는 중이면 그 작업을 기다림
    if (!getQ().length || navigator.onLine === false) return Promise.resolve();

    const run = async () => {
      let droppedAny = false;
      // 만료된 로그인 토큰 갱신. 로그인 상태가 아니면 보내지 않음 (권한 오류로 데이터를 잃지 않게)
      const { data: sess } = (await supabase.auth.getSession().catch(() => null)) || {};
      if (!sess?.session || sess.session.user?.id !== (accountRef.current || userId)) {
        scheduleRetry(() => flushRef.current());
        return;
      }
      // DB 업데이트 전이라 지금은 못 보내는 작업(사람 지정 내역, 사람 목록)은 건너뛰고 나머지를 계속 보냄.
      // 서로 다른 대상끼리는 순서가 상관없고, 같은 대상은 목록에 하나만 있으므로 건너뛰어도 안전.
      const skipped = new Set();
      memoBlockedRef.current = false; // 이번 시도에서 다시 걸리면 다시 켜짐
      recurBlockedRef.current = false;
      const conflicts = [];
      for (;;) {
        const op = getQ().find((o) => !skipped.has(o.opId));
        if (!op) break;
        const res = await send(op);
        // 다른 기기가 먼저 고침(017): 이 작업은 올리지 않고 빼서 알림. 자동 작업(반복 내역 기록 등)은 조용히 뺌
        if (res.conflict) {
          setQ(removeOp(getQ(), op.opId));
          const c = Object.assign(new Error('다른 기기에서 먼저 바뀌었어요'), { code: 'conflict', reason: res.conflict, op });
          failed.current.set(op.opId, c);
          if (!op.soft) conflicts.push(c);
          droppedAny = true;
          continue;
        }
        const { error: e, version } = res;
        const applied = res.value !== undefined ? { ...op, value: res.value } : op; // 자동으로 합쳐 저장한 값
        if (e) {
          // device_id 칸만 없는 거면(007 전) 그 칸을 빼고 바로 다시 보냄 — 알림만 덜 정확해질 뿐 저장엔 문제없음
          if (isDeviceColError(e) && deviceColRef.current) { deviceColRef.current = false; continue; }
          // 반복 내역 51개 이상인데 015 전 DB(50개 제한) → 버리지 않고 보관, 015 실행 안내
          if (op.kind === 'recurring' && Array.isArray(op.value) && op.value.length > 50 && String(e.code) === '23514') {
            recurBlockedRef.current = true;
            setSchemaNeed((n) => (!n || n > '015' ? '015' : n));
            setSchemaOutdated(true);
            skipped.add(op.opId);
            continue;
          }
          // 메모가 길어서 예전 DB 제한(100자)에 걸림 → 버리지 않고 보관, 011 실행 안내
          if (isMemoLimitError(e)) {
            memoBlockedRef.current = true;
            setSchemaNeed((n) => (!n || n > '011' ? '011' : n));
            setSchemaOutdated(true);
            skipped.add(op.opId);
            continue;
          }
          if (isSchemaError(e)) {
            setSchemaOutdated(true);
            // 내역 저장이 member_id 때문에 실패했다면 예전 형식으로 한 번 더 (사람 없는 내역은 이걸로 저장됨)
            if (op.kind === 'upsert' && legacyRef.current < 2) { legacyRef.current += 1; continue; }
            skipped.add(op.opId); // 업데이트되면 다음 시도에 올라감
            continue;
          }
          if (isRetryable(e)) {
            // 권한 오류: 공유 가계부에서 내보내졌을 수 있음 → 공유 상태 다시 확인
            if (String(e.code) === '42501') { try { onForbiddenRef.current?.(); } catch { /* 무시 */ } }
            scheduleRetry(() => flushRef.current());
            return;
          }
          // 다시 보내도 실패할 작업 → 목록에서 빼고 알림
          failed.current.set(op.opId, e);
          setQ(removeOp(getQ(), op.opId));
          droppedAny = true;
          continue;
        }
        if (version !== undefined && op.base !== undefined) {
          const k = verKey(op);
          ownMoves.current.set(k, [...(ownMoves.current.get(k) || []), [op.base, version]].slice(-10));
        }
        setQ(rebase(removeOp(getQ(), op.opId), applied, version));
        updateServer(setVer(applyQueue(serverRef.current, [applied]), op, version));
        const now = Date.now();
        sentLog.current = [...sentLog.current.filter((x) => now - x.at < 60000), { at: now, op: applied, version }];
      }
      if (skipped.size) {
        scheduleRetry(() => flushRef.current()); // DB가 업데이트되면 다음 시도에 올라감
      } else {
        retryStep.current = 0;
        clearTimeout(retryTimer.current);
      }
      if (droppedAny) await load();
      // 최신 내용을 받은 뒤에 알림 → "내 것으로 저장"을 누르면 최신 버전 기준으로 다시 저장됨
      if (conflicts.length) { try { onConflictRef.current?.(conflicts); } catch { /* 알림 실패가 동기화를 막지 않게 */ } }
    };

    const withLock = async () => {
      setSyncing(true);
      try {
        // 탭이 여러 개면 한 탭만 전송 (다른 탭이 보내는 중이면 건너뜀)
        if (navigator.locks?.request) {
          let gotLock = false;
          await navigator.locks.request(`ledger-flush-${userId}`, { ifAvailable: true }, async (lock) => {
            if (!lock) return;
            gotLock = true;
            await run();
          });
          // 다른 탭이 보내는 중이었다면, 그 탭이 끝난 뒤 남은 게 있는지 다시 확인
          if (!gotLock) {
            clearTimeout(lockTimer.current);
            lockTimer.current = setTimeout(() => flushRef.current(), LOCK_RETRY_MS);
          }
        } else {
          await run();
        }
      } finally {
        setSyncing(false);
        flushPromise.current = null;
      }
    };

    flushPromise.current = withLock();
    return flushPromise.current;
  }, [userId, getQ, setQ, send, scheduleRetry, load, updateServer]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  // ---- 로그인 사용자 바뀔 때: 캐시 → 서버 불러오기 → 남은 목록 전송 ----
  useEffect(() => {
    clearTimeout(retryTimer.current);
    clearTimeout(lockTimer.current);
    retryStep.current = 0;
    sentLog.current = [];
    failed.current = new Map();
    storageBroken.current = false;
    setStorageFull(false);
    setServerLoaded(false);
    setLoadedDay(null);
    activeLedger.current = userId;
    loadedFor.current = null;
    if (!userId || !supabase) {
      memQueue.current = [];
      serverRef.current = EMPTY_STATE;
      setServer(serverRef.current); setQueue([]); setStatus('idle'); setError(null);
      return undefined;
    }
    const cache = readCache(userId);
    serverRef.current = cache || EMPTY_STATE;
    legacyRef.current = 0;
    deviceColRef.current = true;
    setSchemaOutdated(false);
    setServer(serverRef.current);
    memQueue.current = readQueue(userId);
    setQueue(memQueue.current);
    setStatus(cache ? 'ok' : 'loading');
    load().then(() => flushRef.current());

    const filter = `user_id=eq.${userId}`;
    // 변경이 오면 새로 불러오고, 다른 기기에서 추가한 거면 알림으로 넘김
    // 변경이 한꺼번에 많이 와도(예: 카테고리 이름 변경으로 수백 줄) 다시 불러오기는 한 번만
    let reloadTimer = null;
    const scheduleLoad = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 400); };
    const onChange = (table) => (payload) => {
      scheduleLoad();
      const n = remoteInsert(table, payload);
      if (n) { try { onRemoteRef.current?.(n); } catch { /* 알림 실패가 동기화를 막지 않게 */ } }
    };
    const channel = supabase
      .channel(`ledger-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter }, onChange('transactions'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter }, onChange('shopping_items'))
      .subscribe();

    const onVisible = () => {
      if (document.hidden) return;
      setToday(new Date().toDateString());
      load(); flushRef.current();
    };
    // 날짜가 바뀌는 자정(+5초)에 맞춰 갱신 → 그달 1일 반복 내역·'오늘' 표시가 바로 바뀜.
    // 기기가 잠들면 타이머가 늦어질 수 있어 최대 1시간 단위로 다시 맞추고, 앱으로 돌아올 때도 확인(onVisible)
    let dayTimer = null;
    const armDayTimer = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      dayTimer = setTimeout(() => { setToday(new Date().toDateString()); armDayTimer(); }, Math.min(next - now, 60 * 60 * 1000));
    };
    armDayTimer();
    // 다른 탭이 목록을 바꾸면 따라감 (다른 탭이 전송을 끝낸 경우 서버 상태를 새로 받음)
    const onStorage = (e) => {
      if (e.key !== queueStorageKey(userId) || storageBroken.current) return;
      const next = readQueue(userId);
      memQueue.current = next;
      setQueue((prev) => {
        if (next.length < prev.length) load();
        return next;
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);
    return () => {
      clearTimeout(retryTimer.current);
      clearTimeout(lockTimer.current);
      clearTimeout(dayTimer);
      supabase.removeChannel(channel);
      clearTimeout(reloadTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
    };
  }, [userId, load]);

  // ---- 다시 연결되면 바로 전송 (오프라인 → 온라인으로 바뀔 때만) ----
  const wasOnline = useRef(online);
  useEffect(() => {
    const cameBack = online && !wasOnline.current;
    wasOnline.current = online;
    if (cameBack && userId) {
      retryStep.current = 0;
      load().then(() => flushRef.current());
    }
  }, [online, userId, load]);

  // ---- 저장 동작 (화면에서 호출) ----
  /** 작업을 목록에 넣고 전송을 시도. 결과: { synced } — 서버까지 올라갔으면 true */
  const enqueue = useCallback(async (op0) => {
    const q0 = getQ();
    // 창을 열 때 본 버전(base)이 그 뒤 내 저장으로 바뀌었으면 따라감
    if (op0.base !== undefined) {
      const moves = ownMoves.current.get(verKey(op0)) || [];
      let b = op0.base;
      for (let i = 0; i < 10; i++) { const m = moves.find(([from]) => from === b); if (!m) break; b = m[1]; }
      if (b !== op0.base) op0 = { ...op0, base: b };
    }
    const op = withBase(op0, q0, serverRef.current._ver, serverRef.current);
    if (op.kind === 'upsert' || op.kind === 'item') markOwn([op.id]);
    setQ(coalesce(q0, op));
    await flush();
    const err = failed.current.get(op.opId);
    if (err) { failed.current.delete(op.opId); throw err; }
    // 같은 내역에 대한 작업이 하나도 안 남아야 "서버까지 올라감"
    return { synced: !hasPendingFor(getQ(), op) };
  }, [getQ, setQ, flush]);

  /** 여러 작업을 한 번에 목록에 넣고 한 번만 전송 (카테고리 이름 변경, 반복 내역 등록 등) */
  const enqueueMany = useCallback(async (ops) => {
    if (!ops.length) return { synced: true };
    // 형식이 틀린 작업은 보관 목록을 다시 읽을 때 걸러져 조용히 사라지므로, 넣기 전에 막고 알림
    if (ops.some((o) => !isValidOp(o))) {
      throw Object.assign(new Error('저장할 수 없는 값이 있어요. 입력값을 확인해 주세요.'), { code: 'invalid_op' });
    }
    markOwn(ops.filter((o) => o.kind === 'upsert' || o.kind === 'item').map((o) => o.id));
    let q = getQ();
    for (const op of ops) q = coalesce(q, withBase(op, q, serverRef.current._ver, serverRef.current));
    setQ(q);
    await flush();
    const errs = ops.map((o) => failed.current.get(o.opId)).filter(Boolean);
    ops.forEach((o) => failed.current.delete(o.opId));
    if (errs.length) throw errs[0];
    const left = getQ();
    return { synced: !ops.some((o) => hasPendingFor(left, o)) };
  }, [getQ, setQ, flush]);

  /** 로그아웃 전에 호출: 이 기기에서 해당 사용자의 내역 캐시와 보낼 목록을 지움 */
  const clearLocalData = useCallback(() => {
    if (!userId) return;
    clearUserData(userId);
    memQueue.current = [];
    setQueue([]);
  }, [userId]);

  const view = useMemo(() => applyQueue(server, queue), [server, queue]);
  const viewRef = useRef(view);
  viewRef.current = view;

  // opts.base: 수정 창을 열 때 본 버전 (verOf). 주면 창을 연 뒤 다른 기기가 고친 것도 충돌로 알 수 있음
  const saveTx = useCallback((id, data, opts = {}) => enqueue({ opId: newId(), kind: 'upsert', id, data, ...(opts.base !== undefined ? { base: opts.base } : {}) }), [enqueue]);
  /** 지금 이 내역(물품)의 "본 버전": 아직 못 올린 작업이 있으면 그 작업이 본 버전, 아니면 서버 버전 (모르면 undefined) */
  const verOf = useCallback((kind, id) => {
    const probe = { kind, id };
    const p = getQ().find((o) => sameTarget(o, probe));
    if (p) return p.base;
    const v = serverRef.current._ver;
    return v ? (v[verKey(probe)] ?? null) : undefined;
  }, [getQ]);
  /** 충돌로 저장하지 않은 작업을 최신 버전 기준으로 다시 저장 ("내 것으로 저장"·"다시 살리기"·"그래도 지우기") */
  const retryConflict = useCallback((c) => {
    const { opId: _o, base: _b, soft: _s, ...rest } = c.op;
    return enqueue({ ...rest, opId: newId() });
  }, [enqueue]);

  const deleteTx = useCallback(async (id, opts = {}) => {
    const prev = viewRef.current.tx[id];
    const result = await enqueue({ opId: newId(), kind: 'delete', id, ...(opts.base !== undefined ? { base: opts.base } : {}) });
    return { prev, ...result };
  }, [enqueue]);

  const saveSetting = useCallback((kind, value) => enqueue({ opId: newId(), kind, value }), [enqueue]);
  const saveBudget = useCallback((value) => saveSetting('budget', value), [saveSetting]);
  const saveMembers = useCallback((value) => saveSetting('members', value), [saveSetting]);

  /**
   * 카테고리 목록 저장. renames = [{ type, from, to }] 이면 그 카테고리의 기존 내역·반복 규칙·카테고리별 예산도 함께 바꿈.
   * 내역은 건마다 보내지 않고 이름 변경 작업 하나(renameCat)로 보내서, 내역이 수백 건이어도 요청은 1번.
   */
  const saveCategories = useCallback((categories, renames = []) => {
    const v = viewRef.current;
    const ops = [{ opId: newId(), kind: 'categories', value: categories }];
    if (renames.length) {
      const map = (type, name) => renames.find((r) => r.type === type && r.from === name)?.to ?? name;
      ops.push(...renameOps(renames));
      // 아직 못 보낸 내역 저장: 새 이름으로 고친 뒤 이름 변경 작업 "뒤로" 옮김.
      // (앞에 두면 먼저 올라간 뒤 이름 변경에 한 번 더 걸려서, 맞바꾸기 때 원래 이름으로 되돌아감)
      const keep = [];
      const moved = [];
      for (const o of getQ()) {
        const to = o.kind === 'upsert' ? map(o.data.type, o.data.category) : null;
        if (to != null && to !== o.data.category) moved.push({ ...o, data: { ...o.data, category: to } });
        else keep.push(o);
      }
      if (moved.length) setQ(keep);
      // 카테고리 이름을 저장해 두는 다른 곳도 함께: 반복 내역·카테고리별 예산·즐겨찾기·장보기 물품
      const rec = v.recurring.map((r) => ({ ...r, category: map(r.type, r.category) }));
      if (rec.some((r, i) => r.category !== v.recurring[i].category)) ops.push({ opId: newId(), kind: 'recurring', value: rec });
      const cb = Object.fromEntries(Object.entries(v.catBudgets).map(([k, amt]) => [map('expense', k), amt]));
      if (Object.keys(cb).join() !== Object.keys(v.catBudgets).join()) ops.push({ opId: newId(), kind: 'catBudgets', value: cb });
      const fav = v.favorites.map((f) => ({ ...f, category: map(f.type, f.category) }));
      if (fav.some((f, i) => f.category !== v.favorites[i].category)) ops.push({ opId: newId(), kind: 'favorites', value: fav });
      for (const [id, it] of Object.entries(v.items || {})) {
        const to = map('expense', it.category);
        if (to !== it.category) ops.push({ opId: newId(), kind: 'item', id, data: { ...it, category: to } });
      }
      ops.push(...moved);
    }
    return enqueueMany(ops);
  }, [enqueueMany, getQ, setQ]);

  /**
   * 백업 복원 (lib/backup.js 의 planRestore 결과). 인터넷 연결 필요.
   * 내역·장보기는 DB 함수 restore_backup(014)으로 300건씩 → 요청 수가 적고, 변경 기록·알림이 내역마다 쌓이지 않음.
   * 설정은 평소처럼 보관 목록으로 (몇 개뿐). 끝나면 서버에서 다시 불러옴.
   * 014 전이면 { code: 'need014' } 오류.
   */
  const restoreBackup = useCallback(async ({ tx = [], items = [], settings = [] }, { overwrite = false, onProgress } = {}) => {
    if (!userId || !supabase) throw Object.assign(new Error('로그인이 필요해요'), { code: 'auth' });
    if (navigator.onLine === false) throw Object.assign(new Error('인터넷 연결이 필요해요'), { code: 'offline' });
    const CHUNK = 300;
    const txRows = tx.map(([id, t]) => { const r = toRow(id, userId, t, 0, null); delete r.user_id; return r; });
    const itemRows = items.map(([id, i]) => { const r = toItemRow(id, userId, i, null); delete r.user_id; return r; });
    const total = txRows.length + itemRows.length;
    const sum = { tx_added: 0, tx_updated: 0, tx_skipped: 0, items_added: 0, items_updated: 0, items_skipped: 0 };
    let done = 0;
    onProgress?.(0, total);
    const call = async (pTx, pItems) => {
      const { data, error: e } = await withTimeout(Promise.resolve(
        supabase.rpc('restore_backup', { p_tx: pTx, p_items: pItems, p_overwrite: !!overwrite })), 30000);
      if (e) {
        if (isMissingFn(e)) {
          setSchemaNeed((n) => (!n || n > '014' ? '014' : n));
          throw Object.assign(new Error('DB 업데이트(014)가 필요해요'), { code: 'need014' });
        }
        throw e;
      }
      for (const k of Object.keys(sum)) sum[k] += Number(data?.[k]) || 0;
      done += pTx.length + pItems.length;
      onProgress?.(done, total);
    };
    for (let i = 0; i < txRows.length; i += CHUNK) await call(txRows.slice(i, i + CHUNK), []);
    for (let i = 0; i < itemRows.length; i += CHUNK) await call([], itemRows.slice(i, i + CHUNK));
    if (settings.length) await enqueueMany(settings.map(({ kind, value }) => ({ opId: newId(), kind, value })));
    await load();
    return { ...sum, settings: settings.length };
  }, [userId, enqueueMany, load]);

  // ---- 장보기 ----
  const saveItem = useCallback((id, data) => enqueue({ opId: newId(), kind: 'item', id, data }), [enqueue]);
  const deleteItems = useCallback((ids) => enqueueMany(ids.map((id) => ({ opId: newId(), kind: 'itemDel', id }))), [enqueueMany]);
  const updateItems = useCallback((list) => enqueueMany(list.map(({ id, data }) => ({ opId: newId(), kind: 'item', id, data }))), [enqueueMany]);
  /**
   * 결제 확정: 가계부 내역 + 물품 '구매 완료'를 한 번에 목록에 넣음.
   * 내역 ID가 고정이라 재전송·두 번 누르기에도 가계부에는 한 번만 기록됨 (lib/shopping.js 참고).
   */
  const confirmPurchase = useCallback((itemIds, opts) => {
    const v = viewRef.current;
    const items = itemIds.map((id) => (v.items[id] ? { id, ...v.items[id] } : null)).filter((i) => i && i.status === 'todo');
    if (!items.length) return Promise.resolve({ synced: true, count: 0 });
    const plan = planPurchase(items, { purchaseId: newId(), ...opts });
    const strip = ({ id: _omit, ...rest }) => rest;
    const ops = [
      ...plan.txs.map(({ id, data }) => ({ opId: newId(), kind: 'upsert', id, data })),
      ...plan.items.map(({ id, data }) => ({ opId: newId(), kind: 'item', id, data: strip(data) })),
    ];
    return enqueueMany(ops).then((r) => ({ ...r, count: plan.txs.length }));
  }, [enqueueMany]);

  // ---- 반복 내역 자동 등록 ----
  // 이번 접속에서 서버 데이터를 받은 뒤에만 실행 (오래된 캐시 기준으로 지운 내역을 다시 만들지 않도록).
  // 등록 후 규칙의 last가 올라가므로 이 효과가 다시 돌아도 같은 달을 또 만들지 않음.
  const recurringKey = JSON.stringify(view.recurring);
  // 날짜가 바뀌면(자정, 잠들었던 기기가 깨어남) 먼저 서버 데이터를 새로 받고 나서 판단.
  // 어제 받은 데이터로 바로 만들면, 그사이 다른 기기가 이미 기록하고 고친(또는 지운) 이번 달 내역을 옛 값으로 덮어씀
  useEffect(() => {
    if (userId && serverLoaded && loadedDay && loadedDay !== today) load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);
  useEffect(() => {
    if (!userId || !serverLoaded || loadedFor.current !== userId) return; // 전환 직후엔 아직 이전 가계부 상태
    if (loadedDay !== today) return; // 오늘 받은 서버 데이터가 아직 없음 (위에서 받는 중)
    const plan = planRecurring(viewRef.current.recurring, new Date());
    if (!plan.changed) return;
    // soft: 다른 기기가 먼저 기록·수정했으면(017 충돌) 조용히 빼고, 최신 내용을 받은 뒤 다시 판단
    // 같은 규칙의 다른 달 내역을 사용자가 이 달로 옮겨 둔 경우(날짜 수정)는 이 달 몫이 이미 있는 것으로 봄 → 한 달에 두 번 X
    const txs = Object.entries(viewRef.current.tx);
    const already = ({ id, data }) => txs.some(([tid, t]) => tid !== id && tid.length === id.length
      && tid.startsWith(id.slice(0, -7)) && t.date?.slice(0, 7) === data.date.slice(0, 7));
    const ops = plan.txs.filter((x) => !already(x)).map(({ id, data }) => ({ opId: newId(), kind: 'upsert', id, data, soft: true }));
    ops.push({ opId: newId(), kind: 'recurring', value: plan.rules, soft: true });
    enqueueMany(ops).catch(() => {});
  }, [userId, serverLoaded, loadedDay, recurringKey, today, enqueueMany]);

  return {
    tx: view.tx,
    budget: view.budget,
    members: view.members,
    items: view.items,
    recurring: view.recurring,
    categories: view.categories,
    catBudgets: view.catBudgets,
    cards: view.cards,
    favorites: view.favorites,
    dismissedSubs: view.dismissedSubs,
    schemaOutdated,
    schemaNeed,
    thisMonth: ymOf(new Date(today)),
    status,
    serverLoaded,
    retryConflict,
    verOf,
    error,
    online,
    syncing,
    pendingCount: queue.length,
    storageFull,
    clearLocalData,
    saveTx,
    deleteTx,
    saveBudget,
    saveMembers,
    saveSetting,
    saveCategories,
    restoreBackup,
    saveItem,
    updateItems,
    deleteItems,
    confirmPurchase,
    reload: load,
    syncNow: flush,
  };
}
