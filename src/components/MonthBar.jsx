import { ChevronLeft, ChevronRight } from './Icons';
import { isCurrentMonth } from '../lib/format';

export default function MonthBar({ ym, onPrev, onNext, onToday }) {
  const current = isCurrentMonth(ym);
  return (
    <div className="monthbar">
      <button type="button" className="iconbtn" onClick={onPrev} aria-label="이전 달"><ChevronLeft /></button>
      <button type="button" className="label" onClick={onToday} title="이번 달로 이동">
        {ym.y}년 {ym.m}월
        <small>{current ? '이번 달' : '탭하면 이번 달로'}</small>
      </button>
      <button type="button" className="iconbtn" onClick={onNext} aria-label="다음 달"><ChevronRight /></button>
    </div>
  );
}
