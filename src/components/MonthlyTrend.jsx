import { useMemo, useState } from 'react';
import { prevMonth, sumByType, won, ymKey } from '../lib/format';

const W = 640, H = 210, PAD_L = 8, PAD_R = 8, PAD_T = 18, PAD_B = 34;
const short = (n) => {
  if (n >= 100000000) return `${(n / 100000000).toFixed(n >= 1000000000 ? 0 : 1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString('ko-KR')}만`;
  return n ? n.toLocaleString('ko-KR') : '0';
};

/** 최근 N개월 수입·지출 막대 + 평균 지출선. 달을 누르면 그 달로 이동 */
export default function MonthlyTrend({ allTx, ym, onPick, label = '' }) {
  const [range, setRange] = useState(6);

  const months = useMemo(() => {
    const out = [];
    let cur = ym;
    for (let i = 0; i < range; i += 1) { out.unshift(cur); cur = prevMonth(cur); }
    const byKey = new Map(out.map((m) => [ymKey(m.y, m.m), []]));
    for (const t of allTx) {
      const k = typeof t.date === 'string' ? t.date.slice(0, 7) : '';
      if (byKey.has(k)) byKey.get(k).push(t);
    }
    return out.map((m) => ({ ...m, ...sumByType(byKey.get(ymKey(m.y, m.m))) }));
  }, [allTx, ym, range]);

  const max = Math.max(1, ...months.map((m) => Math.max(m.inc, m.exp)));
  const withData = months.filter((m) => m.inc || m.exp);
  const avgExp = withData.length ? withData.reduce((a, m) => a + m.exp, 0) / withData.length : 0;
  const avgInc = withData.length ? withData.reduce((a, m) => a + m.inc, 0) / withData.length : 0;
  const totalNet = months.reduce((a, m) => a + m.inc - m.exp, 0);

  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const slot = plotW / months.length;
  const barW = Math.min(26, slot * 0.32);
  const y = (v) => PAD_T + plotH - (v / max) * plotH;

  return (
    <div className="card wide">
      <h2>
        {label ? `${label} · 월별 추이` : '월별 추이'}
        <span className="seg mini" role="group" aria-label="기간">
          {[6, 12].map((n) => (
            <button key={n} type="button" aria-pressed={range === n} onClick={() => setRange(n)}>{n}개월</button>
          ))}
        </span>
      </h2>

      {withData.length === 0 ? (
        <div className="empty-mini">이 기간에 기록된 내역이 없어요.</div>
      ) : (
        <>
          <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img"
            aria-label={months.map((m) => `${m.m}월 수입 ${won(m.inc)} 지출 ${won(m.exp)}`).join(', ')}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} className="axis" />
            {avgExp > 0 && (
              <g>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(avgExp)} y2={y(avgExp)} className="avg" />
                <text x={W - PAD_R} y={y(avgExp) - 5} textAnchor="end" className="avg-t">평균 지출 {short(avgExp)}</text>
              </g>
            )}
            {months.map((m, i) => {
              const cx = PAD_L + slot * i + slot / 2;
              const sel = m.y === ym.y && m.m === ym.m;
              const showYear = i === 0 || m.m === 1;
              return (
                <g key={`${m.y}-${m.m}`} className={`mo ${sel ? 'sel' : ''}`} onClick={() => onPick({ y: m.y, m: m.m })}
                  tabIndex={0} role="button" aria-label={`${m.y}년 ${m.m}월로 이동`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick({ y: m.y, m: m.m }); } }}>
                  <rect x={cx - slot / 2} y={PAD_T - 6} width={slot} height={plotH + 6} className="hit" />
                  <rect x={cx - barW - 1} y={y(m.inc)} width={barW} height={Math.max(0, y(0) - y(m.inc))} rx="3" className="b-inc">
                    <title>{`${m.m}월 수입 ${won(m.inc)}`}</title>
                  </rect>
                  <rect x={cx + 1} y={y(m.exp)} width={barW} height={Math.max(0, y(0) - y(m.exp))} rx="3" className="b-exp">
                    <title>{`${m.m}월 지출 ${won(m.exp)}`}</title>
                  </rect>
                  <text x={cx} y={H - PAD_B + 16} textAnchor="middle" className="mo-t">{m.m}월</text>
                  {showYear && <text x={cx} y={H - PAD_B + 29} textAnchor="middle" className="yr-t">{m.y}</text>}
                </g>
              );
            })}
          </svg>
          <div className="trend-legend">
            <span><i className="sw inc" />수입 · 평균 {won(avgInc)}</span>
            <span><i className="sw exp" />지출 · 평균 {won(avgExp)}</span>
            <span className={totalNet >= 0 ? 'pos' : 'neg'}>{range}개월 {totalNet >= 0 ? '저축' : '적자'} {won(Math.abs(totalNet))}</span>
          </div>
        </>
      )}
    </div>
  );
}
