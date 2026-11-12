import { useState } from 'react';
import { formatAmountInput, parseAmount } from '../lib/format';

const PRESETS = [500000, 1000000, 1500000, 2000000];

export default function BudgetForm({ budget, onSave }) {
  const [value, setValue] = useState(formatAmountInput(budget));

  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); onSave(parseAmount(value)); }}>
      <div className="field">
        <label htmlFor="budget-amt">매달 쓸 금액</label>
        <div className="amount-input">
          <input
            id="budget-amt"
            inputMode="numeric"
            placeholder="0"
            autoFocus
            value={value}
            onChange={(e) => setValue(formatAmountInput(parseAmount(e.target.value)))}
          />
          <span>원</span>
        </div>
        <div className="quick">
          {PRESETS.map((v) => (
            <button key={v} type="button" onClick={() => setValue(formatAmountInput(v))}>{v / 10000}만</button>
          ))}
        </div>
      </div>
      <div className="form-actions">
        {budget > 0 && <button type="button" className="btn ghost" onClick={() => onSave(0)}>예산 없애기</button>}
        <button type="submit" className="btn primary">저장</button>
      </div>
    </form>
  );
}
