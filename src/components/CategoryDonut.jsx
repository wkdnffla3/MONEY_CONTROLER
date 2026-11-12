import { useMemo } from 'react';
import { colorOf } from '../lib/categories';
import { won } from '../lib/format';

const R = 52;
const C = 2 * Math.PI * R;

export default function CategoryDonut({ expenses, total }) {
  const rows = useMemo(() => {
    const by = {};
    for (const t of expenses) by[t.category] = (by[t.category] || 0) + (Number(t.amount) || 0);
    let r = Object.entries(by).sort((a, b) => b[1] - a[1]);
    if (r.length > 6) {
      const rest = r.slice(5).reduce((s, x) => s + x[1], 0);
      r = r.slice(0, 5).concat([['그 외', rest]]);
    }
    return r;
  }, [expenses]);

  if (!total) {
    return (
      <div className="card">
        <h2>카테고리별 지출</h2>
        <div className="empty-mini">이번 달 지출이 아직 없어요.</div>
      </div>
    );
  }

  let offset = 0;
  const gap = rows.length > 1 ? 2 : 0;

  return (
    <div className="card">
      <h2>카테고리별 지출</h2>
      <div className="donut-wrap">
        <div className="donut">
          <svg viewBox="0 0 132 132" aria-hidden="true">
            {rows.map(([cat, v]) => {
              const len = (v / total) * C;
              const el = (
                <circle key={cat} r={R} cx="66" cy="66" fill="none" stroke={colorOf(cat)} strokeWidth="18"
                  strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-offset}>
                  <title>{`${cat} ${won(v)}`}</title>
                </circle>
              );
              offset += len;
              return el;
            })}
          </svg>
          <div className="center"><div>최다<b>{rows[0][0]}</b></div></div>
        </div>
        <ul className="legend">
          {rows.map(([cat, v]) => (
            <li key={cat}>
              <span className="sw" style={{ background: colorOf(cat) }} />
              <span className="nm">{cat} <span className="pc">{Math.round((v / total) * 100)}%</span></span>
              <span className="num" style={{ fontSize: 12.5 }}>{won(v)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
