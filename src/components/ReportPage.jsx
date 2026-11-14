import { useMemo } from 'react';
import { yearReport } from '../lib/analysis';
import { iconOf, colorOf, useCategories } from '../lib/categories';
import { won } from '../lib/format';

const W = 1000, H = 230, PT = 14, PB = 28; // 리포트는 넓은 화면에서 쓰이므로 가로로 길게
const change = (p) => (p == null ? '' : `${p > 0 ? '+' : ''}${p}%`);

/** 연간 리포트 페이지 */
export default function ReportPage({ allTx, year, onYear, members, cards, who, whoLabel, onPickMonth }) {
  const cats = useCategories();
  const r = useMemo(() => yearReport(allTx, year, { members, cards }), [allTx, year, members, cards]);
  const max = Math.max(1, ...r.months.map((m) => Math.max(m.inc, m.exp)));
  const slot = W / 12, bw = Math.min(16, slot * 0.3);
  const y = (v) => PT + (H - PT - PB) - (v / max) * (H - PT - PB);
  const topCats = r.categories.slice(0, 8);
  const restCats = r.categories.slice(8).reduce((a, c) => a + c.amount, 0);

  const ShareList = ({ rows, colorFn, iconFn }) => (
    <ul className="share-list">
      {rows.map((g) => (
        <li key={g.key}>
          <span className="nm">{iconFn ? `${iconFn(g.name)} ` : ''}{g.name}<small>{g.count}건</small></span>
          <span className="bar"><span style={{ width: `${Math.max(1, g.share * 100)}%`, background: colorFn ? colorFn(g.name) : 'var(--accent)' }} /></span>
          <span className="num">{won(g.amount)}</span>
          <span className="p num">{Math.round(g.share * 100)}%</span>
        </li>
      ))}
    </ul>
  );

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
              <h2>카테고리별 지출</h2>
              <ShareList rows={restCats ? [...topCats, { key: '__rest', name: '그 외', amount: restCats, count: r.categories.slice(8).reduce((a, c) => a + c.count, 0), share: restCats / r.exp }] : topCats}
                colorFn={(n) => colorOf(cats, n)} iconFn={(n) => (n === '그 외' ? '•' : iconOf(cats, 'expense', n))} />
            </div>
            <div className="card">
              <h2>큰 지출 TOP 5</h2>
              <ol className="top-list">
                {r.top.map((t) => (
                  <li key={t.id}>
                    <span className="nm">{iconOf(cats, 'expense', t.category)} {t.memo || t.category}<small>{t.date.slice(5).replace('-', '/')}</small></span>
                    <span className="num">{won(t.amount)}</span>
                  </li>
                ))}
              </ol>
            </div>
            {who === 'all' && r.byMember.length > 0 && <div className="card"><h2>사람별 지출</h2><ShareList rows={r.byMember} /></div>}
            {r.byTag.length > 0 && <div className="card"><h2>태그별 지출</h2><ShareList rows={r.byTag.slice(0, 10).map((g) => ({ ...g, name: `#${g.name}` }))} /><p className="hint">태그가 여러 개인 내역은 각 태그에 모두 더해져요.</p></div>}
            {r.byCard.length > 0 && <div className="card"><h2>결제수단별 지출</h2><ShareList rows={r.byCard} /></div>}
          </section>
        </>
      )}
    </div>
  );
}
