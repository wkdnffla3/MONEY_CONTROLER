import { useState } from 'react';
import { LogoIcon } from './Icons';
import { getRemember, redirectUrl, setRemember, supabase } from '../lib/supabase';
import { koError } from '../lib/errors';

const MIN_PW = 6;
const isEmail = (s) => /^\S+@\S+\.\S+$/.test(s);
const SUBMIT_LABEL = { login: '로그인', signup: '가입하기', reset: '재설정 메일 받기' };

/** 로그인 · 회원가입 · 비밀번호 찾기 */
export function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [remember, setRememberState] = useState(getRemember);
  const [msg, setMsg] = useState({ text: '', ok: false });
  const [busy, setBusy] = useState(false);

  const switchMode = (m) => { setMode(m); setMsg({ text: '', ok: false }); };
  const fail = (text) => setMsg({ text, ok: false });

  const submit = async (e) => {
    e.preventDefault();
    const addr = email.trim();
    if (!isEmail(addr)) return fail('이메일 주소를 확인해 주세요.');
    if (mode !== 'reset' && pw.length < MIN_PW) return fail(`비밀번호는 ${MIN_PW}자 이상이어야 해요.`);
    if (mode === 'signup' && pw !== pw2) return fail('비밀번호가 서로 달라요.');

    setBusy(true);
    setMsg({ text: '', ok: false });
    try {
      if (mode === 'login') {
        setRemember(remember);
        const { error } = await supabase.auth.signInWithPassword({ email: addr, password: pw });
        if (error) throw error;
        setPw('');
      } else if (mode === 'signup') {
        setRemember(true);
        const { data, error } = await supabase.auth.signUp({
          email: addr,
          password: pw,
          options: { emailRedirectTo: redirectUrl() },
        });
        if (error) throw error;
        // 이미 가입된 이메일이면 Supabase가 identities를 빈 배열로 돌려줌
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw new Error('already registered');
        }
        if (!data.session) {
          setMode('login'); setPw(''); setPw2('');
          setMsg({ text: '인증 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나고 자동으로 로그인돼요.', ok: true });
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: redirectUrl() });
        if (error) throw error;
        setMsg({ text: '비밀번호 재설정 메일을 보냈어요. 메일의 링크를 눌러 주세요.', ok: true });
      }
    } catch (err) {
      fail(koError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      {mode !== 'reset' && (
        <div className="typeswitch auth-tabs" role="tablist">
          <button type="button" role="tab" aria-pressed={mode === 'login'} onClick={() => switchMode('login')}>로그인</button>
          <button type="button" role="tab" aria-pressed={mode === 'signup'} onClick={() => switchMode('signup')}>회원가입</button>
        </div>
      )}

      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="auth-email">이메일</label>
          <input id="auth-email" type="email" autoComplete="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        {mode !== 'reset' && (
          <div className="field">
            <label htmlFor="auth-pw">비밀번호</label>
            <input id="auth-pw" type="password" placeholder={`${MIN_PW}자 이상`}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
        )}

        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="auth-pw2">비밀번호 확인</label>
            <input id="auth-pw2" type="password" autoComplete="new-password" placeholder="한 번 더 입력"
              value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
        )}

        {mode === 'login' && (
          <div className="auth-row">
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRememberState(e.target.checked)} /> 자동 로그인
            </label>
            <button type="button" className="linkbtn" onClick={() => switchMode('reset')}>비밀번호 찾기</button>
          </div>
        )}

        <div className={`err ${msg.ok ? 'ok' : ''}`} aria-live="polite">{msg.text}</div>
        <button className="btn primary" type="submit" disabled={busy}>{SUBMIT_LABEL[mode]}</button>
        {mode === 'reset' && (
          <button type="button" className="linkbtn" style={{ justifySelf: 'center' }} onClick={() => switchMode('login')}>
            ← 로그인으로 돌아가기
          </button>
        )}
      </form>
    </AuthShell>
  );
}

/** 비밀번호 재설정 메일의 링크로 들어왔을 때 */
export function NewPasswordScreen({ onDone }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (a.length < MIN_PW) return setMsg(`비밀번호는 ${MIN_PW}자 이상이어야 해요.`);
    if (a !== b) return setMsg('비밀번호가 서로 달라요.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: a });
    setBusy(false);
    if (error) return setMsg(koError(error));
    onDone();
  };

  return (
    <AuthShell>
      <form className="form" onSubmit={submit} noValidate>
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>새 비밀번호를 입력해 주세요.</p>
        <div className="field">
          <label htmlFor="new-pw">새 비밀번호</label>
          <input id="new-pw" type="password" autoComplete="new-password" placeholder={`${MIN_PW}자 이상`} autoFocus
            value={a} onChange={(e) => setA(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-pw2">새 비밀번호 확인</label>
          <input id="new-pw2" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        </div>
        <div className="err" aria-live="polite">{msg}</div>
        <button className="btn primary" type="submit" disabled={busy}>비밀번호 변경</button>
      </form>
    </AuthShell>
  );
}

function AuthShell({ children }) {
  return (
    <div className="overlay open" id="loginOv" role="dialog" aria-modal="true" aria-labelledby="auth-title" style={{ background: 'var(--bg)' }}>
      <div className="sheet auth" style={{ maxWidth: 400, borderRadius: 22, animation: 'none' }}>
        <div className="auth-brand">
          <div className="mark"><LogoIcon size={20} /></div>
          <h3 id="auth-title">가계부</h3>
          <p>내 계정으로 로그인하면 어느 기기에서나 같은 내역을 볼 수 있어요.</p>
        </div>
        {children}
      </div>
    </div>
  );
}
