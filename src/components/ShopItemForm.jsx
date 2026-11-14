import { useRef, useState } from 'react';
import { useCategories } from '../lib/categories';
import AddCategoryChip from './AddCategoryChip';
import { normalizeName } from '../lib/analysis';
import { SHARED_LABEL, memberColor } from '../lib/members';
import { formatAmountInput, parseAmount, won } from '../lib/format';
import { MAX_AMOUNT, MAX_MEMO } from '../lib/outbox';
import MemoLinks from './MemoLinks';
import { MAX_ITEM_NAME, MAX_QTY } from '../lib/shopping';

/** 장보기 물품 추가·수정. onSubmit(data), onDelete() */
const fmtDate = (s) => { if (!s) return ''; const [, m, d] = s.split('-').map(Number); return `${m}월 ${d}일`; };

/** prefill: 빠른 추가 칸에서 "자세히"로 넘어올 때 입력해 둔 값 { name, price, category } */
export default function ShopItemForm({ initial, prefill, members = [], defaultMemberId = null, onSubmit, onDelete, lastPrices = {} }) {
  const cats = useCategories();
  const defaultCat = cats.expense.some((c) => c.name === '식비') ? '식비' : cats.expense[0].name;
  const [name, setName] = useState(initial?.name || prefill?.name || '');
  const [qty, setQty] = useState(initial?.qty || 1);
  const [price, setPrice] = useState(() => {
    if (initial?.price) return formatAmountInput(initial.price);
    if (prefill?.price) return formatAmountInput(prefill.price);
    const lp = !initial && prefill?.name ? lastPrices[normalizeName(prefill.name)] : null;
    return lp ? formatAmountInput(lp.unit) : '';
  });
  const [category, setCategory] = useState(initial?.category || prefill?.category || defaultCat);
  const validId = (id) => (id && members.some((m) => m.id === id) ? id : null);
  const [memberId, setMemberId] = useState(initial ? validId(initial.memberId) : validId(defaultMemberId));
  const [memo, setMemo] = useState(initial?.memo || '');
  const [error, setError] = useState('');
  const busy = useRef(false);

  // 지난 구매가: 이름이 같은(띄어쓰기·대소문자 무시) 물품을 마지막으로 산 단가
  const last = lastPrices[normalizeName(name)];
  const list = cats.expense.some((c) => c.name === category) ? cats.expense : [...cats.expense, { name: category, icon: '📦' }];
  const unit = parseAmount(price);

  const submit = (e) => {
    e.preventDefault();
    if (busy.current) return;
    const n = name.trim();
    if (!n) { setError('물품 이름을 입력해 주세요.'); return; }
    const finalUnit = unit || (!initial && last ? last.unit : 0); // 비워 두면 지난 구매가 (새 물품일 때)
    if (finalUnit * qty > MAX_AMOUNT) { setError('금액이 너무 커요.'); return; }
    busy.current = true;
    onSubmit({
      name: n.slice(0, MAX_ITEM_NAME),
      qty,
      price: finalUnit,
      category,
      memberId: validId(memberId),
      memo: memo.trim().slice(0, MAX_MEMO),
      checked: initial?.checked ?? false,
      status: initial?.status || 'todo',
      paid: initial?.paid ?? null,
      txId: initial?.txId ?? null,
      boughtAt: initial?.boughtAt ?? null,
      createdAt: initial?.createdAt || Date.now(),
    });
    busy.current = false;
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="si-name">물품</label>
        <input id="si-name" autoFocus maxLength={MAX_ITEM_NAME} placeholder="예: 우유, 계란, 휴지" value={name} list="shop-names"
          onChange={(e) => { setName(e.target.value); setError(''); }}
 />
        <datalist id="shop-names">{Object.values(lastPrices).map((p) => <option key={p.name} value={p.name} />)}</datalist>
      </div>
      <div className="row2">
        <div className="field">
          <label>수량</label>
          <div className="stepper">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="수량 줄이기" disabled={qty <= 1}>−</button>
            <input inputMode="numeric" aria-label="수량" value={qty}
              onChange={(e) => setQty(Math.min(MAX_QTY, Math.max(1, parseInt(e.target.value.replace(/\D/g, ''), 10) || 1)))} />
            <button type="button" onClick={() => setQty((q) => Math.min(MAX_QTY, q + 1))} aria-label="수량 늘리기">+</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="si-price">예상 단가 <span style={{ fontWeight: 400 }}>(몰라도 돼요)</span></label>
          <div className="amount-input sm">
            <input id="si-price" inputMode="numeric" placeholder={last ? `${last.unit.toLocaleString('ko-KR')} (지난번)` : '미정'} value={price}
              onChange={(e) => setPrice(formatAmountInput(parseAmount(e.target.value)))} />
            <span>원</span>
          </div>
        </div>
      </div>
      {last && (
        <p className="hint last-price">
          지난번 {fmtDate(last.date)}에 <b>{won(last.unit)}</b>
          {unit ? (unit !== last.unit ? ` (지금 입력 ${unit > last.unit ? '+' : ''}${won(unit - last.unit)})` : '') : !initial ? ' · 비워 두면 이 가격으로 넣어요' : ''}
          {unit > 0 && unit !== last.unit && <button type="button" className="linkbtn" onClick={() => setPrice(formatAmountInput(last.unit))}>이 가격으로</button>}
        </p>
      )}
      {unit > 0 && qty > 1 && <p className="hint">예상 금액 {won(unit)} × {qty} = <b>{won(unit * qty)}</b></p>}
      <div className="field">
        <label>카테고리 <span style={{ fontWeight: 400 }}>(가계부에 기록될 때)</span></label>
        <div className="chips">
          {list.map((c) => (
            <button key={c.name} type="button" className="chip" aria-pressed={c.name === category} onClick={() => setCategory(c.name)}>
              {c.icon} {c.name}
            </button>
          ))}
          <AddCategoryChip type="expense" onAdded={setCategory} />
        </div>
      </div>
      {members.length > 0 && (
        <div className="field">
          <label>누가</label>
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
        <label htmlFor="si-memo">메모</label>
        <input id="si-memo" maxLength={MAX_MEMO} placeholder="예: 1+1 행사, 저지방" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <MemoLinks text={memo} />
      </div>
      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        {initial && onDelete && <button type="button" className="btn danger" onClick={onDelete}>삭제</button>}
        <button type="submit" className="btn primary">{initial ? '수정 완료' : '추가'}</button>
      </div>
    </form>
  );
}
