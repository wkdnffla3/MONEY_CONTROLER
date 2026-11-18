import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 옆으로 넘기는 줄을 PC에서도 넘길 수 있게:
 *  - 마우스 휠(세로)을 옆으로 바꿔 줌. 줄 끝에 닿으면 원래대로 화면이 세로로 내려감
 *  - 마우스로 끌어서 넘기기 (5px 넘게 끌었으면 손을 뗄 때의 클릭은 무시 → 즐겨찾기가 실수로 저장되지 않음)
 *  - edge: 왼쪽/오른쪽에 더 볼 게 있는지 (◀ ▶ 버튼 표시용), by(-1|1): 한 화면만큼 넘기기
 * 휴대폰 터치·트랙패드 가로 스와이프는 브라우저 기본 동작 그대로.
 */
export function useHScroll(watch) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    update();

    const onWheel = (e) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // 확대·트랙패드 가로 스와이프는 그대로
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1);
      if ((dy < 0 && el.scrollLeft <= 0) || (dy > 0 && el.scrollLeft >= max - 1)) return; // 끝이면 화면 스크롤
      e.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + dy));
    };

    let down = null;
    let dragged = false;
    const onDown = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || el.scrollWidth <= el.clientWidth + 1) return;
      down = { x: e.clientX, left: el.scrollLeft };
      dragged = false;
    };
    const onMove = (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (!dragged && Math.abs(dx) < 5) return;
      dragged = true;
      el.classList.add('dragging');
      el.scrollLeft = down.left - dx;
    };
    const onUp = () => {
      if (!down) return;
      down = null;
      el.classList.remove('dragging');
    };
    const onClick = (e) => {
      if (!dragged) return;
      dragged = false;
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', update, { passive: true });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('click', onClick, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', update);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('click', onClick, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [watch]);

  const by = useCallback((dir) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: 'smooth' });
  }, []);

  return { ref, edge, by };
}
