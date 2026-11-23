import { useMemo, useState } from 'react';
import { yearReport } from '../lib/analysis';
import { iconOf, colorOf, useCategories } from '../lib/categories';
import { won } from '../lib/format';

const W = 1000, H = 230, PT = 14, PB = 28; // 리포트는 넓은 화면에서 쓰이므로 가로로 길게
const change = (p) => (p == null ? '' : `${p > 0 ? '+' : ''}${p}%`);
const STEP = 10; // 펼친 묶음에서 한 번에 더 보여 줄 내역 수
const md = (d) => d.slice(5).replace('-', '/');

/** 펼친 묶음의 내역 목록 (큰 금액 순, 10개씩 더 보기). 누르면 그 내역 수정 화면 */
function ItemList({ items, cats, onOpenTx, showCategory }) {
  const [n, setN] = useState(STEP);
  return (
    <div className="share-items">
      <ol>
        {items.slice(0, n).map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => onOpenTx?.(t.id)}>
              <span className="d num">{md(t.date)}</span>
              <span className="m">{showCategory ? `${iconOf(cats, 'expense', t.category)} ` : ''}{t.memo || t.category}</span>
              <span className="num">{won(t.amount)}</span>
            </button>
          </li>
        ))}
      </ol>
      {items.length > n && (
        <button type="button" className="link-btn more" onClick={() => setN((v) => v + STEP * 2)}>
          더 보기 ({items.length - n}건 남음)
        </button>
      )}
    </div>
  );
}

/** 비율 막대 목록. 줄을 누르면 그 묶음의 내역이 아래로 펼쳐짐 */
function ShareList({ rows, colorFn, iconFn, cats, onOpenTx, showCategory = true, label }) {
  const [open, setOpen] = useState(null);
  return (
    <ul className="share-list">
      {rows.map((g) => {
        const isOpen = open === g.key;
        return (
          <li key={g.key} className={isOpen ? 'open' : ''}>
            <button type="button" className="share-row" aria-expanded={isOpen} aria-label={`${label ? `${label} ` : ''}${g.name} 내역 ${isOpen ? '접기' : '펼치기'}`}
              onClick={() => setOpen(isOpen ? null : g.key)}>
              <span className="nm">{iconFn ? `${iconFn(g.name)} ` : ''}{g.name}<small>{g.count}건</small></span>
              <span className="bar"><span style={{ width: `${Math.max(1, g.share * 100)}%`, background: colorFn ? colorFn(g.name) : 'var(--accent)' }} /></span>
              <span className="num">{won(g.amount)}</span>
              <span className="p num">{Math.round(g.share * 100)}%</span>
              <span className="chev" aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
            </button>
            {isOpen && <ItemList items={g.items} cats={cats} onOpenTx={onOpenTx} showCategory={showCategory} />}
          </li>
        );
      })}
    </ul>
  );
}

