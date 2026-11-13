import { useMemo } from 'react';
import { SearchIcon } from './Icons';
import { iconOf, useCategories } from '../lib/categories';
import { isRecurringTxId } from '../lib/recurring';
import { isShoppingTxId } from '../lib/shopping';
import { findMember, memberColor } from '../lib/members';
import { WEEKDAYS, sumByType, todayStr, won } from '../lib/format';

const FILTERS = [['all', '전체'], ['expense', '지출'], ['income', '수입']];

export default function TxList({ items, filter, onFilter, query, onQuery, onOpen, members = [] }) {
  const visible = useMemo(() => {
    let list = items;
    if (filter !== 'all') list = list.filter((t) => (t.type === 'income') === (filter === 'income'));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((t) => (t.memo || '').toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q)
      || (findMember(members, t.memberId)?.name || '').toLowerCase().includes(q));
    return [...list].sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
  }, [items, filter, query, members]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const t of visible) {
      if (!m.has(t.date)) m.set(t.date, []);
      m.get(t.date).push(t);
    }
    return [...m.entries()];
  }, [visible]);

  const today = todayStr();
  const cats = useCategories();

  return (
    <section className="card" aria-label="내역">
      <h2>내역 {visible.length > 0 && <span style={{ fontWeight: 500, fontSize: 12.5 }}>{visible.length}건</span>}</h2>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="유형 필터">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => onFilter(key)}>{label}</button>
          ))}
        </div>
        <label className="search">
          <span className="sr">검색</span>
          <SearchIcon />
          <input type="search" placeholder={members.length ? "메모·카테고리·이름 검색" : "메모·카테고리 검색"} value={query} onChange={(e) => onQuery(e.target.value)} />
        </label>
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          <div className="big">{items.length ? '🔍' : '🧾'}</div>
          <p>{items.length ? '조건에 맞는 내역이 없어요.' : <>이 달의 내역이 아직 없어요.<br />첫 수입이나 지출을 기록해 보세요.</>}</p>
        </div>
      ) : groups.map(([date, rows]) => {
        const d = new Date(`${date}T00:00:00`);
        const s = sumByType(rows);
        const label = date === today ? '오늘' : `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
        return (
          <div className="day-group" key={date}>
            <div className="day-head">
              <span>{label}</span>
              <span className="num">
                {s.inc > 0 && <span style={{ color: 'var(--income)' }}>+{won(s.inc)} </span>}
                {s.exp > 0 && `-${won(s.exp)}`}
              </span>
            </div>
            {rows.map((t) => {
              const isInc = t.type === 'income';
              return (
                <div
                  key={t.id}
                  className="tx"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(t.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(t.id); } }}
                >
                  <div className="ic" style={{ background: isInc ? 'var(--income-soft)' : 'var(--surface-2)' }}>
                    {iconOf(cats, isInc ? 'income' : 'expense', t.category)}
                  </div>
                  <div className="meta">
                    <div className="cat">{t.category}{isRecurringTxId(t.id) && <span className="rec-mark" title="반복 내역으로 자동 등록">🔁</span>}{isShoppingTxId(t.id) && <span className="rec-mark" title="장보기에서 결제 확정">🛒</span>}</div>
                    <div className="memo">
                      {members.length > 0 && (() => {
                        const m = findMember(members, t.memberId);
                        return <span className="who-badge"><span className="dot" style={{ background: memberColor(m) }} />{m ? m.name : '공동'}</span>;
                      })()}
                      {t.memo || (members.length ? '' : '\u00a0')}
                    </div>
                  </div>
                  <div className={`amt num ${isInc ? 'inc' : ''}`}>{isInc ? '+' : '-'}{won(t.amount)}</div>
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
