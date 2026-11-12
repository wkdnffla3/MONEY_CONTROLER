import { useState } from 'react';
import { formatAmountInput, parseAmount, won } from '../lib/format';
import { MAX_AMOUNT } from '../lib/outbox';

const PRESETS = [500000, 1000000, 1500000, 2000000];

export default function BudgetForm({ budget, onSave }) {
  const [value, setValue] = useState(formatAmountInput(budget));
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const n = parseAmount(value);
    if (n > MAX_AMOUNT) { setError(`예산은 ${won(MAX_AMOUNT)}까지 입력할 수 있어요.`); return; }
    onSave(n);
  };

  return (
    <form className="form" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor="budget-amt">매달 쓸 금액</label>
        <div className="amount-input">
          <input
            id="budget-amt"
            inputMode="numeric"
            placeholder="0"
            autoFocus
            maxLength={16}
            value={value}
            onChange={(e) => { setError(''); setValue(formatAmountInput(parseAmount(e.target.value))); }}
          />
          <span>원</span>
        </div>
        <div className="quick">
          {PRESETS.map((v) => (
            <button key={v} type="button" onClick={() => { setError(''); setValue(formatAmountInput(v)); }}>{v / 10000}만</button>
          ))}
        </div>
      </div>
      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        {budget > 0 && <button type="button" className="btn ghost" onClick={() => onSave(0)}>예산 없애기</button>}
        <button type="submit" className="btn primary">저장</button>
      </div>
    </form>
  );
}
