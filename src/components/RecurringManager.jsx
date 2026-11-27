import { useState } from 'react';
import { iconOf, useCategories } from '../lib/categories';
import { SHARED_LABEL, colorVar, findMember, groupByMember, memberColor } from '../lib/members';
import { newId, MAX_AMOUNT, MAX_MEMO } from '../lib/outbox';
import { MAX_RECURRING, dueMonths, monthlyTotals, nextDate, occurrenceDate, resumeRule, ymOf } from '../lib/recurring';
import { formatAmountInput, parseAmount, won } from '../lib/format';
import { useFormData } from '../lib/formData';
import TagInput from './TagInput';

const MAX_RULES = MAX_RECURRING;
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const dayLabel = (d) => (d === 31 ? '말일' : `${d}일`);
const fmtDate = (s) => { const [, m, d] = s.split('-').map(Number); return `${m}월 ${d}일`; };

/**
 * 반복 내역 목록 + 추가/수정. 바꿀 때마다 바로 저장(onSave(전체 목록, 안내 문구)).
 * rules 는 항상 최신 저장 상태(자동 등록으로 last가 바뀐 것 포함)를 받아서 그 위에 고침.
 */
// 묶음 머리글의 "매달 얼마" (진행 중인 규칙만)
const totalText = (rules) => {
  const t = monthlyTotals(rules);
  const parts = [t.exp ? `-${won(t.exp)}` : '', t.inc ? `+${won(t.inc)}` : ''].filter(Boolean);
  return parts.length ? `매달 ${parts.join(' / ')}` : '진행 중 없음';
};

