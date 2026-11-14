import { useState } from 'react';

const fmt = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 내역 아래 댓글: 목록 + 입력. 내 댓글만 지울 수 있음 */
export default function CommentThread({ comments = [], uid, supported, online, onAdd, onDelete }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!supported) {
    return <p className="hint comment-off">💬 댓글을 쓰려면 DB 업데이트(supabase/010_history_comments.sql)가 필요해요.</p>;
  }
  const send = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await onAdd(body); setText(''); } catch { /* 상위에서 알림 */ } finally { setBusy(false); }
  };
  return (
    <section className="comments" aria-label="댓글">
      <h4>💬 댓글{comments.length ? ` ${comments.length}` : ''}</h4>
      {comments.length > 0 && (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id} className={c.author === uid ? 'mine' : ''}>
              <div className="cm-head"><b>{c.author_name}</b><time>{fmt(c.created_at)}</time>
                {c.author === uid && <button type="button" className="cm-del" aria-label="댓글 삭제" onClick={() => onDelete(c.id)}>삭제</button>}
              </div>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form className="comment-form" onSubmit={send}>
        <input aria-label="댓글 입력" placeholder={online ? '이거 뭐 산 거야?' : '오프라인에서는 댓글을 쓸 수 없어요'} maxLength={300}
          value={text} disabled={!online} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn primary sm" disabled={!online || busy || !text.trim()}>보내기</button>
      </form>
    </section>
  );
}
