import { useMemo } from 'react';
import { calendarMonth } from '../lib/analysis';
import { WEEKDAYS, todayStr } from '../lib/format';

const short = (n) => (n >= 10000 ? `${Math.round(n / 1000) / 10}만` : n.toLocaleString('ko-KR'));

/** 달력 보기: 날짜 칸에 지출(진할수록 많이 씀)·수입 표시. 날짜를 누르면 onPick(날짜) */
export default function CalendarView({ list, ym, selected, onPick }) {
  const { weeks, maxExp } = useMemo(() => calendarMonth(list, ym), [list, ym]);
  const today = todayStr();

  return (
    <div className="calendar" role="grid" aria-label={`${ym.y}년 ${ym.m}월 달력`}>
      <div className="cal-head" role="row">
        {WEEKDAYS.map((w, i) => <div key={w} role="columnheader" className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{w}</div>)}
      </div>
      {weeks.map((week, wi) => (
        <div className="cal-week" role="row" key={wi}>
          {week.map((c, di) => {
            if (!c) return <div key={di} className="cal-cell empty" role="gridcell" />;
            const level = c.exp && maxExp ? Math.min(4, Math.ceil((c.exp / maxExp) * 4)) : 0;
            return (
              <button key={di} type="button" role="gridcell"
                className={`cal-cell lv${level} ${c.date === today ? 'today' : ''} ${selected === c.date ? 'sel' : ''} ${di === 0 ? 'sun' : di === 6 ? 'sat' : ''}`}
                aria-label={`${ym.m}월 ${c.day}일 지출 ${c.exp.toLocaleString('ko-KR')}원${c.inc ? `, 수입 ${c.inc.toLocaleString('ko-KR')}원` : ''}`}
                aria-pressed={selected === c.date}
                onClick={() => onPick(selected === c.date ? null : c.date)}>
                <span className="d">{c.day}</span>
                {/* 좁은 칸에 맞게 부호 없이: 빨강 = 지출, 파랑 = 수입 */}
                {c.exp > 0 && <span className="e num">{short(c.exp)}</span>}
                {c.inc > 0 && <span className="i num">{short(c.inc)}</span>}
              </button>
            );
          })}
        </div>
      ))}
      <div className="cal-legend">
        <span className="e">빨강 지출</span><span className="i">파랑 수입</span>
        <span className="sp" /><span>적게</span>{[1, 2, 3, 4].map((l) => <i key={l} className={`lv${l}`} />)}<span>많이 씀</span>
      </div>
    </div>
  );
}