export default function RecurringManager({ rules, members, meId = null, onSave }) {
  const [editing, setEditing] = useState(null); // null | 'new' | rule id
  const cats = useCategories();
  const { cards } = useFormData();
  const cardName = (id) => cards.find((c) => c.id === id)?.name || '삭제된 카드';
  const list = rules;
  const save = (next, msg, removed) => onSave(next, msg, removed);

  const upsertRule = (r) => {
    const exists = list.some((x) => x.id === r.id);
    save(exists ? list.map((x) => (x.id === r.id ? { ...r, last: x.last } : x)) : [...list, r], exists ? '반복 내역을 수정했어요' : '반복 내역을 추가했어요');
    setEditing(null);
  };

  if (editing) {
    const rule = editing === 'new' ? null : list.find((r) => r.id === editing);
    return <RuleForm rule={rule} members={members} meId={meId} onCancel={() => setEditing(null)} onDone={upsertRule} />;
  }

  return (
    <div className="form">
      <p className="hint">월세·통신비·구독료·월급처럼 매달 같은 날 생기는 돈을 등록하면, 그날이 되면 내역에 자동으로 기록돼요.</p>

      {list.length === 0 ? (
        <div className="empty-mini">등록된 반복 내역이 없어요.</div>
      ) : groupByMember(list, members, meId).map((g, _gi, groups) => {
        // 사람이 둘 이상(공동 포함)으로 나뉠 때만 묶음 이름을 보여 줌. 묶음 이름이 있으면 줄마다 붙던 이름표는 뺌
        const split = members.length > 0 && groups.length > 1;
        return (
        <section key={g.key} className="rule-group" aria-label={split ? `${g.label}의 반복 내역` : undefined}>
          {split && (
            <h4 className="fav-glabel rule-glabel">
              <span className="dot" style={{ background: g.color }} />{g.label}{g.isMe ? ' (나)' : ''} · {g.items.length}개
              <span className="rule-gsum num">{totalText(g.items)}</span>
            </h4>
          )}
        <ul className="rule-list">
          {g.items.map((r) => {
            const m = findMember(members, r.memberId);
            const next = nextDate(r);
            return (
              <li key={r.id} className={r.active ? '' : 'paused'}>
                <div className="ic">{iconOf(cats, r.type, r.category)}</div>
                <div className="meta">
                  <div className="cat">
                    {r.memo || r.category}
                    {members.length > 0 && !split && (
                      <span className="who-badge" style={{ marginLeft: 6 }}><span className="dot" style={{ background: memberColor(m) }} />{m ? m.name : SHARED_LABEL}</span>
                    )}
                  </div>
                  <div className="memo">
                    매달 {dayLabel(r.day)} · {r.category}{r.cardId ? ` · 💳 ${cardName(r.cardId)}` : ''}{r.tags?.length ? ` · ${r.tags.map((t) => `#${t}`).join(' ')}` : ''}
                    {r.active ? (next ? ` · 다음 ${fmtDate(next)}` : ' · 종료됨') : ' · 일시정지'}
                  </div>
                </div>
                <div className={`amt num ${r.type === 'income' ? 'inc' : ''}`}>{r.type === 'income' ? '+' : '-'}{won(r.amount)}</div>
                <div className="rule-actions">
                  <button type="button" className="linkbtn" onClick={() => save(list.map((x) => (x.id !== r.id ? x : x.active ? { ...x, active: false } : resumeRule(x))), r.active ? '일시정지했어요' : '다시 시작했어요 · 멈춰 있던 달은 기록하지 않아요')}>
                    {r.active ? '일시정지' : '다시 시작'}
                  </button>
                  <button type="button" className="linkbtn" onClick={() => setEditing(r.id)}>수정</button>
                  <button type="button" className="linkbtn danger-text" onClick={() => save(list.filter((x) => x.id !== r.id), '반복 내역을 삭제했어요', { item: r, index: list.indexOf(r) })}>삭제</button>
                </div>
              </li>
            );
          })}
        </ul>
        </section>
        );
      })}

      {list.length < MAX_RULES && (
        <button type="button" className="btn ghost" onClick={() => setEditing('new')}>+ 반복 내역 추가</button>
      )}
      <p className="hint">삭제하거나 일시정지해도 이미 기록된 내역은 그대로 남아요. 자동으로 기록된 내역에는 🔁 표시가 붙어요.</p>
    </div>
  );
}

function RuleForm({ rule, members, meId = null, onCancel, onDone }) {
  const cats = useCategories();
  const thisYm = ymOf(new Date());
  const [type, setType] = useState(rule?.type || 'expense');
  const [amount, setAmount] = useState(rule ? formatAmountInput(rule.amount) : '');
  const [category, setCategory] = useState(rule?.category || cats.expense[0].name);
  const [memo, setMemo] = useState(rule?.memo || '');
  // 새 규칙의 "누가"는 이 기기를 쓰는 사람으로 미리 선택 (즐겨찾기와 같게)
  const [memberId, setMemberId] = useState(() => { const id = rule ? rule.memberId : meId; return id && members.some((m) => m.id === id) ? id : null; });
  const [day, setDay] = useState(rule?.day || new Date().getDate());
  const [start, setStart] = useState(rule?.start || thisYm);
  const [end, setEnd] = useState(rule?.end || '');
  const [error, setError] = useState('');
  const { cards, tags: tagSuggestions } = useFormData();
  const [cardId, setCardId] = useState(rule?.cardId && cards.some((c) => c.id === rule.cardId) ? rule.cardId : null);
  const [tags, setTags] = useState(Array.isArray(rule?.tags) ? rule.tags : []);

  const list = cats[type];
  const activeCat = list.some((c) => c.name === category) ? category : list[0].name;
  const todayNum = new Date().getDate();
  const thisMonthDate = occurrenceDate(thisYm, day);
  // 이번 달부터 시작하는데 날짜가 이미 지났으면 저장하자마자 이번 달 내역이 생긴다는 걸 미리 알려줌
  // 시작 월을 지난달 이전으로 고르면 그 달들도 한꺼번에 기록됨 → 몇 개월인지 미리 알려줌
  const due = !rule && /^\d{4}-\d{2}$/.test(start) ? dueMonths({ active: true, start, end: end || null, last: null, day }).map((x) => x.ym) : [];
  const willCreateNow = due.length > 0;
  const mLabel = (ym) => `${Number(ym.slice(5))}월`;

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
      memo: memo.trim().slice(0, MAX_MEMO),
      memberId,
      day: Number(day),
      start,
      end: end || null,
      last: rule?.last ?? null, // 이미 등록한 달은 유지 → 수정해도 지난 달이 다시 생기지 않음
      active: rule?.active ?? true,
      ...(rule?.srcTx ? { srcTx: rule.srcTx } : {}), // 내역에서 반복으로 바꾼 경우 그 내역과의 연결 유지
      ...(type === 'expense' && cardId && cards.some((c) => c.id === cardId) ? { cardId } : {}), // 결제 카드 (일시불)
      ...(tags.length ? { tags } : {}),
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
        <input id="rr-memo" maxLength={MAX_MEMO} placeholder="예: 월세, 넷플릭스, 월급" value={memo} onChange={(e) => setMemo(e.target.value)} />
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
      {type === 'expense' && cards.length > 0 && (
        <div className="field">
          <label>결제</label>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={cardId === null} onClick={() => setCardId(null)}>💵 현금·기타</button>
            {cards.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={cardId === c.id} onClick={() => setCardId(c.id)}>
                <span className="dot" style={{ background: colorVar(c.color) }} />{c.name}
              </button>
            ))}
          </div>
          {cardId && <p className="hint">일시불로 기록되고, 그 카드의 청구 예정에 잡혀요.</p>}
        </div>
      )}
      <div className="field">
        <label htmlFor="rr-tags">태그</label>
        <TagInput id="rr-tags" value={tags} onChange={setTags} suggestions={tagSuggestions} />
      </div>
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
      {willCreateNow && (due.length === 1 && due[0] === thisYm
        ? <p className="hint warn-text">이번 달 {dayLabel(day)}이 이미 지나서, 저장하면 이번 달 내역이 바로 기록돼요. 다음 달부터 시작하려면 시작 월을 바꿔 주세요.</p>
        : <p className="hint warn-text">저장하면 {mLabel(due[0])}~{mLabel(due[due.length - 1])} {due.length}개월 내역이 바로 기록돼요. 지난 달을 채울 게 아니면 시작 월을 이번 달 이후로 바꿔 주세요.</p>)}
      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>취소</button>
        <button type="submit" className="btn primary">{rule ? '수정 완료' : '추가'}</button>
      </div>
    </form>
  );
}
