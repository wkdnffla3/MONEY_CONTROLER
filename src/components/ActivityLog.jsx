import { useCallback, useEffect, useState } from 'react';
import { PAGE, describe, fetchActivity } from '../lib/activity';
import { isSchemaError } from '../lib/outbox';
import { koError } from '../lib/errors';

const dayLabel = (iso) => {
  const d = new Date(iso);
  const t = new Date();
  const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (key(d) === key(t)) return '오늘';
  if (key(d) === key(y)) return '어제';
  return `${d.getMonth() + 1}월 ${d.getDate()}일${d.getFullYear() !== t.getFullYear() ? ` (${d.getFullYear()})` : ''}`;
};
const timeOf = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/**
 * 변경 기록: 누가 언제 무엇을 추가·수정·삭제했는지. 지운 내역 되살리기, 수정 전으로 되돌리기.
 * 기록은 90일 동안 보관돼요.
 */
export default function ActivityLog({ ledgerId, uid, people, members, cards, tx, items, online, onRestore }) {
  const [entries, setEntries] = useState([]);
  const [state, setState] = useState('loading'); // loading | ok | error | unsupported
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [filter, setFilter] = useState('all');
  const [confirm, setConfirm] = useState(null);
  const [restored, setRestored] = useState(() => new Set());

  const load = useCallback(async (before) => {
    if (!before) setState('loading');
    try {
      const rows = await fetchActivity(ledgerId, before);
      setEntries((prev) => (before ? [...prev, ...rows] : rows));
      setDone(rows.length < PAGE);
      setState('ok');
    } catch (e) {
      if (isSchemaError(e)) { setState('unsupported'); return; }
      setError(koError(e));
      setState('error');
    }
  }, [ledgerId]);
  useEffect(() => { load(); }, [load]);

  if (state === 'unsupported') {
    return <div className="notice show"><b>DB 업데이트가 필요해요.</b> Supabase SQL Editor에서 <code>supabase/010_history_comments.sql</code>을 실행하면 그때부터 기록돼요.</div>;
  }
  if (state === 'loading') return <p className="hint">불러오는 중…</p>;
  if (state === 'error') {
    return (
      <div className="form">
        <p className="hint">{online ? `기록을 불러오지 못했어요: ${error}` : '변경 기록은 인터넷에 연결돼 있을 때 볼 수 있어요.'}</p>
        <button type="button" className="btn" onClick={() => load()}>다시 시도</button>
      </div>
    );
  }

  const ctx = { uid, people, members, cards, txExists: (id) => !!tx[id], itemExists: (id) => !!items[id] };
  const shown = entries
    .filter((e) => filter === 'all' || (filter === 'tx' ? e.table_name === 'transactions' : e.table_name === 'shopping_items'))
    .map((e) => ({ e, d: describe(e, ctx) }))
    .filter((x) => x.d);
  const groups = [];
  for (const x of shown) {
    const label = dayLabel(x.e.created_at);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, rows: [] });
    groups[groups.length - 1].rows.push(x);
  }

  const doRestore = async (e, kind) => {
    setConfirm(null);
    const ok = await onRestore(e, kind);
    if (ok) setRestored((s) => new Set(s).add(e.id));
  };

  return (
    <div className="activity">
      <div className="chips" role="group" aria-label="보기">
        {[['all', '전체'], ['tx', '가계부'], ['shop', '장보기']].map(([k, l]) => (
          <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {!groups.length && <p className="hint">아직 기록이 없어요. 내역을 추가·수정·삭제하면 여기에 남아요.</p>}
      {groups.map((g) => (
        <section key={g.label} className="act-day">
          <h4>{g.label}</h4>
          <ul>
            {g.rows.map(({ e, d }) => (
              <li key={e.id} className={`act act-${e.action}`}>
                <div className="act-head">
                  <span className="act-who">{d.who}</span>
                  <span className="act-verb">{d.verb}</span>
                  <time>{timeOf(e.created_at)}</time>
                </div>
                <div className="act-sum">{d.summary}{d.date ? <small> · {d.date.slice(5).replace('-', '/')}</small> : null}</div>
                {d.diffs.length > 0 && (
                  <ul className="act-diffs">
                    {d.diffs.map((x) => <li key={x.label}><b>{x.label}</b> {x.from} → {x.to}</li>)}
                  </ul>
                )}
                {d.restore && !restored.has(e.id) && (confirm === e.id ? (
                  <div className="act-actions">
                    <button type="button" className="btn sm" onClick={() => setConfirm(null)}>취소</button>
                    <button type="button" className="btn primary sm" onClick={() => doRestore(e, d.restore)}>
                      {d.restore === 'restore' ? '되살리기' : '이 수정 전으로 되돌리기'}
                    </button>
                  </div>
                ) : (
                  <div className="act-actions">
                    <button type="button" className="btn sm" onClick={() => setConfirm(e.id)}>
                      {d.restore === 'restore' ? '↩ 되살리기' : '↩ 이전으로'}
                    </button>
                  </div>
                ))}
                {restored.has(e.id) && <p className="hint ok-mark">✓ 되돌렸어요</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!done && entries.length > 0 && <button type="button" className="btn" onClick={() => load(entries[entries.length - 1].id)}>더 보기</button>}
      <p className="hint">최근 90일 기록이 보관돼요. 기록은 DB가 자동으로 남겨서 앱에서 지우거나 고칠 수 없어요.</p>
    </div>
  );
}
