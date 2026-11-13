import { daysInMonth, isCurrentMonth, won } from '../lib/format';

export default function BudgetCard({ budget, exp, ym, onEdit, note = '' }) {
  let body;
  if (!budget) {
    body = (
      <div className="empty-mini">
        예산을 정하면 남은 금액과<br />하루 권장 지출을 알려드려요.<br />
        <button type="button" className="btn ghost" style={{ marginTop: 10 }} onClick={onEdit}>예산 정하기</button>
      </div>
    );
  } else {
    const over = exp > budget;
    const left = budget - exp;
    let foot;
    if (isCurrentMonth(ym)) {
      const remain = daysInMonth(ym.y, ym.m) - new Date().getDate() + 1;
      foot = over ? `예산을 ${won(-left)} 넘었어요.` : `남은 ${remain}일 동안 하루 ${won(left / remain)}까지 쓸 수 있어요.`;
    } else {
      foot = over ? `예산을 ${won(-left)} 넘었어요.` : `예산 안에서 ${won(left)} 남겼어요.`;
    }
    body = (
      <>
        <div className="budget-top">
          <span><b className="num">{won(exp)}</b> / <span className="num">{won(budget)}</span></span>
          <span className="num">{Math.round((exp / budget) * 100)}%</span>
        </div>
        <div className={`bar ${over ? 'over' : ''}`}>
          <span style={{ width: `${Math.min(100, (exp / budget) * 100)}%` }} />
        </div>
        <div className="budget-foot">{foot}</div>
        {note && <div className="budget-foot" style={{ marginTop: 4 }}>{note}</div>}
      </>
    );
  }

  return (
    <div className="card">
      <h2>월 예산 <button type="button" className="linkbtn" onClick={onEdit}>설정</button></h2>
      {body}
    </div>
  );
}
