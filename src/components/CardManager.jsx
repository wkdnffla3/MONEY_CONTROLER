import { useState } from 'react';
import { newId } from '../lib/outbox';
import { COLOR_COUNT, colorVar } from '../lib/members';
import { payDate, firstBillMonth } from '../lib/cards';
import { todayStr } from '../lib/format';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const dayLabel = (d) => (d === 31 ? '말일' : `${d}일`);
const fmt = (s) => { const [, m, d] = s.split('-').map(Number); return `${m}월 ${d}일`; };

/** 신용카드 등록·수정·삭제. 바꿀 때마다 바로 저장 onSave(목록, 안내 문구) */
export default function CardManager({ cards, usage, onSave }) {
  const [editing, setEditing] = useState(null); // null | 'new' | card id

  if (editing) {
    const card = editing === 'new' ? null : cards.find((c) => c.id === editing);
    return (
      <CardForm card={card} usedColors={new Set(cards.map((c) => c.color))} onCancel={() => setEditing(null)}
        onDone={(c) => {
          const exists = cards.some((x) => x.id === c.id);
          onSave(exists ? cards.map((x) => (x.id === c.id ? c : x)) : [...cards, c], exists ? '카드를 수정했어요' : `${c.name} 카드를 등록했어요`);
          setEditing(null);
        }} />
    );
  }

  return (
    <div className="form">
      <p className="hint">신용카드를 등록하면 내역 입력 때 카드와 할부를 고를 수 있고, 가계부 화면에서 카드별 결제 예정 금액을 볼 수 있어요.</p>
      {cards.length === 0 ? <div className="empty-mini">등록된 카드가 없어요.</div> : (
        <ul className="rule-list">
          {cards.map((c) => (
            <li key={c.id}>
              <div className="ic" style={{ background: colorVar(c.color), color: '#fff' }}>💳</div>
              <div className="meta">
                <div className="cat">{c.name}</div>
                <div className="memo">매달 {dayLabel(c.payDay)} 결제 · {dayLabel(c.closeDay)} 마감{usage[c.id] ? ` · 내역 ${usage[c.id]}건` : ''}</div>
              </div>
              <div />
              <div className="rule-actions">
                <button type="button" className="linkbtn" onClick={() => setEditing(c.id)}>수정</button>
                <button type="button" className="linkbtn danger-text" onClick={() => onSave(cards.filter((x) => x.id !== c.id), '카드를 삭제했어요')}>삭제</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cards.length < 10 && <button type="button" className="btn ghost" onClick={() => setEditing('new')}>+ 카드 등록</button>}
      <p className="hint">카드를 삭제해도 내역은 지워지지 않고 "현금·기타"로 보여요.</p>
    </div>
  );
}

function CardForm({ card, usedColors, onCancel, onDone }) {
  const firstFree = () => { for (let i = 0; i < COLOR_COUNT; i += 1) if (!usedColors.has(i)) return i; return 0; };
  const [name, setName] = useState(card?.name || '');
  const [payDay, setPayDay] = useState(card?.payDay || 14);
  const [closeDay, setCloseDay] = useState(card?.closeDay || 31);
  const [color, setColor] = useState(card?.color ?? firstFree());
  const [error, setError] = useState('');

  // 오늘 쓰면 언제 빠져나가는지 예시
  const sample = { id: 'x', payDay, closeDay };
  const example = payDate(sample, firstBillMonth(sample, todayStr()));

  const submit = (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) { setError('카드 이름을 입력해 주세요.'); return; }
    onDone({ id: card?.id || newId(), name: n.slice(0, 16), payDay, closeDay, color });
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="cd-name">카드 이름</label>
        <input id="cd-name" autoFocus maxLength={16} placeholder="예: 신한 Deep, 국민 체크" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} />
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="cd-pay">결제일</label>
          <select id="cd-pay" className="select" value={payDay} onChange={(e) => setPayDay(Number(e.target.value))}>
            {DAYS.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cd-close">이용 마감일</label>
          <select id="cd-close" className="select" value={closeDay} onChange={(e) => setCloseDay(Number(e.target.value))}>
            {DAYS.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
          </select>
        </div>
      </div>
      <p className="hint">
        {closeDay === 31
          ? `매달 1일~말일에 쓴 금액이 다음 달 ${dayLabel(payDay)}에 빠져나가요.`
          : `전달 ${closeDay + 1}일~이번 달 ${closeDay}일에 쓴 금액이 다음 달 ${dayLabel(payDay)}에 빠져나가요.`}
        {' '}오늘 쓰면 <b>{fmt(example)}</b> 결제예요. 카드사 안내문의 "이용 기간"을 보고 맞춰 주세요.</p>
      <div className="field">
        <label>색</label>
        <div className="chips">
          {Array.from({ length: COLOR_COUNT }, (_, i) => (
            <button key={i} type="button" className="swatch-btn" aria-pressed={color === i} aria-label={`색 ${i + 1}`}
              style={{ background: colorVar(i) }} onClick={() => setColor(i)} />
          ))}
        </div>
      </div>
      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>취소</button>
        <button type="submit" className="btn primary">{card ? '수정 완료' : '등록'}</button>
      </div>
    </form>
  );
}
