/** 앱 안 알림 배너 (화면 위). 누르면 해당 페이지로 이동 */
export default function NotifyBanner({ banners, onOpen, onDismiss }) {
  if (!banners.length) return null;
  return (
    <div className="notify-stack" role="status" aria-live="polite">
      {banners.map((b) => (
        <div key={b.id} className={`notify-banner nb-${b.kind}`}>
          <button type="button" className="nb-main" onClick={() => { onDismiss(b.id); onOpen(b.url); }}>
            <span className="nb-icon" aria-hidden="true">{b.kind === 'shop' ? '🛒' : b.kind === 'purchase' ? '🧾' : '🔔'}</span>
            <span className="nb-text"><b>{b.title}</b><small>{b.body}</small></span>
          </button>
          <button type="button" className="nb-close" aria-label="알림 닫기" onClick={() => onDismiss(b.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
