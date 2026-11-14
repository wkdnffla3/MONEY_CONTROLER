import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRemember, supabase } from '../lib/supabase';
import {
  EMPTY_STATE, SETTINGS, applyQueue, clearUserData, coalesce, isRetryable, isSchemaError, newId, queueStorageKey, readCache,
  readQueue, removeOp, sameTarget, sanitizeSetting, writeCache, writeQueue,
} from '../lib/outbox';
import { planRecurring, ymOf } from '../lib/recurring';
import { planPurchase } from '../lib/shopping';
import { useOnline } from './useOnline';
import { getDeviceId, isOwn, markOwn } from '../lib/device';

export { newId };

const fromRow = (r) => ({
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

const fromItemRow = (r) => ({
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

export function useLedger(userId, { onRemote } = {}) {
  const online = useOnline();
  const onRemoteRef = useRef(onRemote);
  onRemoteRef.current = onRemote;
  const deviceColRef = useRef(true); // device_id 칸이 있는지 (없으면 빼고 보냄)
  const [server, setServer] = useState(EMPTY_STATE); // 서버(또는 캐시)에서 받은 상태 { tx, budget, members }
  const [schemaOutdated, setSchemaOutdated] = useState(false); // DB 업데이트(003/004) 필요
  const [serverLoaded, setServerLoaded] = useState(false);     // 이번 접속에서 서버 데이터를 한 번 이상 받았는지
  const [today, setToday] = useState(() => new Date().toDateString()); // 날짜가 바뀌면 반복 내역 확인
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
    let txRes, stRes, itRes, txLevel = 0, setLevel = 0, noItemsTable = false;
    try {
      // 내역: member_id 칸이 없으면(003 전) 예전 칸만으로
      const loadTx = async () => {
        let r;
        for (let i = 0; i < TX_COL_SETS.length; i += 1) {
          r = await supabase.from('transactions').select(TX_COL_SETS[i]);
          if (!isSchemaError(r.error)) { txLevel = i; return r; }
        }
        return r;
      };
      // 설정: 최신 칸 묶음부터 시도
      const loadSettings = async () => {
        for (let i = 0; i < SETTINGS_COL_SETS.length; i += 1) {
          const r = await supabase.from('settings').select(SETTINGS_COL_SETS[i].join(',')).maybeSingle();
          if (!isSchemaError(r.error)) { setLevel = i; return r; }
        }
        return { data: null, error: null };
      };
      // 장보기: 테이블이 없으면(005 전) 기기에 있던 목록을 그대로 둠
      const loadItems = async () => {
        const r = await supabase.from('shopping_items').select(ITEM_COLS);
        if (isSchemaError(r.error)) { noItemsTable = true; return { data: null, error: null }; }
        return r;
      };
      [txRes, stRes, itRes] = await Promise.all([loadTx(), loadSettings(), loadItems()]);
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
    setSchemaOutdated(txLevel > 0 || setLevel > 0 || noItemsTable);
    const items = itRes?.data && !itRes.error
      ? Object.fromEntries(itRes.data.map((r) => [r.id, fromItemRow(r)]))
      : serverRef.current.items || {}; // 못 받았으면 기존 목록 유지
    const next = { ...EMPTY_STATE, tx: Object.fromEntries(txRes.data.map((r) => [r.id, fromRow(r)])), items };
    for (const [col, val] of Object.entries(stRes?.data || {})) {
      const kind = KIND_BY_COLUMN[col];
      if (kind) next[kind] = sanitizeSetting(kind, kind === 'budget' ? Number(val) || 0 : val);
    }
    // 불러오는 사이에 전송이 끝난 작업은 응답에 빠져 있을 수 있으니 덧씌움
    const late = sentLog.current.filter((x) => x.at >= startedAt).map((x) => x.op);
    updateServer(applyQueue(next, late));
    setError(null);
    setStatus('ok');
    setServerLoaded(true);
  }, [userId, updateServer]);

  // ---- 작업 하나 전송 ----
  const send = useCallback(async (op) => {
    try {
      let req;
      if (op.kind === 'upsert') req = supabase.from('transactions').upsert(toRow(op.id, userId, op.data, legacyRef.current, deviceColRef.current && getDeviceId()));
      else if (op.kind === 'delete') req = supabase.from('transactions').delete().eq('id', op.id);
      else if (op.kind === 'item') req = supabase.from('shopping_items').upsert(toItemRow(op.id, userId, op.data, deviceColRef.current && getDeviceId()));
      else if (op.kind === 'itemDel') req = supabase.from('shopping_items').delete().eq('id', op.id);
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
      if (!sess?.session || sess.session.user?.id !== userId) {
        scheduleRetry(() => flushRef.current());
        return;
      }
      // DB 업데이트 전이라 지금은 못 보내는 작업(사람 지정 내역, 사람 목록)은 건너뛰고 나머지를 계속 보냄.
      // 서로 다른 대상끼리는 순서가 상관없고, 같은 대상은 목록에 하나만 있으므로 건너뛰어도 안전.
      const skipped = new Set();
      for (;;) {
        const op = getQ().find((o) => !skipped.has(o.opId));
        if (!op) break;
        const { error: e } = await send(op);
        if (e) {
          // device_id 칸만 없는 거면(007 전) 그 칸을 빼고 바로 다시 보냄 — 알림만 덜 정확해질 뿐 저장엔 문제없음
          if (isDeviceColError(e) && deviceColRef.current) { deviceColRef.current = false; continue; }
          if (isSchemaError(e)) {
            setSchemaOutdated(true);
            // 내역 저장이 member_id 때문에 실패했다면 예전 형식으로 한 번 더 (사람 없는 내역은 이걸로 저장됨)
            if (op.kind === 'upsert' && legacyRef.current < 2) { legacyRef.current += 1; continue; }
            skipped.add(op.opId); // 업데이트되면 다음 시도에 올라감
            continue;
          }
          if (isRetryable(e)) {
            scheduleRetry(() => flushRef.current());
            return;
          }
          // 다시 보내도 실패할 작업 → 목록에서 빼고 알림
          failed.current.set(op.opId, e);
          setQ(removeOp(getQ(), op.opId));
          droppedAny = true;
          continue;
        }
        setQ(removeOp(getQ(), op.opId));
        updateServer(applyQueue(serverRef.current, [op]));
        const now = Date.now();
        sentLog.current = [...sentLog.current.filter((x) => now - x.at < 60000), { at: now, op }];
      }
      if (skipped.size) {
        scheduleRetry(() => flushRef.current()); // DB가 업데이트되면 다음 시도에 올라감
      } else {
        retryStep.current = 0;
        clearTimeout(retryTimer.current);
      }
      if (droppedAny) await load();
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
    const onChange = (table) => (payload) => {
      load();
      const n = remoteInsert(table, payload);
      if (n) { try { onRemoteRef.current?.(n); } catch { /* 알림 실패가 동기화를 막지 않게 */ } }
    };
    const channel = supabase
      .channel(`ledger-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter }, onChange('transactions'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter }, onChange('shopping_items'))
      .subscribe();

    const onVisible = () => {
      if (document.hidden) return;
      setToday(new Date().toDateString());
      load(); flushRef.current();
    };
    const dayTimer = setInterval(() => setToday(new Date().toDateString()), 60 * 60 * 1000);
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
      clearInterval(dayTimer);
      supabase.removeChannel(channel);
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
  const enqueue = useCallback(async (op) => {
    if (op.kind === 'upsert' || op.kind === 'item') markOwn([op.id]);
    setQ(coalesce(getQ(), op));
    await flush();
    const err = failed.current.get(op.opId);
    if (err) { failed.current.delete(op.opId); throw err; }
    // 같은 내역에 대한 작업이 하나도 안 남아야 "서버까지 올라감"
    return { synced: !hasPendingFor(getQ(), op) };
  }, [getQ, setQ, flush]);

  /** 여러 작업을 한 번에 목록에 넣고 한 번만 전송 (카테고리 이름 변경, 반복 내역 등록 등) */
  const enqueueMany = useCallback(async (ops) => {
    if (!ops.length) return { synced: true };
    markOwn(ops.filter((o) => o.kind === 'upsert' || o.kind === 'item').map((o) => o.id));
    let q = getQ();
    for (const op of ops) q = coalesce(q, op);
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

  const saveTx = useCallback((id, data) => enqueue({ opId: newId(), kind: 'upsert', id, data }), [enqueue]);

  const deleteTx = useCallback(async (id) => {
    const prev = viewRef.current.tx[id];
    const result = await enqueue({ opId: newId(), kind: 'delete', id });
    return { prev, ...result };
  }, [enqueue]);

  const saveSetting = useCallback((kind, value) => enqueue({ opId: newId(), kind, value }), [enqueue]);
  const saveBudget = useCallback((value) => saveSetting('budget', value), [saveSetting]);
  const saveMembers = useCallback((value) => saveSetting('members', value), [saveSetting]);

  /**
   * 카테고리 목록 저장. renames = [{ type, from, to }] 이면 그 카테고리의 기존 내역·반복 규칙·카테고리별 예산도 함께 바꿈.
   * 내역은 ID별로 upsert라 여러 번 보내져도 중복되지 않음.
   */
  const saveCategories = useCallback((categories, renames = []) => {
    const v = viewRef.current;
    const ops = [{ opId: newId(), kind: 'categories', value: categories }];
    if (renames.length) {
      const map = (type, name) => renames.find((r) => r.type === type && r.from === name)?.to ?? name;
      for (const [id, t] of Object.entries(v.tx)) {
        const to = map(t.type, t.category);
        if (to !== t.category) ops.push({ opId: newId(), kind: 'upsert', id, data: { ...t, category: to } });
      }
      const rec = v.recurring.map((r) => ({ ...r, category: map(r.type, r.category) }));
      if (rec.some((r, i) => r.category !== v.recurring[i].category)) ops.push({ opId: newId(), kind: 'recurring', value: rec });
      const cb = Object.fromEntries(Object.entries(v.catBudgets).map(([k, amt]) => [map('expense', k), amt]));
      if (Object.keys(cb).join() !== Object.keys(v.catBudgets).join()) ops.push({ opId: newId(), kind: 'catBudgets', value: cb });
    }
    return enqueueMany(ops);
  }, [enqueueMany]);

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
  useEffect(() => {
    if (!userId || !serverLoaded) return;
    const plan = planRecurring(viewRef.current.recurring, new Date());
    if (!plan.changed) return;
    const ops = plan.txs.map(({ id, data }) => ({ opId: newId(), kind: 'upsert', id, data }));
    ops.push({ opId: newId(), kind: 'recurring', value: plan.rules });
    enqueueMany(ops).catch(() => {});
  }, [userId, serverLoaded, recurringKey, today, enqueueMany]);

  return {
    tx: view.tx,
    budget: view.budget,
    members: view.members,
    items: view.items,
    recurring: view.recurring,
    categories: view.categories,
    catBudgets: view.catBudgets,
    cards: view.cards,
    schemaOutdated,
    thisMonth: ymOf(new Date(today)),
    status,
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
    saveItem,
    updateItems,
    deleteItems,
    confirmPurchase,
    reload: load,
    syncNow: flush,
  };
}
