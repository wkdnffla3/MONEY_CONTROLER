import { useEffect, useRef } from 'react';
import { CloseIcon } from './Icons';
import ScreenBoundary from './ScreenBoundary';

/** 모바일에서는 아래에서 올라오는 시트, 태블릿 이상에서는 가운데 모달 */
export default function Sheet({ title, onClose, children }) {
  const lastFocus = useRef(null);

  useEffect(() => {
    lastFocus.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      lastFocus.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="overlay open"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sheet">
        <div className="grab" />
        <h3>
          <span>{title}</span>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="닫기"><CloseIcon /></button>
        </h3>
        <ScreenBoundary>{children}</ScreenBoundary>
      </div>
    </div>
  );
}
