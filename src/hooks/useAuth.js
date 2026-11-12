import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * 로그인 상태.
 * - session: undefined(확인 중) | null(로그아웃) | Session
 * - recovering: 비밀번호 재설정 메일 링크로 들어온 상태
 */
export function useAuth() {
  const [session, setSession] = useState(undefined);
  const [recovering, setRecovering] = useState(() => /type=recovery/.test(window.location.hash));

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  const endRecovery = useCallback(() => {
    setRecovering(false);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const signOut = useCallback(() => supabase?.auth.signOut(), []);

  return {
    loading: session === undefined,
    user: session?.user ?? null,
    recovering,
    endRecovery,
    signOut,
  };
}
