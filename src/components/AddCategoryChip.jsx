import { useRef, useState } from 'react';
import { MAX_CATEGORY_NAME, useCategoryActions } from '../lib/categories';

/**
 * 카테고리 칩 목록 끝에 붙는 "+ 카테고리 추가" 버튼.
 * 누르면 그 자리에서 아이콘·이름을 입력하는 작은 칸이 열리고, 추가하면 onAdded(이름)으로 선택까지 함.
 * (폼 안에 있어도 엔터가 바깥 폼을 제출하지 않게 함)
 */
export default function AddCategoryChip({ type, onAdded }) {
  const addCategory = useCategoryActions();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏷️');
  const [error, setError] = useState('');
  const nameRef = useRef(null);

  if (!addCategory) return null;

  const submit = () => {
    const n = name.trim();
    const err = addCategory(type, n, [...(icon.trim() || '🏷️')].slice(0, 2).join(''));
    if (err) { setError(err); nameRef.current?.focus(); return; }
    onAdded(n);
    setOpen(false); setName(''); setIcon('🏷️'); setError('');
  };

  if (!open) {
    return (
      <button type="button" className="chip add-chip" onClick={() => { setOpen(true); setTimeout(() => nameRef.current?.focus(), 0); }}>
        + 카테고리 추가
      </button>
    );
  }

  return (
    <div className="add-cat" role="group" aria-label="새 카테고리">
      <input className="icon-in" value={icon} aria-label="새 카테고리 아이콘"
        onChange={(e) => setIcon([...e.target.value].slice(-2).join(''))} />
      <input ref={nameRef} value={name} maxLength={MAX_CATEGORY_NAME} placeholder={type === 'income' ? '예: 상여금' : '예: 반려동물'}
        aria-label="새 카테고리 이름"
        onChange={(e) => { setName(e.target.value); setError(''); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }} />
      <button type="button" className="btn primary sm" onClick={submit} disabled={!name.trim()}>추가</button>
      <button type="button" className="iconbtn sm" onClick={() => { setOpen(false); setError(''); }} aria-label="취소">✕</button>
      {error && <div className="err add-cat-err" aria-live="polite">{error}</div>}
    </div>
  );
}
