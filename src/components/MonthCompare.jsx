import { useMemo } from 'react';
import { compareMonths } from '../lib/analysis';
import { iconOf, useCategories } from '../lib/categories';
import { won } from '../lib/format';

const pctText = (p) => (p == null ? '새로 생김' : `${p > 0 ? '+' : ''}${p}%`);

/** 지난달 대비 지출 변화 (진행 중인 달은 같은 날짜까지 비교) */
export default function MonthCompare({ allTx, ym, label = '', cmp }) {
  const cats = useCategories();
  const own = useMemo(() => (cmp ? null : compareMonths(allTx, ym)), [allTx, ym, cmp]);
  const c = cmp || own;
  const prevM = ym.m === 1 ? 12 : ym.m - 1;

  const Row = ({ x, kind }) => (
    <li className={kind}>
      <span className="nm">{iconOf(cats, 'expense', x.name)} {x.name}</span>
      <span className="num">{kind === 'up' ? '+' : '-'}{won(Math.abs(x.diff))}</span>
      <span className="p">{pctText(x.pct)}</span>
    </li>
  );

  return (
    <div className="card">
      <h2>{label ? `${label} · 지난달 대비` : '지난달 대비'}</h2>
      {c.curTotal === 0 && c.prevTotal === 0 ? (
        <div className="empty-mini">비교할 지출이 아직 없어요.</div>
      ) : (
        <>
          <div className={`cmp-head ${c.diff > 0 ? 'up' : c.diff < 0 ? 'down' : ''}`}>
            <b className="num">{c.diff === 0 ? '같아요' : `${won(Math.abs(c.diff))} ${c.diff > 0 ? '더 썼어요' : '덜 썼어요'}`}</b>
            {c.pct != null && c.diff !== 0 && <span className="num">{c.pct > 0 ? '+' : ''}{c.pct}%</span>}
          </div>
          <p className="hint">
            {c.partial ? `${prevM}월 1~${c.cutoffDay}일과 이번 달 1~${c.cutoffDay}일 비교` : `${prevM}월 전체와 ${ym.m}월 전체 비교`}
            {' · '}{won(c.prevTotal)} → {won(c.curTotal)}
          </p>
          {c.up.length > 0 && <ul className="cmp-list">{c.up.map((x) => <Row key={x.name} x={x} kind="up" />)}</ul>}
          {c.down.length > 0 && <ul className="cmp-list">{c.down.map((x) => <Row key={x.name} x={x} kind="down" />)}</ul>}
        </>
      )}
    </div>
  );
}
