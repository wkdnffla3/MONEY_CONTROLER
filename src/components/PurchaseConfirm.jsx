import { useRef, useState } from 'react';
import { iconOf, useCategories } from '../lib/categories';
import { SHARED_LABEL, memberColor } from '../lib/members';
import { formatAmountInput, parseAmount, todayStr, won } from '../lib/format';
import { MAX_AMOUNT } from '../lib/outbox';
import { defaultMemo, expectedTotal } from '../lib/shopping';

/**
 * 결제 확정: 장바구니에 담은 물품을 가계부 지출로 기록.
 * - 한 건으로: 영수증 합계 하나로 기록 (카테고리 하나)
 * - 물품별로: 물품마다 따로 기록 (각 물품의 카테고리)
 * onConfirm(opts) — opts: { mode, date, category, memberId, memo, total, amounts }
 */
export default function PurchaseConfirm({ items, members = [], defaultMemberId = null, onConfirm }) {
  const cats = useCategories();
  const [mode, setMode] = useState('combined');
  const [amounts, setAmounts] = useState(() => Object.fromEntries(items.map((i) => [i.id, formatAmountInput(expectedTotal(i))])));
  const sumOfItems = items.reduce((a, i) => a + parseAmount(amounts[i.id]), 0);
  const [total, setTotal] = useState(() => formatAmountInput(items.reduce((a, i) => a + expectedTotal(i), 0)));
  const [totalTouched, setTotalTouched] = useState(false);
  const shownTotal = totalTouched ? total : formatAmountInput(sumOfItems);
  const firstCat = items[0]?.category;
  const [category, setCategory] = useState(cats.expense.some((c) => c.name === firstCat) ? firstCat : cats.expense[0].name);
  const validId = (id) => (id && members.some((m) => m.id === id) ? id : null);
  const [memberId, setMemberId] = useState(validId(items[0]?.memberId) ?? validId(defaultMemberId));
  const [date, setDate] = useState(todayStr());
  const [memo, setMemo] = useState(defaultMemo(items));
  const [error, setError] = useState('');
  const sent = useRef(false); // 확정 버튼 두 번 누르기 방지

  const submit = (e) => {
    e.preventDefault();
    if (sent.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('결제한 날짜를 선택해 주세요.'); return; }
    const amountMap = Object.fromEntries(items.map((i) => [i.id, parseAmount(amounts[i.id])]));
    if (mode === 'combined') {
      const t = parseAmount(shownTotal);
      if (!t) { setError('결제한 금액을 입력해 주세요.'); return; }
      if (t > MAX_AMOUNT) { setError('금액이 너무 커요.'); return; }
      sent.current = true;
      onConfirm({ mode, date, category, memberId, memo: memo.trim() || defaultMemo(items), total: t, amounts: amountMap });
    } else {
      const missing = items.filter((i) => !amountMap[i.id]);
      if (missing.length) { setError(`금액이 없는 물품이 있어요: ${missing.map((i) => i.name).join(', ')}`); return; }
      if (items.some((i) => amountMap[i.id] > MAX_AMOUNT)) { setError('금액이 너무 커요.'); return; }
      sent.current = true;
      onConfirm({ mode, date, memberId, amounts: amountMap });
    }
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="typeswitch plain" role="group" aria-label="기록 방식">
        <button type="button" aria-pressed={mode === 'combined'} onClick={() => setMode('combined')}>한 건으로 합치기</button>
        <button type="button" aria-pressed={mode === 'separate'} onClick={() => setMode('separate')}>물품별로 나누기</button>
      </div>
      <p className="hint">{mode === 'combined' ? '영수증 합계 하나로 가계부에 기록해요.' : `물품마다 따로, 각자의 카테고리로 ${items.length}건 기록해요.`}</p>

      <ul className="confirm-items">
        {items.map((i) => (
          <li key={i.id}>
            <span className="nm">{iconOf(cats, 'expense', i.category)} {i.name}{i.qty > 1 && <small> ×{i.qty}</small>}</span>
            <div className="amount-input sm">
              <input inputMode="numeric" placeholder="금액" aria-label={`${i.name} 금액`} value={amounts[i.id]}
                onChange={(e) => { setError(''); setAmounts((a) => ({ ...a, [i.id]: formatAmountInput(parseAmount(e.target.value)) })); }} />
              <span>원</span>
            </div>
          </li>
        ))}
      </ul>

      {mode === 'combined' && (
        <>
          <div className="field">
            <label htmlFor="pc-total">결제 금액 <span style={{ fontWeight: 400 }}>(영수증 합계로 고칠 수 있어요)</span></label>
            <div className="amount-input">
              <input id="pc-total" inputMode="numeric" placeholder="0" value={shownTotal}
                onChange={(e) => { setError(''); setTotalTouched(true); setTotal(formatAmountInput(parseAmount(e.target.value))); }} />
              <span>원</span>
            </div>
            {totalTouched && parseAmount(total) !== sumOfItems && sumOfItems > 0 && (
              <p className="hint">물품 금액 합 {won(sumOfItems)}과 {won(Math.abs(parseAmount(total) - sumOfItems))} 차이 (할인·봉투값 등)
                <button type="button" className="linkbtn" onClick={() => setTotalTouched(false)}>합계로 맞추기</button></p>
            )}
          </div>
          <div className="field">
            <label>카테고리</label>
            <div className="chips">
              {cats.expense.map((c) => (
                <button key={c.name} type="button" className="chip" aria-pressed={c.name === category} onClick={() => setCategory(c.name)}>
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="pc-memo">메모</label>
            <input id="pc-memo" maxLength={100} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </>
      )}

      {members.length > 0 && (
        <div className="field">
          <label>누가 결제했나요</label>
          <div className="chips">
            {members.map((m) => (
              <button key={m.id} type="button" className="chip" aria-pressed={memberId === m.id} onClick={() => setMemberId(m.id)}>
                <span className="dot" style={{ background: memberColor(m) }} />{m.name}
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={memberId === null} onClick={() => setMemberId(null)}>
              <span className="dot" style={{ background: memberColor(null) }} />{SHARED_LABEL}
            </button>
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="pc-date">결제한 날</label>
        <input id="pc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        <button type="submit" className="btn primary">
          가계부에 기록 · {mode === 'combined' ? won(parseAmount(shownTotal)) : `${items.length}건 ${won(sumOfItems)}`}
        </button>
      </div>
    </form>
  );
}
