import { useState } from 'react';
import { iconOf, useCategories } from '../lib/categories';
import { SHARED_LABEL, findMember, memberColor } from '../lib/members';
import { newId, MAX_AMOUNT } from '../lib/outbox';
import { nextDate, occurrenceDate, ymOf } from '../lib/recurring';
import { formatAmountInput, parseAmount, won } from '../lib/format';

const MAX_RULES = 50;
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const dayLabel = (d) => (d === 31 ? '말일' : `${d}일`);
const fmtDate = (s) => { const [, m, d] = s.split('-').map(Number); return `${m}월 ${d}일`; };

/**
 * 반복 내역 목록 + 추가/수정. 바꿀 때마다 바로 저장(onSave(전체 목록, 안내 문구)).
 * rules 는 항상 최신 저장 상태(자동 등록으로 last가 바뀐 것 포함)를 받아서 그 위에 고침.
 */
export default function RecurringManager({ rules, members, onSave }) {
  const [editing, setEditing] = useState(null); // null | 'new' | rule id
  const cats = useCategories();
  const list = rules;
  const save = (next, msg) => onSave(next, msg);

  const upsertRule = (r) => {
    const exists = list.some((x) => x.id === r.id);
    save(exists ? list.map((x) => (x.id === r.id ? { ...r, last: x.last } : x)) : [...list, r], exists ? '반복 내역을 수정했어요' : '반복 내역을 추가했어요');
    setEditing(null);
  };

  if (editing) {
    const rule = editing === 'new' ? null : list.find((r) => r.id === editing);
    return <RuleForm rule={rule} members={members} onCancel={() => setEditing(null)} onDone={upsertRule} />;
  }

  return (
    <div className="form">
      <p className="hint">월세·통신비·구독료·월급처럼 매달 같은 날 생기는 돈을 등록하면, 그날이 되면 내역에 자동으로 기록돼요.</p>

      {list.length === 0 ? (
        <div className="empty-mini">등록된 반복 내역이 없어요.</div>
      ) : (
        <ul className="rule-list">
          {list.map((r) => {
            const m = findMember(members, r.memberId);
            const next = nextDate(r);
            return (
              <li key={r.id} className={r.active ? '' : 'paused'}>
                <div className="ic">{iconOf(cats, r.type, r.category)}</div>
                <div className="meta">
                  <div className="cat">
                    {r.memo || r.category}
                    {members.length > 0 && (
                      <span className="who-badge" style={{ marginLeft: 6 }}><span className="dot" style={{ background: memberColor(m) }} />{m ? m.name : SHARED_LABEL}</span>
                    )}
                  </div>
                  <div className="memo">
                    매달 {dayLabel(r.day)} · {r.category}
                    {r.active ? (next ? ` · 다음 ${fmtDate(next)}` : ' · 종료됨') : ' · 일시정지'}
                  </div>
                </div>
                <div className={`amt num ${r.type === 'income' ? 'inc' : ''}`}>{r.type === 'income' ? '+' : '-'}{won(r.amount)}</div>
                <div className="rule-actions">
                  <button type="button" className="linkbtn" onClick={() => save(list.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)), r.active ? '일시정지했어요' : '다시 시작했어요')}>
                    {r.active ? '일시정지' : '다시 시작'}
                  </button>
                  <button type="button" className="linkbtn" onClick={() => setEditing(r.id)}>수정</button>
                  <button type="button" className="linkbtn danger-text" onClick={() => save(list.filter((x) => x.id !== r.id), '반복 내역을 삭제했어요')}>삭제</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {list.length < MAX_RULES && (
        <button type="button" className="btn ghost" onClick={() => setEditing('new')}>+ 반복 내역 추가</button>
      )}
      <p className="hint">삭제하거나 일시정지해도 이미 기록된 내역은 그대로 남아요. 자동으로 기록된 내역에는 🔁 표시가 붙어요.</p>
    </div>
  );
}

function RuleForm({ rule, members, onCancel, onDone }) {
  const cats = useCategories();
  const thisYm = ymOf(new Date());
  const [type, setType] = useState(rule?.type || 'expense');
  const [amount, setAmount] = useState(rule ? formatAmountInput(rule.amount) : '');
  const [category, setCategory] = useState(rule?.category || cats.expense[0].name);
  const [memo, setMemo] = useState(rule?.memo || '');
  const [memberId, setMemberId] = useState(rule?.memberId && members.some((m) => m.id === rule.memberId) ? rule.memberId : null);
  const [day, setDay] = useState(rule?.day || new Date().getDate());
  const [start, setStart] = useState(rule?.start || thisYm);
  const [end, setEnd] = useState(rule?.end || '');
  const [error, setError] = useState('');

  const list = cats[type];
  const activeCat = list.some((c) => c.name === category) ? category : list[0].name;
  const todayNum = new Date().getDate();
  const thisMonthDate = occurrenceDate(thisYm, day);
  // 이번 달부터 시작하는데 날짜가 이미 지났으면 저장하자마자 이번 달 내역이 생긴다는 걸 미리 알려줌
  const willCreateNow = !rule && start <= thisYm && Number(thisMonthDate.slice(8)) <= todayNum;

  const submit = (e) => {
    e.preventDefault();
    const n = parseAmount(amount);
    if (!n) { setError('금액을 입력해 주세요.'); return; }
    if (n > MAX_AMOUNT) { setError('금액이 너무 커요.'); return; }
    if (!/^\d{4}-\d{2}$/.test(start)) { setError('시작 월을 선택해 주세요.'); return; }
    if (end && end < start) { setError('끝나는 월이 시작 월보다 빨라요.'); return; }
    onDone({
      id: rule?.id || newId(),
      type,
      amount: n,
      category: activeCat,
      memo: memo.trim().slice(0, 100),
      memberId,
      day: Number(day),
      start,
      end: end || null,
      last: rule?.last ?? null, // 이미 등록한 달은 유지 → 수정해도 지난 달이 다시 생기지 않음
      active: rule?.active ?? true,
    });
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="typeswitch" role="group" aria-label="유형">
        {[['expense', '지출'], ['income', '수입']].map(([t, label]) => (
          <button key={t} type="button" data-t={t} aria-pressed={type === t} onClick={() => setType(t)}>{label}</button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="rr-amt">금액</label>
        <div className="amount-input">
          <input id="rr-amt" inputMode="numeric" placeholder="0" autoFocus value={amount}
            onChange={(e) => setAmount(formatAmountInput(parseAmount(e.target.value)))} />
          <span>원</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="rr-memo">이름</label>
        <input id="rr-memo" maxLength={60} placeholder="예: 월세, 넷플릭스, 월급" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </div>
      <div className="field">
        <label>카테고리</label>
        <div className="chips">
          {list.map((c) => (
            <button key={c.name} type="button" className="chip" aria-pressed={c.name === activeCat} onClick={() => setCategory(c.name)}>
              {c.icon} {c.name}
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
          <label htmlFor="rr-day">매달</label>
          <select id="rr-day" className="select" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {DAYS.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rr-start">시작 월</label>
          <input id="rr-start" type="month" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="rr-end">끝나는 월 <span style={{ fontWeight: 400 }}>(비워 두면 계속)</span></label>
        <input id="rr-end" type="month" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      {day >= 29 && <p className="hint">{day}일이 없는 달에는 그 달의 마지막 날에 기록돼요.</p>}
      {willCreateNow && <p className="hint warn-text">이번 달 {dayLabel(day)}이 이미 지나서, 저장하면 이번 달 내역이 바로 기록돼요. 다음 달부터 시작하려면 시작 월을 바꿔 주세요.</p>}
      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>취소</button>
        <button type="submit" className="btn primary">{rule ? '수정 완료' : '추가'}</button>
      </div>
    </form>
  );
}
