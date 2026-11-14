import { useCategories, iconOf } from '../lib/categories';
import { won } from '../lib/format';

/** 구독 자동 발견 카드: 매달 반복되는 내역을 반복 내역으로 등록하거나 무시 */
export default function SubscriptionFinder({ suggestions, onRegister, onDismiss }) {
  const cats = useCategories();
  if (!suggestions.length) return null;
  return (
    <section className="card sub-finder" aria-label="반복 내역 제안">
      <h2>🔍 매달 반복되는 내역을 찾았어요</h2>
      <ul>
        {suggestions.map((s) => (
          <li key={s.key}>
            <span className="sf-ic" aria-hidden="true">{iconOf(cats, s.type, s.category)}</span>
            <span className="sf-main">
              <b>{s.label}</b>
              <small>{s.type === 'income' ? '수입' : '지출'} {won(s.amount)} · 매달 {s.day}일쯤 · {s.months}달 연속</small>
            </span>
            <span className="sf-actions">
              <button type="button" className="btn primary sm" onClick={() => onRegister(s)}>반복 등록</button>
              <button type="button" className="btn sm" aria-label={`${s.label} 무시`} onClick={() => onDismiss(s)}>무시</button>
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">등록하면 다음 달부터 그 날짜에 자동으로 기록돼요. 무시한 항목은 다시 제안하지 않아요.</p>
    </section>
  );
}
