import { useCallback, useEffect, useState } from 'react';
import { isIOS, isStandalone } from '../lib/pwa';

const DISMISS_KEY = 'ledger.installDismissed';
const wasDismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

/**
 * "앱 설치" 안내.
 * - Android·PC Chrome/Edge: 브라우저의 설치 창을 버튼으로 띄움 (beforeinstallprompt)
 * - iPhone Safari: 설치 API가 없어서 "공유 → 홈 화면에 추가" 안내만 가능
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(wasDismissed);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    setDeferred(null);
  }, [deferred]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* 무시 */ }
  }, []);

  const mode = installed || dismissed ? null : deferred ? 'prompt' : isIOS() ? 'ios' : null;
  return { mode, install, dismiss };
}
