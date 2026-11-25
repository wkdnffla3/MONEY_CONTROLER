import { daysInMonth, isCurrentMonth, won } from '../lib/format';

// planned: 이번 달 남은 날에 자동으로 기록될 반복 지출 합계 (월세 등) → 하루 쓸 수 있는 금액에서 미리 뺌
export default function BudgetCard({ budget, exp, ym, onEdit, note = '', planned = 0 }) {
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
      const free = left - planned;
      foot = over ? `예산을 ${won(-left)} 넘었어요.`
        : free < 0 ? `곧 기록될 반복 지출 ${won(planned)}까지 더하면 예산을 ${won(-free)} 넘어요.`
          : `남은 ${remain}일 동안 하루 ${won(free / remain)}까지 쓸 수 있어요.${planned ? ` (곧 기록될 반복 지출 ${won(planned)} 빼고)` : ''}`;
    } else {
      const now = new Date();
      const future = ym.y * 12 + ym.m > now.getFullYear() * 12 + now.getMonth() + 1; // 다음 달 이후 (미리 넣은 내역만 있음)
      foot = over ? `예산을 ${won(-left)} 넘었어요.` : future ? `아직 ${won(left)} 남았어요.` : `예산 안에서 ${won(left)} 남겼어요.`;
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
