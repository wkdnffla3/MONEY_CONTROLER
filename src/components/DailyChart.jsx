import { useMemo, useRef } from 'react';
import { WEEKDAYS, daysInMonth, isCurrentMonth, won } from '../lib/format';

export default function DailyChart({ list, ym, half = false }) {
  const tipRef = useRef(null);
  const days = daysInMonth(ym.y, ym.m);
  const current = isCurrentMonth(ym);
  const today = current ? new Date().getDate() : -1;

  const perDay = useMemo(() => {
    const arr = new Array(days).fill(0);
    for (const t of list) {
      if (t.type === 'income') continue;
      const d = parseInt(t.date.slice(8, 10), 10);
      if (d >= 1 && d <= days) arr[d - 1] += Number(t.amount) || 0;
    }
    return arr;
  }, [list, days]);

  const max = Math.max(...perDay, 1);
  const total = perDay.reduce((a, b) => a + b, 0);
  const elapsed = current ? new Date().getDate() : days;

  // 툴팁은 리렌더 없이 DOM을 직접 움직임
  const onMove = (e) => {
    const tip = tipRef.current;
    const bar = e.target.closest('.d');
    if (!tip) return;
    if (!bar) { tip.style.opacity = 0; return; }
    tip.textContent = bar.dataset.tip;
    tip.style.opacity = 1;
    const x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, e.clientX - tip.offsetWidth / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY - 38}px`;
  };
  const onLeave = () => { if (tipRef.current) tipRef.current.style.opacity = 0; };

  return (
    <div className={`card ${half ? '' : 'wide'}`}>
      <h2>
        일별 지출
        {total > 0 && <span className="num" style={{ fontSize: 12, fontWeight: 500 }}>하루 평균 {won(total / elapsed)}</span>}
      </h2>
      <div className="daily" role="img" aria-label="일별 지출 막대그래프" onPointerMove={onMove} onPointerLeave={onLeave}>
        {perDay.map((v, i) => {
          const wd = WEEKDAYS[new Date(ym.y, ym.m - 1, i + 1).getDay()];
          return (
            <div
              key={i}
              className={`d ${v ? '' : 'zero'} ${i + 1 === today ? 'today' : ''}`}
              style={{ height: `${v ? Math.max(4, (v / max) * 100) : 3}%` }}
              data-tip={`${ym.m}/${i + 1} (${wd}) · ${won(v)}`}
            />
          );
        })}
      </div>
      <div className="daily-axis"><span>1일</span><span>{Math.ceil(days / 2)}일</span><span>{days}일</span></div>
      <div className="tip" ref={tipRef} />
    </div>
  );
}
