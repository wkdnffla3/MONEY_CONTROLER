import { useState } from 'react';
import { MAX_TAGS, MAX_TAG_LEN } from '../lib/outbox';

const clean = (s) => s.replace(/^#+/, '').replace(/[,\s]+/g, ' ').trim().slice(0, MAX_TAG_LEN);

/** 태그 입력: 엔터·쉼표로 추가, ✕로 빼기, 예전에 쓴 태그 추천 */
export default function TagInput({ value, onChange, suggestions = [], id }) {
  const [text, setText] = useState('');
  const full = value.length >= MAX_TAGS;

  const add = (raw) => {
    const t = clean(raw);
    if (!t || value.includes(t) || full) { setText(''); return; }
    onChange([...value, t]);
    setText('');
  };
  const typed = clean(text).toLowerCase();
  const recs = suggestions.filter((s) => !value.includes(s) && (!typed || s.toLowerCase().includes(typed))).slice(0, 6);

  return (
    <div className="tag-input">
      <div className="tag-box">
        {value.map((t) => (
          <span key={t} className="tag">#{t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`${t} 태그 빼기`}>✕</button>
          </span>
        ))}
        {!full && (
          <input id={id} value={text} maxLength={MAX_TAG_LEN + 1} placeholder={value.length ? '' : '예: 여행, 명절 (엔터로 추가)'}
            aria-label="태그 입력"
            onChange={(e) => { const v = e.target.value; if (/[,]/.test(v)) add(v); else setText(v); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); add(text); }
              if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={() => { if (text.trim()) add(text); }} />
        )}
      </div>
      {!full && recs.length > 0 && (
        <div className="tag-recs">
          {recs.map((s) => <button key={s} type="button" className="tag-rec" onClick={() => add(s)}>#{s}</button>)}
        </div>
      )}
      {full && <p className="hint">태그는 {MAX_TAGS}개까지 달 수 있어요.</p>}
    </div>
  );
}
