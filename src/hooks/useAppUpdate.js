import { useCallback, useEffect, useRef, useState } from 'react';

// 새 버전 배포 알림
// 홈 화면에 설치한 앱은 며칠씩 켜 둔 채로 쓰여서, 새로 배포해도 껐다 켤 때까지 예전 버전으로 돌아감.
// 가끔(화면으로 돌아올 때, 30분마다) 서버의 index.html 을 받아 지금 실행 중인 빌드 파일 이름과 비교 →
// 다르면 "새 버전이 있어요 · 새로고침" 띄움. (빌드 파일 이름에 내용 해시가 들어 있어서 배포하면 바뀜)
const CHECK_EVERY_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 5 * 60 * 1000;

/** index.html 안의 메인 빌드 파일 경로 (예: /assets/index-3f2a.js) */
export const buildOf = (html) => String(html || '').match(/<script\b[^>]*\bsrc="(\/assets\/[^"]+)"/)?.[1] || null;

export function useAppUpdate() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const last = useRef(0);
  const current = useRef(null);

  const check = useCallback(async (force = false) => {
    if (current.current === null) current.current = buildOf(document.documentElement.outerHTML) || '';
    if (!current.current) return; // 개발 서버(npm run dev) 등 빌드 파일이 없으면 끔
    if (navigator.onLine === false) return;
    const now = Date.now();
    if (!force && now - last.current < MIN_GAP_MS) return;
    last.current = now;
    try {
      const res = await fetch('/', { cache: 'no-store', headers: { 'x-update-check': '1' } });
      if (!res.ok) return;
      const b = buildOf(await res.text());
      if (b && b !== current.current) setAvailable(true);
    } catch { /* 오프라인·일시 오류: 다음에 다시 */ }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => check(true), 60 * 1000);
    const timer = setInterval(() => check(true), CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onVisible); };
  }, [check]);

  return { available: available && !dismissed, dismiss: () => setDismissed(true), check };
}