/** 연간 리포트 페이지. 목록의 줄을 누르면 그 묶음의 내역이 펼쳐지고, 내역을 누르면 수정 화면(onOpenTx) */
export default function ReportPage({ allTx, year, onYear, members, cards, who, whoLabel, onPickMonth, onOpenTx }) {
  const cats = useCategories();
  const r = useMemo(() => yearReport(allTx, year, { members, cards }), [allTx, year, members, cards]);
  const max = Math.max(1, ...r.months.map((m) => Math.max(m.inc, m.exp)));
  const slot = W / 12, bw = Math.min(16, slot * 0.3);
  const y = (v) => PT + (H - PT - PB) - (v / max) * (H - PT - PB);
  const [allCats, setAllCats] = useState(false);
  const [allTags, setAllTags] = useState(false);
  const [topN, setTopN] = useState(5);
  const CAT_LIMIT = 8, TAG_LIMIT = 10;
  const catRows = allCats ? r.categories : r.categories.slice(0, CAT_LIMIT);
  const tagRows = (allTags ? r.byTag : r.byTag.slice(0, TAG_LIMIT)).map((g) => ({ ...g, name: `#${g.name}` }));
  const MoreToggle = ({ shown, total, all, setAll }) => (total > shown ? (
    <button type="button" className="link-btn more-toggle" onClick={() => setAll(!all)}>
      {all ? '접기 ▴' : `전체 보기 (${total - shown}개 더) ▾`}
    </button>
  ) : null);

  return (
    <div className="report grid">
      <div className="year-bar monthbar">
        <button type="button" className="iconbtn" onClick={() => onYear(year - 1)} aria-label="이전 해">‹</button>
        <div className="label">{year}년 리포트{whoLabel && <small>{whoLabel} 기준</small>}</div>
        <button type="button" className="iconbtn" onClick={() => onYear(year + 1)} aria-label="다음 해" disabled={year >= new Date().getFullYear()}>›</button>
      </div>

      {r.count === 0 ? (
        <div className="card"><div className="empty">
          <div className="big">📊</div><p>{year}년에 기록된 내역이 없어요.</p>
        </div></div>
      ) : (
        <>
          <section className="summary">
            <div className="stat bal">
              <div className="k">{year}년 저축</div>
              <div className="v num">{r.net < 0 ? '-' : ''}{won(Math.abs(r.net))}</div>
              <div className="delta">{r.rate != null ? `저축률 ${r.rate}%` : '수입 기록이 없어요'}</div>
            </div>
            <div className="stat">
              <div className="k">수입</div><div className="v num inc">{won(r.inc)}</div>
              {r.incPct != null && <div className="delta" style={{ color: 'var(--muted)' }}>작년보다 {change(r.incPct)}</div>}
            </div>
            <div className="stat">
              <div className="k">지출</div><div className="v num exp">{won(r.exp)}</div>
              {r.expPct != null && <div className="delta" style={{ color: 'var(--muted)' }}>작년보다 {change(r.expPct)}</div>}
            </div>
          </section>

          <div className="card">
            <h2>월별 수입·지출{r.maxMonth && <span style={{ fontWeight: 500, fontSize: 12.5 }}>가장 많이 쓴 달 {r.maxMonth.m}월 · {won(r.maxMonth.exp)}</span>}</h2>
            <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={r.months.map((m) => `${m.m}월 지출 ${won(m.exp)}`).join(', ')}>
              <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="axis" />
              {r.months.map((m, i) => {
                const cx = slot * i + slot / 2;
                return (
                  <g key={m.m} className={`mo ${r.maxMonth?.m === m.m ? 'sel' : ''}`} role="button" tabIndex={0} aria-label={`${m.m}월 가계부로 이동`}
                    onClick={() => onPickMonth({ y: year, m: m.m })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickMonth({ y: year, m: m.m }); } }}>
                    <rect x={cx - slot / 2} y={PT - 6} width={slot} height={H - PT - PB + 6} className="hit" />
                    <rect x={cx - bw - 1} y={y(m.inc)} width={bw} height={Math.max(0, y(0) - y(m.inc))} rx="2" className="b-inc"><title>{`${m.m}월 수입 ${won(m.inc)}`}</title></rect>
                    <rect x={cx + 1} y={y(m.exp)} width={bw} height={Math.max(0, y(0) - y(m.exp))} rx="2" className="b-exp"><title>{`${m.m}월 지출 ${won(m.exp)}`}</title></rect>
                    <text x={cx} y={H - 8} textAnchor="middle" className="mo-t">{m.m}월</text>
                  </g>
                );
              })}
            </svg>
            <div className="trend-legend">
              <span><i className="sw inc" />수입 · 월평균 {won(r.inc / 12)}</span>
              <span><i className="sw exp" />지출 · 월평균 {won(r.exp / 12)}</span>
            </div>
          </div>

          <section className="grid insights">
            <div className="card">
              <h2>카테고리별 지출 <span className="h-hint">줄을 누르면 내역</span></h2>
              <ShareList rows={catRows} cats={cats} onOpenTx={onOpenTx} showCategory={false} label="카테고리"
                colorFn={(n) => colorOf(cats, n)} iconFn={(n) => iconOf(cats, 'expense', n)} />
              <MoreToggle shown={CAT_LIMIT} total={r.categories.length} all={allCats} setAll={setAllCats} />
            </div>
            <div className="card">
              <h2>큰 지출 TOP {Math.min(topN, r.expenses.length)}</h2>
              <ol className="top-list">
                {r.expenses.slice(0, topN).map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpenTx?.(t.id)}>
                      <span className="nm">{iconOf(cats, 'expense', t.category)} {t.memo || t.category}<small>{md(t.date)}</small></span>
                      <span className="num">{won(t.amount)}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {(r.expenses.length > topN || topN > 5) && (
                <div className="more-row">
                  {r.expenses.length > topN && (
                    <button type="button" className="link-btn more-toggle" onClick={() => setTopN((v) => (v < 20 ? 20 : v + 30))}>
                      더 보기 ({r.expenses.length - topN}건 남음) ▾
                    </button>
                  )}
                  {topN > 5 && <button type="button" className="link-btn more-toggle" onClick={() => setTopN(5)}>접기 ▴</button>}
                </div>
              )}
            </div>
            {who === 'all' && r.byMember.length > 0 && <div className="card"><h2>사람별 지출</h2><ShareList rows={r.byMember} cats={cats} onOpenTx={onOpenTx} label="사람" /></div>}
            {r.byTag.length > 0 && (
              <div className="card">
                <h2>태그별 지출</h2>
                <ShareList rows={tagRows} cats={cats} onOpenTx={onOpenTx} label="태그" />
                <MoreToggle shown={TAG_LIMIT} total={r.byTag.length} all={allTags} setAll={setAllTags} />
                <p className="hint">태그가 여러 개인 내역은 각 태그에 모두 더해져요.</p>
              </div>
            )}
            {r.byCard.length > 0 && <div className="card"><h2>결제수단별 지출</h2><ShareList rows={r.byCard} cats={cats} onOpenTx={onOpenTx} label="결제수단" /></div>}
          </section>
        </>
      )}
    </div>
  );
}
