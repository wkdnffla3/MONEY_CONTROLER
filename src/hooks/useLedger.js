import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRemember, supabase } from '../lib/supabase';
import {
  applyQueue, clearUserData, coalesce, isRetryable, newId, queueStorageKey, readCache, readQueue, removeOp, writeCache, writeQueue,
} from '../lib/outbox';
import { useOnline } from './useOnline';

export { newId };

const fromRow = (r) => ({
  type: r.type,
  amount: Number(r.amount),
  category: r.category,
  memo: r.memo || '',
  date: r.date,
  createdAt: Number(r.created_at) || 0,
});

const toRow = (id, userId, t) => ({
  id,
  user_id: userId,
  type: t.type,
  amount: t.amount,
  category: t.category,
  memo: t.memo,
  date: t.date,
  created_at: t.createdAt,
});

const RETRY_DELAYS = [3000, 10000, 30000, 60000];
const SEND_TIMEOUT_MS = 10000; // 응답이 이보다 늦으면 실패로 보고 나중에 다시 보냄 (같은 ID라 중복 없음)
const LOCK_RETRY_MS = 1500;    // 다른 탭이 전송 중일 때 다시 확인하는 간격

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => resolve({ error: { message: 'timeout: 서버 응답 없음' } }), ms)),
]);

// 같은 대상(같은 내역 ID, 또는 예산)에 대한 작업이 아직 목록에 남아 있는지
const hasPendingFor = (queue, op) => queue.some((o) =>
  op.kind === 'budget' ? o.kind === 'budget' : o.kind !== 'budget' && o.id === op.id);

/**
 * 로그인한 사용자의 내역과 예산 — 오프라인 우선.
 *
 * 모든 저장은 먼저 "보낼 목록"(outbox, localStorage)에 들어가고 화면에 바로 반영된 뒤,
 * 온라인이면 즉시, 오프라인이면 연결되는 순간 순서대로 서버에 올라감.
 * 중복 방지 원리는 lib/outbox.js 맨 위 설명 참고.
 */
export function useLedger(userId) {
  const online = useOnline();
  const [server, setServer] = useState({ tx: {}, budget: 0 }); // 서버(또는 캐시)에서 받은 상태
  const [queue, setQueue] = useState([]);                       // 아직 못 보낸 작업
  const [status, setStatus] = useState('idle');                 // idle | loading | ok | error
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [storageFull, setStorageFull] = useState(false);

  const memQueue = useRef([]);         // 메모리에 둔 보낼 목록 (기기 저장이 실패해도 이 탭에서는 유지)
  const storageBroken = useRef(false); // 기기 저장소에 쓰기 실패한 적이 있으면 메모리 목록을 기준으로 함
  const serverRef = useRef({ tx: {}, budget: 0 });
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
    if (userId) writeCache(userId, next.tx, next.budget, getRemember());
  }, [userId]);

  // ---- 서버에서 불러오기 ----
  const load = useCallback(async () => {
    if (!userId || !supabase) return;
    const seq = ++loadSeq.current;
    const startedAt = Date.now();
    setStatus((s) => (s === 'ok' ? 'ok' : 'loading'));
    let txRes, stRes;
    try {
      [txRes, stRes] = await Promise.all([
        supabase.from('transactions').select('id,type,amount,category,memo,date,created_at'),
        supabase.from('settings').select('budget').maybeSingle(),
      ]);
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
    let tx = Object.fromEntries(txRes.data.map((r) => [r.id, fromRow(r)]));
    let budget = stRes?.data ? Number(stRes.data.budget) || 0 : 0;
    // 불러오는 사이에 전송이 끝난 작업은 응답에 빠져 있을 수 있으니 덧씌움
    const late = sentLog.current.filter((x) => x.at >= startedAt).map((x) => x.op);
    ({ tx, budget } = applyQueue(tx, budget, late));
    updateServer({ tx, budget });
    setError(null);
    setStatus('ok');
  }, [userId, updateServer]);

  // ---- 작업 하나 전송 ----
  const send = useCallback(async (op) => {
    try {
      let req;
      if (op.kind === 'upsert') req = supabase.from('transactions').upsert(toRow(op.id, userId, op.data));
      else if (op.kind === 'delete') req = supabase.from('transactions').delete().eq('id', op.id);
      else if (op.kind === 'budget') req = supabase.from('settings').upsert({ user_id: userId, budget: op.value });
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
      for (;;) {
        const q = getQ();
        if (!q.length) break;
        const op = q[0];
        const { error: e } = await send(op);
        if (e) {
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
        updateServer(applyQueue(serverRef.current.tx, serverRef.current.budget, [op]));
        const now = Date.now();
        sentLog.current = [...sentLog.current.filter((x) => now - x.at < 60000), { at: now, op }];
      }
      retryStep.current = 0;
      clearTimeout(retryTimer.current);
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
    if (!userId || !supabase) {
      memQueue.current = [];
      serverRef.current = { tx: {}, budget: 0 };
      setServer(serverRef.current); setQueue([]); setStatus('idle'); setError(null);
      return undefined;
    }
    const cache = readCache(userId);
    serverRef.current = cache || { tx: {}, budget: 0 };
    setServer(serverRef.current);
    memQueue.current = readQueue(userId);
    setQueue(memQueue.current);
    setStatus(cache ? 'ok' : 'loading');
    load().then(() => flushRef.current());

    const filter = `user_id=eq.${userId}`;
    const channel = supabase
      .channel(`ledger-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter }, load)
      .subscribe();

    const onVisible = () => { if (!document.hidden) { load(); flushRef.current(); } };
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
    setQ(coalesce(getQ(), op));
    await flush();
    const err = failed.current.get(op.opId);
    if (err) { failed.current.delete(op.opId); throw err; }
    // 같은 내역에 대한 작업이 하나도 안 남아야 "서버까지 올라감"
    return { synced: !hasPendingFor(getQ(), op) };
  }, [getQ, setQ, flush]);

  /** 로그아웃 전에 호출: 이 기기에서 해당 사용자의 내역 캐시와 보낼 목록을 지움 */
  const clearLocalData = useCallback(() => {
    if (!userId) return;
    clearUserData(userId);
    memQueue.current = [];
    setQueue([]);
  }, [userId]);

  const view = useMemo(() => applyQueue(server.tx, server.budget, queue), [server, queue]);
  const viewRef = useRef(view);
  viewRef.current = view;

  const saveTx = useCallback((id, data) => enqueue({ opId: newId(), kind: 'upsert', id, data }), [enqueue]);

  const deleteTx = useCallback(async (id) => {
    const prev = viewRef.current.tx[id];
    const result = await enqueue({ opId: newId(), kind: 'delete', id });
    return { prev, ...result };
  }, [enqueue]);

  const saveBudget = useCallback((value) => enqueue({ opId: newId(), kind: 'budget', value }), [enqueue]);

  return {
    tx: view.tx,
    budget: view.budget,
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
    reload: load,
    syncNow: flush,
  };
}
