import { useMemo, useState } from 'react';
import { DEFAULT_CATEGORIES, MAX_CATEGORIES, MAX_CATEGORY_NAME, useCategories } from '../lib/categories';

const TYPES = [['expense', '지출'], ['income', '수입']];
const clone = (cats) => ({
  expense: cats.expense.map((c) => ({ ...c, orig: c.name })),
  income: cats.income.map((c) => ({ ...c, orig: c.name })),
});

/**
 * 카테고리 추가·이름 변경·아이콘·순서·삭제.
 * onSave(categories, renames) — renames = [{ type, from, to }] 이면 기존 내역도 새 이름으로 바뀜
 * counts: { 'expense:식비': 12, ... } 기존 내역 수 (안내용)
 */
export default function CategoryEditor({ counts, onSave }) {
  const current = useCategories();
  const [type, setType] = useState('expense');
  const [draft, setDraft] = useState(() => clone(current));
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('🏷️');
  const [error, setError] = useState('');

  const list = draft[type];
  const setList = (fn) => { setDraft((d) => ({ ...d, [type]: fn(d[type]) })); setError(''); };

  const renames = useMemo(() => TYPES.flatMap(([t]) => draft[t]
    .filter((c) => c.orig && c.orig !== c.name.trim() && c.name.trim())
    .map((c) => ({ type: t, from: c.orig, to: c.name.trim() }))), [draft]);
  const renamedCount = renames.reduce((a, r) => a + (counts[`${r.type}:${r.from}`] || 0), 0);
  const removed = TYPES.flatMap(([t]) => current[t]
    .filter((c) => !draft[t].some((d) => d.orig === c.name))
    .map((c) => ({ type: t, name: c.name })));
  const removedCount = removed.reduce((a, r) => a + (counts[`${r.type}:${r.name}`] || 0), 0);

  const move = (i, dir) => setList((l) => {
    const j = i + dir;
    if (j < 0 || j >= l.length) return l;
    const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (list.length >= MAX_CATEGORIES) { setError(`최대 ${MAX_CATEGORIES}개까지 만들 수 있어요.`); return; }
    if (list.some((c) => c.name.trim() === name)) { setError('같은 이름이 이미 있어요.'); return; }
    setList((l) => [...l, { name: name.slice(0, MAX_CATEGORY_NAME), icon: [...(newIcon.trim() || '🏷️')].slice(0, 2).join(''), orig: null }]);
    setNewName('');
  };

  const submit = (e) => {
    e.preventDefault();
    const out = {};
    for (const [t, label] of TYPES) {
      const items = draft[t].map((c) => ({ name: c.name.trim(), icon: (c.icon || '').trim() || '🏷️' }));
      if (!items.length) { setError(`${label} 카테고리가 하나는 있어야 해요.`); setType(t); return; }
      if (items.some((c) => !c.name)) { setError(`${label}에 이름이 빈 카테고리가 있어요.`); setType(t); return; }
      if (new Set(items.map((c) => c.name)).size !== items.length) { setError(`${label}에 같은 이름이 두 번 있어요.`); setType(t); return; }
      if (items.some((c) => c.icon.length > 8)) { setError('아이콘은 이모지 하나로 해 주세요.'); setType(t); return; }
      out[t] = items;
    }
    onSave(out, renames);
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="typeswitch" role="tablist" aria-label="종류">
        {TYPES.map(([t, label]) => (
          <button key={t} type="button" role="tab" data-t={t} aria-pressed={type === t} onClick={() => setType(t)}>{label}</button>
        ))}
      </div>

      <ul className="cat-edit">
        {list.map((c, i) => (
          <li key={`${c.orig ?? 'new'}-${i}`}>
            <input className="icon-in" value={c.icon} aria-label="아이콘"
              onChange={(e) => { const v = e.target.value; setList((l) => l.map((x, k) => (k === i ? { ...x, icon: [...v].slice(-2).join('') } : x))); }} />
            <input value={c.name} maxLength={MAX_CATEGORY_NAME} aria-label="이름"
              onChange={(e) => { const v = e.target.value; setList((l) => l.map((x, k) => (k === i ? { ...x, name: v } : x))); }} />
            <span className="cnt">{counts[`${type}:${c.orig}`] ? `${counts[`${type}:${c.orig}`]}건` : ''}</span>
            <button type="button" className="iconbtn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로">↑</button>
            <button type="button" className="iconbtn sm" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="아래로">↓</button>
            <button type="button" className="iconbtn sm del" onClick={() => setList((l) => l.filter((_, k) => k !== i))} aria-label={`${c.name} 삭제`}>✕</button>
          </li>
        ))}
      </ul>

      <div className="member-add" style={{ gridTemplateColumns: '52px 1fr auto' }}>
        <input className="icon-in" value={newIcon} aria-label="새 카테고리 아이콘" onChange={(e) => setNewIcon([...e.target.value].slice(-2).join(''))} />
        <input value={newName} maxLength={MAX_CATEGORY_NAME} placeholder="새 카테고리 이름" aria-label="새 카테고리 이름"
          onChange={(e) => { setNewName(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn ghost sm" onClick={add} disabled={!newName.trim()}>추가</button>
      </div>

      {renames.length > 0 && (
        <p className="hint">이름을 바꾼 카테고리: {renames.map((r) => `${r.from} → ${r.to}`).join(', ')}.
          {renamedCount > 0 && <> 기존 내역 <b>{renamedCount}건</b>도 새 이름으로 바뀌어요.</>} 반복 내역과 카테고리별 예산도 함께 옮겨져요.</p>
      )}
      {removed.length > 0 && (
        <p className="hint warn-text">삭제: {removed.map((r) => r.name).join(', ')}.
          {removedCount > 0 && ` 기존 내역 ${removedCount}건은 지워지지 않고 📦 표시로 남아요.`}</p>
      )}

      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={() => setDraft(clone(DEFAULT_CATEGORIES))}>기본값으로</button>
        <button type="submit" className="btn primary">저장</button>
      </div>
    </form>
  );
}
