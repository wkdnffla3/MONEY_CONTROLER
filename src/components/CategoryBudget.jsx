import { useMemo, useState } from 'react';
import { iconOf, useCategories } from '../lib/categories';
import { formatAmountInput, parseAmount, won } from '../lib/format';
import { MAX_AMOUNT } from '../lib/outbox';

export const WARN_RATIO = 0.8; // 80%부터 주의

/** 카테고리별 이번 달 지출 합계 { 이름: 금액 } (지출만) */
export function spentByCategory(list) {
  const by = {};
  for (const t of list) if (t.type !== 'income') by[t.category] = (by[t.category] || 0) + (Number(t.amount) || 0);
  return by;
}

/** 카테고리별 예산 카드 (모두의 지출 기준) */
export function CategoryBudgetCard({ catBudgets, monthTx, onEdit }) {
  const cats = useCategories();
  const spent = useMemo(() => spentByCategory(monthTx), [monthTx]);
  const rows = Object.entries(catBudgets)
    .map(([name, budget]) => ({ name, budget, spent: spent[name] || 0 }))
    .map((r) => ({ ...r, ratio: r.spent / r.budget }))
    .sort((a, b) => b.ratio - a.ratio);

  return (
    <div className="card">
      <h2>카테고리별 예산 <button type="button" className="linkbtn" onClick={onEdit}>설정</button></h2>
      {rows.length === 0 ? (
        <div className="empty-mini">
          식비·카페처럼 자주 넘치는 카테고리에<br />예산을 정하면 넘기 전에 알려드려요.<br />
          <button type="button" className="btn ghost" style={{ marginTop: 10 }} onClick={onEdit}>예산 정하기</button>
        </div>
      ) : (
        <ul className="catbud">
          {rows.map((r) => {
            const level = r.ratio > 1 ? 'over' : r.ratio >= WARN_RATIO ? 'warn' : '';
            return (
              <li key={r.name} className={level}>
                <div className="top">
                  <span className="nm">{iconOf(cats, 'expense', r.name)} {r.name}</span>
                  <span className="num"><b>{won(r.spent)}</b> / {won(r.budget)}</span>
                </div>
                <div className={`bar ${level}`}><span style={{ width: `${Math.min(100, r.ratio * 100)}%` }} /></div>
                <div className="foot">
                  {r.ratio > 1 ? `${won(r.spent - r.budget)} 넘었어요` : `${won(r.budget - r.spent)} 남음`}
                  <span className="num">{Math.round(r.ratio * 100)}%</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 카테고리별 예산 입력 (비워 두면 예산 없음) */
export function CategoryBudgetForm({ catBudgets, monthTx, onSave }) {
  const cats = useCategories();
  const spent = useMemo(() => spentByCategory(monthTx), [monthTx]);
  const [values, setValues] = useState(() => Object.fromEntries(
    cats.expense.map((c) => [c.name, formatAmountInput(catBudgets[c.name] || 0)]),
  ));
  const [error, setError] = useState('');
  // 지금 목록에 없는 카테고리(삭제됨)에 예산이 남아 있으면 버리지 않고 알려줌
  const orphans = Object.keys(catBudgets).filter((k) => !cats.expense.some((c) => c.name === k));

  const submit = (e) => {
    e.preventDefault();
    const out = {};
    for (const [name, v] of Object.entries(values)) {
      const n = parseAmount(v);
      if (n > MAX_AMOUNT) { setError(`${name} 예산이 너무 커요.`); return; }
      if (n > 0) out[name] = n;
    }
    onSave(out);
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <p className="hint">비워 두면 그 카테고리는 예산 없이 봐요. 옆의 숫자는 이번 달 지금까지 쓴 금액이에요.</p>
      <ul className="catbud-edit">
        {cats.expense.map((c) => (
          <li key={c.name}>
            <label htmlFor={`cb-${c.name}`}>{c.icon} {c.name}<small className="num">{spent[c.name] ? won(spent[c.name]) : ''}</small></label>
            <div className="amount-input sm">
              <input id={`cb-${c.name}`} inputMode="numeric" placeholder="없음" value={values[c.name]}
                onChange={(e) => { setError(''); setValues((v) => ({ ...v, [c.name]: formatAmountInput(parseAmount(e.target.value)) })); }} />
              <span>원</span>
            </div>
          </li>
        ))}
      </ul>
      {orphans.length > 0 && <p className="hint warn-text">삭제된 카테고리({orphans.join(', ')})의 예산은 저장하면 지워져요.</p>}
      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        <button type="submit" className="btn primary">저장</button>
      </div>
    </form>
  );
}
