import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { CloseIcon } from './Icons';

export default function InstallBanner() {
  const { mode, install, dismiss } = useInstallPrompt();
  if (!mode) return null;

  return (
    <div className="install-banner" role="region" aria-label="앱 설치 안내">
      <img src="/icons/icon-192.png" alt="" width="40" height="40" />
      <div className="txt">
        <b>홈 화면에 가계부 추가</b>
        {mode === 'prompt'
          ? <span>앱처럼 아이콘으로 바로 열 수 있어요.</span>
          : <span>Safari 아래쪽 <b>공유</b> 버튼 → <b>홈 화면에 추가</b>를 눌러 주세요.</span>}
      </div>
      {mode === 'prompt' && <button type="button" className="btn primary sm" onClick={install}>설치</button>}
      <button type="button" className="iconbtn" onClick={dismiss} aria-label="안내 닫기"><CloseIcon /></button>
    </div>
  );
}
