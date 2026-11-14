import { signedWon, won } from '../lib/format';

export default function Summary({ inc, exp, cmp, who = '' }) {
  const balance = inc - exp;
  const rate = inc > 0
    ? `저축률 ${Math.max(-999, Math.round((balance / inc) * 100))}%`
    : '수입을 기록하면 저축률이 보여요';

  return (
    <section className="summary" aria-label="이번 달 요약">
      <div className="stat bal">
        <div className="k">{who ? `${who} · 이번 달 잔액` : '이번 달 잔액'}</div>
        <div className="v num">{signedWon(balance)}</div>
        <div className="delta">{rate}</div>
      </div>
      <div className="stat">
        <div className="k">{who ? `${who}의 수입` : '수입'}</div>
        <div className="v num inc">{won(inc)}</div>
      </div>
      <div className="stat">
        <div className="k">{who ? `${who}의 지출` : '지출'}</div>
        <div className="v num exp">{won(exp)}</div>
        {cmp && cmp.prevTotal > 0 && cmp.diff !== 0 && (
          <div className="delta" style={{ color: 'var(--muted)' }}>
            {cmp.partial ? '지난달 같은 기간보다' : '지난달보다'} {won(Math.abs(cmp.diff))} {cmp.diff > 0 ? '더 씀' : '덜 씀'}
          </div>
        )}
      </div>
    </section>
  );
}
