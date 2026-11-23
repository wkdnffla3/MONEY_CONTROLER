import { useCallback, useEffect, useRef, useState } from 'react';

/** 화면 아래 잠깐 뜨는 알림. undo를 넘기면 "되돌리기" 버튼이 붙음 */
export function useToast() {
  const [toast, setToast] = useState(null); // { msg, undo, label, key }
  const timer = useRef();

  const hide = useCallback(() => setToast(null), []);
  // opts.label: 버튼 글자(기본 "되돌리기"), opts.ms: 보이는 시간
  const show = useCallback((msg, undo, opts = {}) => {
    clearTimeout(timer.current);
    setToast({ msg, undo, label: opts.label, key: Date.now() });
    timer.current = setTimeout(hide, opts.ms || (undo ? 5000 : 2600));
  }, [hide]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, show, hide };
}
