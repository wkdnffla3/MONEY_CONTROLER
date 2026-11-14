import { useCallback, useEffect, useRef, useState } from 'react';
import { buildNotification, getPrefs, shouldSend } from '../lib/notify';
import { hasPushSubscription } from '../lib/push';

const SHOW_MS = 6000;
const MAX_BANNERS = 3;

/**
 * 앱 안 알림 (방법 1): 앱이 열려 있는 동안 다른 기기에서 추가한 내역을 알려줌.
 * - 화면을 보고 있으면 위쪽 배너
 * - 다른 탭/앱으로 가 있으면(화면 숨김) 시스템 알림. 단, 이 기기에 웹 푸시가 켜져 있으면
 *   서버가 푸시를 보내므로 겹치지 않게 생략
 */
export function useNotifier(uid, members) {
  const [banners, setBanners] = useState([]);
  const [prefs, setPrefsState] = useState(() => (uid ? getPrefs(uid) : null));
  const pushOn = useRef(false);
  const membersRef = useRef(members);
  membersRef.current = members;
  const timers = useRef(new Map());

  useEffect(() => { setPrefsState(uid ? getPrefs(uid) : null); }, [uid]);
  const refreshPush = useCallback(() => { hasPushSubscription().then((v) => { pushOn.current = v; }, () => {}); }, []);
  useEffect(() => { refreshPush(); }, [uid, refreshPush]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setBanners((list) => list.filter((b) => b.id !== id));
  }, []);

  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

  const notify = useCallback((event) => {
    const p = prefsRef.current;
    if (!p) return;
    const n = buildNotification({ ...event, members: membersRef.current });
    if (!n || p[n.kind] === false) return;

    if (typeof document !== 'undefined' && document.hidden) {
      // 화면 숨김: 시스템 알림 (방해 금지 시간·웹 푸시 켜짐이면 생략)
      if (pushOn.current || !shouldSend(n.kind, p) || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const opts = { body: n.body, tag: n.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: n.url } };
      (navigator.serviceWorker?.getRegistration?.() || Promise.resolve(null))
        .then((reg) => (reg ? reg.showNotification(n.title, opts) : new Notification(n.title, opts)))
        .catch(() => {});
      return;
    }
    if (!p.inapp) return;
    const id = n.tag;
    setBanners((list) => [{ id, ...n }, ...list.filter((b) => b.id !== id)].slice(0, MAX_BANNERS));
    clearTimeout(timers.current.get(id));
    timers.current.set(id, setTimeout(() => dismiss(id), SHOW_MS));
  }, [dismiss]);

  return { banners, dismiss, notify, prefs, setPrefs: setPrefsState, refreshPush };
}
