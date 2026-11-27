import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../lib/fetchAll';
import { isSchemaError, newId } from '../lib/outbox';

const COLS = 'id,tx_id,author,author_name,body,created_at';
const sortByTime = (a, b) => String(a.created_at).localeCompare(String(b.created_at));

/**
 * 내역 댓글 (온라인 전용 — 오프라인에서는 읽기만 마지막 상태로).
 * 실시간으로 다른 사람의 댓글을 받고, 다른 사람이 쓴 새 댓글은 onRemote 로 알림에 넘김.
 */
export function useComments(ledgerId, uid, { onRemote } = {}) {
  const [list, setList] = useState([]);
  const [supported, setSupported] = useState(true);
  const onRemoteRef = useRef(onRemote);
  onRemoteRef.current = onRemote;
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!ledgerId || !supabase) return;
    const my = ++seq.current;
    const { data, error } = await fetchAll(() => supabase.from('tx_comments').select(COLS).eq('user_id', ledgerId));
    if (my !== seq.current) return;
    if (error) { if (isSchemaError(error)) setSupported(false); return; }
    setSupported(true);
    setList((data || []).slice().sort(sortByTime));
  }, [ledgerId]);

  useEffect(() => {
    setList([]);
    if (!ledgerId || !supabase) return undefined;
    load();
    const channel = supabase
      .channel(`comments-${ledgerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tx_comments', filter: `user_id=eq.${ledgerId}` }, (p) => {
        if (p?.eventType === 'INSERT' && p.new?.id) {
          setList((l) => (l.some((c) => c.id === p.new.id) ? l : [...l, p.new].sort(sortByTime)));
          if (p.new.author !== uid) { try { onRemoteRef.current?.({ table: 'tx_comments', type: 'INSERT', record: p.new }); } catch { /* 무시 */ } }
        }
      })
      // 삭제 알림은 id만 실려 와서 user_id 필터 구독엔 오지 않음(Supabase 제한) → 삭제만 필터 없이 따로 받아 내 목록에 있으면 뺌
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tx_comments' }, (p) => {
        if (p?.old?.id) setList((l) => (l.some((c) => c.id === p.old.id) ? l.filter((c) => c.id !== p.old.id) : l));
      })
      .subscribe();
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible); // 끊겼다 다시 연결되면 그사이 놓친 댓글도
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onVisible); };
  }, [ledgerId, uid, load]);

  const byTx = useMemo(() => {
    const m = {};
    for (const c of list) (m[c.tx_id] = m[c.tx_id] || []).push(c);
    return m;
  }, [list]);
  const counts = useMemo(() => Object.fromEntries(Object.entries(byTx).map(([k, v]) => [k, v.length])), [byTx]);

  /** 댓글 쓰기 — 화면에 먼저 보이고, 실패하면 되돌림 */
  const add = useCallback(async (txId, body, authorName) => {
    const row = { id: newId(), user_id: ledgerId, tx_id: txId, author_name: String(authorName || '나').slice(0, 20), body: body.trim().slice(0, 300) };
    const local = { ...row, author: uid, created_at: new Date().toISOString() };
    setList((l) => [...l, local]);
    const { error } = await supabase.from('tx_comments').insert(row);
    if (error) { setList((l) => l.filter((c) => c.id !== row.id)); throw error; }
  }, [ledgerId, uid]);

  const remove = useCallback(async (id) => {
    let gone = null;
    setList((l) => { gone = l.find((c) => c.id === id) || gone; return l.filter((c) => c.id !== id); });
    const { error } = await supabase.from('tx_comments').delete().eq('id', id);
    // 실패하면 지운 댓글만 되돌림 (그사이 들어온 다른 댓글은 그대로)
    if (error) { if (gone) setList((l) => (l.some((c) => c.id === id) ? l : [...l, gone].sort(sortByTime))); throw error; }
  }, []);

  return { byTx, counts, supported, add, remove, reload: load };
}
