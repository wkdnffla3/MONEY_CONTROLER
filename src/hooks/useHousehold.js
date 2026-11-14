import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHousehold, readHousehold, writeHousehold } from '../lib/household';

/**
 * 지금 보는 가계부. 공유 가계부에 참여 중이면 그 가계부 ID, 아니면 내 계정 ID.
 * 기기에 기억한 값으로 바로 시작하고(오프라인 대비), 서버 값을 받으면 바꿈.
 */
export function useHousehold(uid) {
  const [household, setHousehold] = useState(() => (uid ? readHousehold(uid) : null));
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!uid) return null;
    const my = ++seq.current;
    try {
      const h = await fetchHousehold(uid);
      if (my !== seq.current) return null;
      writeHousehold(uid, h);
      setHousehold(h);
      return h;
    } catch {
      return null; // 오프라인 등: 기억한 값 그대로
    }
  }, [uid]);

  useEffect(() => {
    setHousehold(uid ? readHousehold(uid) : null);
    if (!uid) return undefined;
    refresh();
    // 다른 사람이 나를 내보냈을 수 있으니 앱으로 돌아올 때 다시 확인
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', refresh); };
  }, [uid, refresh]);

  const ledgerId = uid ? (household?.ledgerId || uid) : null;
  return {
    ledgerId,
    isOwner: !household || household.isOwner,
    joined: !!household && !household.isOwner,
    personId: household?.personId ?? null,
    people: household?.people || [],
    supported: household ? household.supported !== false : true,
    loaded: !!household,
    refresh,
  };
}
