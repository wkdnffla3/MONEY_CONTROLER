import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

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

/**
 * 로그인한 사용자의 내역과 예산.
 * - 화면에 먼저 반영하고(낙관적 업데이트) 저장이 실패하면 되돌림
 * - 다른 기기의 변경은 Supabase Realtime으로 실시간 반영
 */
export function useLedger(userId) {
  const [tx, setTx] = useState({});          // { [id]: transaction }
  const [budget, setBudget] = useState(0);
  const [status, setStatus] = useState('idle'); // idle | loading | ok | error
  const [error, setError] = useState(null);
  const txRef = useRef(tx);
  txRef.current = tx;
  const budgetRef = useRef(budget);
  budgetRef.current = budget;

  const load = useCallback(async () => {
    if (!userId || !supabase) return;
    setStatus((s) => (s === 'ok' ? 'ok' : 'loading'));
    const [txRes, stRes] = await Promise.all([
      supabase.from('transactions').select('id,type,amount,category,memo,date,created_at'),
      supabase.from('settings').select('budget').maybeSingle(),
    ]);
    if (txRes.error) {
      setError(txRes.error);
      setStatus('error');
      return;
    }
    setError(null);
    setTx(Object.fromEntries(txRes.data.map((r) => [r.id, fromRow(r)])));
    setBudget(stRes.data ? Number(stRes.data.budget) || 0 : 0);
    setStatus('ok');
  }, [userId]);

  useEffect(() => {
    if (!userId || !supabase) {
      setTx({}); setBudget(0); setStatus('idle'); setError(null);
      return undefined;
    }
    load();
    const filter = `user_id=eq.${userId}`;
    const channel = supabase
      .channel(`ledger-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter }, load)
      .subscribe();
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, load]);

  const saveTx = useCallback(async (id, data) => {
    const prev = txRef.current[id];
    setTx((cur) => ({ ...cur, [id]: data }));
    const { error: e } = await supabase.from('transactions').upsert(toRow(id, userId, data));
    if (e) {
      setTx((cur) => {
        const next = { ...cur };
        if (prev) next[id] = prev; else delete next[id];
        return next;
      });
      throw e;
    }
  }, [userId]);

  const deleteTx = useCallback(async (id) => {
    const prev = txRef.current[id];
    setTx((cur) => { const next = { ...cur }; delete next[id]; return next; });
    const { error: e } = await supabase.from('transactions').delete().eq('id', id);
    if (e) {
      if (prev) setTx((cur) => ({ ...cur, [id]: prev }));
      throw e;
    }
    return prev;
  }, []);

  const saveBudget = useCallback(async (value) => {
    const prev = budgetRef.current;
    setBudget(value);
    const { error: e } = await supabase.from('settings').upsert({ user_id: userId, budget: value });
    if (e) { setBudget(prev); throw e; }
  }, [userId]);

  return { tx, budget, status, error, saveTx, deleteTx, saveBudget, reload: load };
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
