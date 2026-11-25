import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon } from './Icons';
import ScreenBoundary from './ScreenBoundary';

/**
 * 열린 시트의 "닫아도 되나" 확인 (휴대폰 뒤로 가기에서 App이 물어봄).
 * blocked(): 입력하다 만 내용이 있으면 확인 창을 띄우고 true
 */
export const sheetGuard = { blocked: null };

/**
 * 모바일에서는 아래에서 올라오는 시트, 태블릿 이상에서는 가운데 모달
 * guard: 입력 양식 시트. 입력하다가 바깥을 누르거나 Esc·뒤로 가기·✕로 닫으려 하면 한 번 물어봄
 *        (저장하면(submit) 다시 처음 상태로 → 저장 후 계속 열려 있는 시트도 그냥 닫힘)
 */
export default function Sheet({ title, onClose, children, guard = false }) {
  const lastFocus = useRef(null);
  // 입력이 생긴 양식들. 저장(submit)하면 빼고, 취소로 양식이 사라지면(isConnected=false) 입력 중이 아닌 것으로 봄
  const dirty = useRef(new Set());
  const isDirty = () => [...dirty.current].some((el) => el.isConnected);
  const [asking, setAsking] = useState(false);

  const blocked = useCallback(() => {
    if (!guard || !isDirty()) return false;
    setAsking(true);
    return true;
  }, [guard]);
  const tryClose = useCallback(() => { if (!blocked()) onClose(); }, [blocked, onClose]);

  useEffect(() => {
    lastFocus.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      lastFocus.current?.focus?.();
    };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (asking) setAsking(false); else tryClose(); } };
    document.addEventListener('keydown', onKey);
    sheetGuard.blocked = blocked;
    return () => {
      document.removeEventListener('keydown', onKey);
      if (sheetGuard.blocked === blocked) sheetGuard.blocked = null;
    };
  }, [tryClose, blocked, asking]);

  return (
    <div
      className="overlay open"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) tryClose(); }}
    >
      <div className="sheet" onInput={(e) => { dirty.current.add(e.target.closest('form') || e.currentTarget); }}
        onSubmitCapture={(e) => { dirty.current.delete(e.target); }}>
        <div className="grab" />
        <h3>
          <span>{title}</span>
          <button type="button" className="iconbtn" onClick={tryClose} aria-label="닫기"><CloseIcon /></button>
        </h3>
        {asking && (
          <div className="leave-ask" role="alertdialog" aria-label="저장하지 않고 닫을까요?">
            <span>입력한 내용이 저장되지 않았어요. 닫을까요?</span>
            <button type="button" className="btn ghost sm" autoFocus onClick={() => setAsking(false)}>계속 입력</button>
            <button type="button" className="btn danger sm" onClick={() => { dirty.current.clear(); setAsking(false); onClose(); }}>닫기</button>
          </div>
        )}
        <ScreenBoundary>{children}</ScreenBoundary>
      </div>
    </div>
  );
}
