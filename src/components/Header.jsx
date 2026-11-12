import { LogoIcon } from './Icons';

const STATUS_TEXT = {
  idle: ['', '로그인 필요'],
  loading: ['', '불러오는 중…'],
  ok: ['ok', '저장됨'],
  error: ['warn', '불러오기 실패'],
};

export default function Header({ status, email, onSignOut }) {
  const [cls, text] = STATUS_TEXT[status] || STATUS_TEXT.idle;
  return (
    <header className="top">
      <div className="brand">
        <div className="mark"><LogoIcon /></div>
        <h1>가계부</h1>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div className={`sync ${cls}`}><i /><span>{text}</span></div>
        {email && <span className="userchip">{email}</span>}
        {email && <button type="button" className="linkbtn" onClick={onSignOut}>로그아웃</button>}
      </div>
    </header>
  );
}
