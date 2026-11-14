import { useId, useRef, useState } from 'react';
import { useCategories } from '../lib/categories';
import AddCategoryChip from './AddCategoryChip';
import TagInput from './TagInput';
import { useFormData } from '../lib/formData';
import { colorVar } from '../lib/members';
import { INSTALLMENT_OPTIONS } from '../lib/cards';
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
  const CATS = useCategories();
  const [category, setCategory] = useState(initial?.category || CATS.expense[0].name);
  const [date, setDate] = useState(initial?.date || defaultDate);
  const [memo, setMemo] = useState(initial?.memo || '');
  const { cards, tags: tagSuggestions } = useFormData();
  const [tags, setTags] = useState(initial?.tags || []);
  // 결제수단: null = 현금·체크카드 등, 카드 id = 신용카드 (삭제된 카드면 현금으로 보임)
  const [cardId, setCardId] = useState(initial?.cardId && cards.some((c) => c.id === initial.cardId) ? initial.cardId : null);
  const [inst, setInst] = useState(initial?.inst || 1);
  // 누가: 등록된 사람 id 또는 null(공동). 삭제된 사람이 지정돼 있던 내역은 공동으로 보임
  const validId = (id) => (id && members.some((m) => m.id === id) ? id : null);
  const [memberId, setMemberId] = useState(() => (initial ? validId(initial.memberId) : validId(defaultMemberId)));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false); // 저장 버튼 연타로 같은 내역이 두 번 만들어지는 것 방지

  // 수정 중인 내역의 카테고리가 삭제된 경우에도 그대로 보이게(말없이 바뀌지 않게) 목록 끝에 붙여 둠
  const cats = initial && initial.type === type && !CATS[type].some((c) => c.name === initial.category)
    ? [...CATS[type], { name: initial.category, icon: '📦' }]
    : CATS[type];
  const activeCategory = cats.some((c) => c.name === category) ? category : cats[0].name;

  const changeType = (t) => {
    setType(t);
    if (!CATS[t].some((c) => c.name === category)) setCategory(CATS[t][0].name);
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
        tags,
        // 수입에는 카드·할부 없음
        cardId: type === 'expense' && cardId && cards.some((c) => c.id === cardId) ? cardId : null,
        inst: type === 'expense' && cardId ? inst : 1,
        createdAt: initial?.createdAt || Date.now(),
      });
      if (!initial) { setAmount(''); setMemo(''); setMemberId(validId(defaultMemberId)); setTags([]); setInst(1); }
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
          {cats.map(({ name: c, icon }) => (
            <button key={c} type="button" className="chip" aria-pressed={c === activeCategory} onClick={() => setCategory(c)}>
              {icon} {c}
            </button>
          ))}
          <AddCategoryChip type={type} onAdded={setCategory} />
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

      {type === 'expense' && cards.length > 0 && (
        <div className="field">
          <label>결제수단</label>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={cardId === null} onClick={() => { setCardId(null); setInst(1); }}>💵 현금·기타</button>
            {cards.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={cardId === c.id} onClick={() => setCardId(c.id)}>
                <span className="dot" style={{ background: colorVar(c.color) }} />{c.name}
              </button>
            ))}
          </div>
          {cardId && (
            <div className="inst-row">
              <label htmlFor={`${uid}-inst`}>할부</label>
              <select id={`${uid}-inst`} className="select sm" value={inst} onChange={(e) => setInst(Number(e.target.value))}>
                {INSTALLMENT_OPTIONS.map((n) => <option key={n} value={n}>{n === 1 ? '일시불' : `${n}개월`}</option>)}
              </select>
              {inst > 1 && parseAmount(amount) > 0 && (
                <span className="hint">월 약 {Math.floor(parseAmount(amount) / inst).toLocaleString('ko-KR')}원 · 가계부엔 산 날 전액으로 기록</span>
              )}
            </div>
          )}
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

      <div className="field">
        <label htmlFor={`${uid}-tags`}>태그</label>
        <TagInput id={`${uid}-tags`} value={tags} onChange={setTags} suggestions={tagSuggestions} />
      </div>

      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        {initial && onDelete && <button type="button" className="btn danger" onClick={onDelete}>삭제</button>}
        <button type="submit" className="btn primary" disabled={busy}>{initial ? '수정 완료' : '저장'}</button>
      </div>
    </form>
  );
}
