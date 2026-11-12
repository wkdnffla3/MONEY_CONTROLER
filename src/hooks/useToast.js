import { useCallback, useEffect, useRef, useState } from 'react';

/** 화면 아래 잠깐 뜨는 알림. undo를 넘기면 "되돌리기" 버튼이 붙음 */
export function useToast() {
  const [toast, setToast] = useState(null); // { msg, undo, key }
  const timer = useRef();

  const hide = useCallback(() => setToast(null), []);
  const show = useCallback((msg, undo) => {
    clearTimeout(timer.current);
    setToast({ msg, undo, key: Date.now() });
    timer.current = setTimeout(hide, undo ? 5000 : 2600);
  }, [hide]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, show, hide };
}
