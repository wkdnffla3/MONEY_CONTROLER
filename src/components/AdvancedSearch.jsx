import { useMemo, useState } from 'react';
import { searchTx } from '../lib/analysis';
import { iconOf, useCategories } from '../lib/categories';
import { downloadText } from '../lib/csv';
import { buildTxCsv } from '../lib/exportTx';
import { SHARED, SHARED_LABEL, colorVar, findMember, memberColor } from '../lib/members';
import { formatAmountInput, pad, parseAmount, todayStr, won } from '../lib/format';

import { EMPTY_FILTERS } from '../lib/searchFilters';

export { EMPTY_FILTERS };

const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function periodRange(period, from, to) {
  const now = new Date();
  if (period === '1m') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), todayStr()];
  if (period === '3m') return [iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), todayStr()];
  if (period === 'year') return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
  if (period === 'range') return [from, to];
  return ['', ''];
}
const PAGE = 100;

/**
 * 고급 검색: 기간·유형·카테고리·사람·태그·카드·금액·키워드. 결과 합계와 CSV.
 * filters/onFilters 는 App이 들고 있어서, 내역을 수정하고 돌아와도 조건이 남음.
 */
export default function AdvancedSearch({ allTx, members, cards, tags, filters, onFilters, onOpen }) {
  const cats = useCategories();
  const [shown, setShown] = useState(PAGE);
  const f = filters;
  const set = (patch) => { onFilters({ ...f, ...patch }); setShown(PAGE); };
  const toggle = (key, v) => set({ [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] });

  const [from, to] = periodRange(f.period, f.from, f.to);
  const result = useMemo(() => searchTx(allTx, {
    from, to, type: f.type, categories: f.categories, who: f.who, tags: f.tags, card: f.card,
    min: parseAmount(f.min), max: parseAmount(f.max), q: f.q,
  }, members), [allTx, members, from, to, f]);

  const catList = f.type === 'income' ? cats.income : f.type === 'expense' ? cats.expense
    : [...cats.expense, ...cats.income.filter((c) => !cats.expense.some((e) => e.name === c.name))];
  const active = JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);

  const [csvError, setCsvError] = useState('');
  const exportCsv = () => {
    const ok = downloadText(`가계부_검색결과_${todayStr()}.csv`, buildTxCsv(result.list, { members, cards }));
    setCsvError(ok ? '' : '이 브라우저에서는 내려받을 수 없어요.');
  };

  return (
    <div className="form adv-search">
      <div className="field">
        <label htmlFor="as-q">키워드</label>
        <input id="as-q" type="search" placeholder="메모·카테고리·태그·이름" value={f.q} onChange={(e) => set({ q: e.target.value })} />
      </div>

      <div className="field">
        <label>기간</label>
        <div className="chips">
          {[['1m', '이번 달'], ['3m', '최근 3개월'], ['year', '올해'], ['all', '전체'], ['range', '직접']].map(([k, l]) => (
            <button key={k} type="button" className="chip" aria-pressed={f.period === k} onClick={() => set({ period: k })}>{l}</button>
          ))}
        </div>
        {f.period === 'range' && (
          <div className="row2" style={{ marginTop: 8 }}>
            <input type="date" aria-label="시작일" value={f.from} onChange={(e) => set({ from: e.target.value })} />
            <input type="date" aria-label="끝일" value={f.to} onChange={(e) => set({ to: e.target.value })} />
          </div>
        )}
      </div>

      <div className="field">
        <label>유형</label>
        <div className="chips">
          {[['all', '전체'], ['expense', '지출'], ['income', '수입']].map(([k, l]) => (
            <button key={k} type="button" className="chip" aria-pressed={f.type === k} onClick={() => set({ type: k, categories: [] })}>{l}</button>
          ))}
        </div>
      </div>

      <details className="adv-more" open={f.categories.length > 0 || f.tags.length > 0 || f.who !== 'all' || f.card !== 'all' || !!f.min || !!f.max}>
        <summary>조건 더 보기 (카테고리·사람·태그·카드·금액)</summary>
        <div className="field">
          <label>카테고리 <span style={{ fontWeight: 400 }}>(여러 개 선택)</span></label>
          <div className="chips">
            {catList.map((c) => (
              <button key={c.name} type="button" className="chip" aria-pressed={f.categories.includes(c.name)} onClick={() => toggle('categories', c.name)}>{c.icon} {c.name}</button>
            ))}
          </div>
        </div>
        {members.length > 0 && (
          <div className="field">
            <label>누가</label>
            <div className="chips">
              {[['all', '전체', null], ...members.map((m) => [m.id, m.name, memberColor(m)]), [SHARED, SHARED_LABEL, memberColor(null)]].map(([k, l, col]) => (
                <button key={k} type="button" className="chip" aria-pressed={f.who === k} onClick={() => set({ who: k })}>
                  {col && <span className="dot" style={{ background: col }} />}{l}
                </button>
              ))}
            </div>
          </div>
        )}
        {tags.length > 0 && (
          <div className="field">
            <label>태그 <span style={{ fontWeight: 400 }}>(고른 태그를 모두 가진 내역)</span></label>
            <div className="chips">
              {tags.map((t) => <button key={t} type="button" className="chip" aria-pressed={f.tags.includes(t)} onClick={() => toggle('tags', t)}>#{t}</button>)}
            </div>
          </div>
        )}
        {cards.length > 0 && (
          <div className="field">
            <label>결제수단</label>
            <div className="chips">
              {[['all', '전체', null], ['cash', '💵 현금·기타', null], ...cards.map((c) => [c.id, c.name, colorVar(c.color)])].map(([k, l, col]) => (
                <button key={k} type="button" className="chip" aria-pressed={f.card === k} onClick={() => set({ card: k })}>
                  {col && <span className="dot" style={{ background: col }} />}{l}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label>금액</label>
          <div className="range-row">
            <div className="amount-input sm"><input inputMode="numeric" placeholder="최소" aria-label="최소 금액" value={f.min} onChange={(e) => set({ min: formatAmountInput(parseAmount(e.target.value)) })} /><span>원</span></div>
            <span>~</span>
            <div className="amount-input sm"><input inputMode="numeric" placeholder="최대" aria-label="최대 금액" value={f.max} onChange={(e) => set({ max: formatAmountInput(parseAmount(e.target.value)) })} /><span>원</span></div>
          </div>
        </div>
      </details>

      <div className="search-sum">
        <div><b>{result.count.toLocaleString('ko-KR')}건</b>
          <span>지출 {won(result.exp)}{result.inc ? ` · 수입 ${won(result.inc)}` : ''}</span></div>
        <div className="acts">
          {active && <button type="button" className="linkbtn" onClick={() => { onFilters(EMPTY_FILTERS); setShown(PAGE); }}>조건 초기화</button>}
          <button type="button" className="btn ghost sm" disabled={!result.count} onClick={exportCsv}>CSV</button>
        </div>
      </div>

      {csvError && <div className="err">{csvError}</div>}
      {result.count === 0 ? <div className="empty-mini">조건에 맞는 내역이 없어요.</div> : (
        <ul className="search-results">
          {result.list.slice(0, shown).map((t) => {
            const isInc = t.type === 'income';
            const m = members.length ? findMember(members, t.memberId) : null;
            return (
              <li key={t.id}>
                <button type="button" onClick={() => onOpen(t.id)}>
                  <span className="dt num">{t.date.slice(2).replace(/-/g, '.')}</span>
                  <span className="mid">
                    <span className="c">{iconOf(cats, isInc ? 'income' : 'expense', t.category)} {t.category}
                      {members.length > 0 && <small> · {m ? m.name : SHARED_LABEL}</small>}</span>
                    <span className="m">{t.memo}{(t.tags || []).map((x) => ` #${x}`).join('')}</span>
                  </span>
                  <span className={`a num ${isInc ? 'inc' : ''}`}>{isInc ? '+' : '-'}{won(t.amount)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {result.count > shown && <button type="button" className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>{Math.min(PAGE, result.count - shown)}건 더 보기</button>}
    </div>
  );
}
