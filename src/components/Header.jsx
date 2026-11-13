import { LogoIcon } from './Icons';

function syncLabel({ status, online, syncing, pending }) {
  if (!online) return ['warn', pending ? `오프라인 · 대기 ${pending}건` : '오프라인'];
  if (syncing) return ['', pending ? `올리는 중… ${pending}건` : '동기화 중…'];
  if (pending) return ['warn', `대기 ${pending}건`];
  if (status === 'error') return ['warn', '불러오기 실패'];
  if (status === 'loading') return ['', '불러오는 중…'];
  return ['ok', '저장됨'];
}

export default function Header({ status, online, syncing, pending, email, onSignOut, onSync, onMenu }) {
  const [cls, text] = syncLabel({ status, online, syncing, pending });
  const canRetry = online && pending > 0 && !syncing;
  return (
    <header className="top">
      <div className="brand">
        <div className="mark"><LogoIcon /></div>
        <h1>가계부</h1>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {canRetry ? (
          <button type="button" className={`sync ${cls}`} onClick={onSync} title="지금 다시 올리기"><i /><span>{text} · 다시 시도</span></button>
        ) : (
          <div className={`sync ${cls}`} role="status"><i /><span>{text}</span></div>
        )}
        {email && <span className="userchip">{email}</span>}
        {email && <button type="button" className="linkbtn" onClick={onSignOut}>로그아웃</button>}
        {onMenu && (
          <button type="button" className="iconbtn" onClick={onMenu} aria-label="설정 메뉴" title="설정">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        )}
      </div>
    </header>
  );
}
