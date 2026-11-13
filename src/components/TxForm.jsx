import { useId, useRef, useState } from 'react';
import { CATEGORIES } from '../lib/categories';
import { SHARED_LABEL, memberColor } from '../lib/members';
import { formatAmountInput, parseAmount } from '../lib/format';

const QUICK = [1000, 5000, 10000, 50000];
const quickLabel = (v) => (v >= 10000 ? `+${v / 10000}만` : `+${v / 1000}천`);
const MAX_AMOUNT = 9_999_999_999;

/**
 * 내역 입력/수정 폼.
 * initial 이 있으면 수정 모드(삭제 버튼 표시), 없으면 새 내역.
 * onSubmit(data) 는 Promise 를 돌려줘야 함 — 성공하면 새 내역 모드에서 입력값을 비움.
 */
export default function TxForm({ initial, defaultDate, onSubmit, onDelete, autoFocus, members = [], defaultMemberId = null }) {
  const uid = useId();
  const amountRef = useRef(null);
  const [type, setType] = useState(initial?.type || 'expense');
  const [amount, setAmount] = useState(initial ? formatAmountInput(initial.amount) : '');
  const [category, setCategory] = useState(initial?.category || CATEGORIES.expense[0][0]);
  const [date, setDate] = useState(initial?.date || defaultDate);
  const [memo, setMemo] = useState(initial?.memo || '');
  // 누가: 등록된 사람 id 또는 null(공동). 삭제된 사람이 지정돼 있던 내역은 공동으로 보임
  const validId = (id) => (id && members.some((m) => m.id === id) ? id : null);
  const [memberId, setMemberId] = useState(() => (initial ? validId(initial.memberId) : validId(defaultMemberId)));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false); // 저장 버튼 연타로 같은 내역이 두 번 만들어지는 것 방지

  const cats = CATEGORIES[type];
  const activeCategory = cats.some((c) => c[0] === category) ? category : cats[0][0];

  const changeType = (t) => {
    setType(t);
    if (!CATEGORIES[t].some((c) => c[0] === category)) setCategory(CATEGORIES[t][0][0]);
  };

  const addQuick = (v) => {
    setAmount(v ? formatAmountInput(parseAmount(amount) + v) : '');
    amountRef.current?.focus();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (submitting.current) return;
    const n = parseAmount(amount);
    if (!n) { setError('금액을 입력해 주세요.'); amountRef.current?.focus(); return; }
    if (n > MAX_AMOUNT) { setError('금액이 너무 커요.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('날짜를 선택해 주세요.'); return; }
    setError('');
    submitting.current = true;
    setBusy(true);
    try {
      await onSubmit({
        type,
        amount: n,
        category: activeCategory,
        memo: memo.trim(),
        date,
        memberId: validId(memberId),
        createdAt: initial?.createdAt || Date.now(),
      });
      if (!initial) { setAmount(''); setMemo(''); setMemberId(validId(defaultMemberId)); }
    } catch {
      // 오류 알림은 상위(App)에서 토스트로 표시
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="typeswitch" role="group" aria-label="유형">
        {[['expense', '지출'], ['income', '수입']].map(([t, label]) => (
          <button key={t} type="button" data-t={t} aria-pressed={type === t} onClick={() => changeType(t)}>{label}</button>
        ))}
      </div>

      <div className="field">
        <label htmlFor={`${uid}-amt`}>금액</label>
        <div className="amount-input">
          <input
            id={`${uid}-amt`}
            ref={amountRef}
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            autoFocus={autoFocus}
            value={amount}
            onChange={(e) => setAmount(formatAmountInput(parseAmount(e.target.value)))}
          />
          <span>원</span>
        </div>
        <div className="quick">
          {QUICK.map((v) => <button key={v} type="button" onClick={() => addQuick(v)}>{quickLabel(v)}</button>)}
          <button type="button" onClick={() => addQuick(0)}>지우기</button>
        </div>
      </div>

      <div className="field">
        <label>카테고리</label>
        <div className="chips">
          {cats.map(([c, icon]) => (
            <button key={c} type="button" className="chip" aria-pressed={c === activeCategory} onClick={() => setCategory(c)}>
              {icon} {c}
            </button>
          ))}
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

      <div className="row2">
        <div className="field">
          <label htmlFor={`${uid}-date`}>날짜</label>
          <input id={`${uid}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-memo`}>메모</label>
          <input id={`${uid}-memo`} maxLength={60} placeholder="예: 점심, 편의점" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
      </div>

      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        {initial && onDelete && <button type="button" className="btn danger" onClick={onDelete}>삭제</button>}
        <button type="submit" className="btn primary" disabled={busy}>{initial ? '수정 완료' : '저장'}</button>
      </div>
    </form>
  );
}
