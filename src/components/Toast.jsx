export default function Toast({ toast, onHide }) {
  return (
    <div className={`toast ${toast ? 'show' : ''}`} role="status">
      <span>{toast?.msg}</span>
      {toast?.undo && (
        <button type="button" onClick={() => { toast.undo(); onHide(); }}>되돌리기</button>
      )}
    </div>
  );
}
