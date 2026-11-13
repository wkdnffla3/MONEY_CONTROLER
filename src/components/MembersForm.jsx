import { useState } from 'react';
import { newId } from '../lib/outbox';
import { COLOR_COUNT, MAX_MEMBERS, MAX_NAME, colorVar } from '../lib/members';

/**
 * 함께 쓰는 사람 관리 + 이 기기를 쓰는 사람 선택.
 * onSave(members, meId) — members: [{ id, name, color }]
 */
export default function MembersForm({ members, meId, onSave }) {
  const [list, setList] = useState(() => members.map((m) => ({ ...m })));
  const [me, setMeLocal] = useState(meId && members.some((m) => m.id === meId) ? meId : null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const usedColors = new Set(list.map((m) => m.color));
  const nextColor = () => {
    for (let i = 0; i < COLOR_COUNT; i += 1) if (!usedColors.has(i)) return i;
    return list.length % COLOR_COUNT;
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (list.length >= MAX_MEMBERS) { setError(`최대 ${MAX_MEMBERS}명까지 등록할 수 있어요.`); return; }
    if (list.some((m) => m.name === name)) { setError('같은 이름이 이미 있어요.'); return; }
    const m = { id: newId(), name: name.slice(0, MAX_NAME), color: nextColor() };
    setList((l) => [...l, m]);
    if (!me) setMeLocal(m.id);
    setNewName('');
    setError('');
  };

  const rename = (id, name) => setList((l) => l.map((m) => (m.id === id ? { ...m, name: name.slice(0, MAX_NAME) } : m)));
  const cycleColor = (id) => setList((l) => l.map((m) => (m.id === id ? { ...m, color: (m.color + 1) % COLOR_COUNT } : m)));
  const remove = (id) => {
    setList((l) => l.filter((m) => m.id !== id));
    if (me === id) setMeLocal(null);
  };

  const submit = (e) => {
    e.preventDefault();
    const cleaned = list.map((m) => ({ ...m, name: m.name.trim() }));
    if (cleaned.some((m) => !m.name)) { setError('이름이 비어 있는 사람이 있어요.'); return; }
    if (new Set(cleaned.map((m) => m.name)).size !== cleaned.length) { setError('같은 이름이 두 번 있어요.'); return; }
    onSave(cleaned, me);
  };

  const removedCount = members.filter((m) => !list.some((x) => x.id === m.id)).length;

  return (
    <form className="form" onSubmit={submit} noValidate>
      <p className="hint">한 계정을 함께 쓰는 사람을 등록하면, 내역마다 누가 썼는지 고르고 사람별로 합계를 볼 수 있어요.</p>

      {list.length > 0 && (
        <ul className="member-edit">
          {list.map((m) => (
            <li key={m.id}>
              <button type="button" className="swatch" style={{ background: colorVar(m.color) }}
                onClick={() => cycleColor(m.id)} aria-label={`${m.name} 색 바꾸기`} title="눌러서 색 바꾸기" />
              <input value={m.name} maxLength={MAX_NAME} onChange={(e) => rename(m.id, e.target.value)} aria-label="이름" />
              <label className="me-radio" title="이 기기에서 입력할 때 기본으로 선택">
                <input type="radio" name="me" checked={me === m.id} onChange={() => setMeLocal(m.id)} /> 나
              </label>
              <button type="button" className="iconbtn del" onClick={() => remove(m.id)} aria-label={`${m.name} 삭제`}>✕</button>
            </li>
          ))}
        </ul>
      )}

      {list.length < MAX_MEMBERS && (
        <div className="member-add">
          <input
            value={newName}
            maxLength={MAX_NAME}
            placeholder={list.length ? '이름 추가 (예: 아빠)' : '이름 (예: 엄마)'}
            onChange={(e) => { setNewName(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            aria-label="새 사람 이름"
          />
          <button type="button" className="btn ghost sm" onClick={add} disabled={!newName.trim()}>추가</button>
        </div>
      )}

      {list.length > 0 && (
        <p className="hint">"나"로 고른 사람이 이 기기에서 입력할 때 기본으로 선택돼요. 기기마다 따로 정할 수 있어요.</p>
      )}
      {removedCount > 0 && (
        <p className="hint warn-text">삭제한 사람의 내역은 지워지지 않고 "공동"으로 보여요.</p>
      )}

      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        <button type="submit" className="btn primary">저장</button>
      </div>
    </form>
  );
}
