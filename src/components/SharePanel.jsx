import { useState } from 'react';
import {
  createInvite, joinLedger, leaveLedger, normalizeCode, peekInvite, removeMember, shareErrorText,
} from '../lib/household';
import { koError } from '../lib/errors';
import { memberColor } from '../lib/members';

const errText = (e) => shareErrorText(e) || koError(e);
const fmtCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
const fmtTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * 가계부 공유: 참여자 목록 · 초대 코드 만들기 · 코드로 참여 · 나가기 / 내보내기
 * 참여한 사람은 모두 같은 권한 (만든 사람만 내보낼 수 없음)
 */
export default function SharePanel({ uid, email, household, members, pendingCount, initialCode, onChanged, onToast }) {
  const [invite, setInvite] = useState(null);     // { code, expires_at }
  const [busy, setBusy] = useState('');
  const [codeInput, setCodeInput] = useState(initialCode || '');
  const [peek, setPeek] = useState(null);          // { code, owner, members, count }
  const [person, setPerson] = useState('');        // 고른 사람 id, '' = 새로 추가
  const [newName, setNewName] = useState(() => (email || '').split('@')[0].slice(0, 12));
  const [confirm, setConfirm] = useState(null);    // 내보낼 userId 또는 'leave'
  const [error, setError] = useState('');

  const { people, joined, isOwner, supported } = household;
  const personName = (pid) => members.find((m) => m.id === pid)?.name || null;
  const personColor = (pid) => memberColor(members.find((m) => m.id === pid) || null);
  const others = people.filter((p) => !p.owner).length;

  const run = async (name, fn) => {
    setBusy(name); setError('');
    try { return await fn(); } catch (e) { setError(errText(e)); return undefined; } finally { setBusy(''); }
  };

  const makeInvite = () => run('invite', async () => setInvite(await createInvite()));
  const link = invite ? `${window.location.origin}/?join=${invite.code}` : '';
  const shareText = invite ? `우리 집 가계부에 초대해요. 앱에서 ☰ → 가계부 공유 → 코드 입력: ${fmtCode(invite.code)}\n${link}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareText); onToast('초대 내용을 복사했어요'); } catch { onToast('복사하지 못했어요. 코드를 직접 알려 주세요'); }
  };
  const share = async () => {
    try { await navigator.share({ title: '가계부 초대', text: shareText }); } catch { /* 취소 */ }
  };

  const check = () => {
    const code = normalizeCode(codeInput);
    if (!code) { setError('초대 코드는 10자리예요 (예: ABCDE-FGH23).'); return; }
    run('peek', async () => {
      const p = await peekInvite(code);
      setPeek({ code, ...p });
      setPerson('');
    });
  };

  const join = () => {
    if (!person && !newName.trim()) { setError('내 이름을 입력하거나 목록에서 골라 주세요.'); return; }
    run('join', async () => {
      const r = await joinLedger(peek.code, person || null, person ? null : newName.trim());
      setPeek(null); setCodeInput('');
      await onChanged({ personId: r?.person_id ?? null });
      onToast('공유 가계부에 참여했어요');
    });
  };

  const remove = (p) => run(`rm-${p.userId}`, async () => {
    await removeMember(p.userId);
    setConfirm(null);
    await onChanged({});
    onToast(`${p.email || '참여자'}님을 내보냈어요`);
  });

  const leave = () => run('leave', async () => {
    await leaveLedger();
    setConfirm(null);
    await onChanged({ personId: null, left: true });
    onToast('공유 가계부에서 나왔어요. 내 가계부로 돌아왔어요');
  });

  if (!supported) {
    return (
      <div className="form share-panel">
        <div className="notice show">
          <b>DB 업데이트가 필요해요.</b> Supabase SQL Editor에서 <code>supabase/008_sharing_favorites.sql</code>을 실행한 뒤 앱을 새로고침해 주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="form share-panel">
      <section className="ns-sec">
        <h4>{joined ? '공유 가계부에 참여 중' : others ? '함께 쓰는 가계부' : '지금은 나만 쓰는 가계부'}</h4>
        {people.length > 0 && (
          <ul className="share-people">
            {people.map((p) => (
              <li key={p.userId}>
                <span className="sp-dot" style={{ background: p.owner ? 'var(--accent)' : personColor(p.personId) }} />
                <span className="sp-main">
                  <b>{p.email || '(이메일 없음)'}</b>
                  <small>
                    {p.owner ? '만든 사람' : '참여자'}
                    {personName(p.personId) ? ` · ${personName(p.personId)}` : ''}
                    {p.userId === uid ? ' · 나' : ''}
                  </small>
                </span>
                {!p.owner && p.userId !== uid && (confirm === p.userId ? (
                  <span className="sp-actions">
                    <button type="button" className="btn danger sm" disabled={!!busy} onClick={() => remove(p)}>내보내기</button>
                    <button type="button" className="btn sm" onClick={() => setConfirm(null)}>취소</button>
                  </span>
                ) : (
                  <button type="button" className="btn sm" aria-label={`${p.email} 내보내기`} onClick={() => setConfirm(p.userId)}>내보내기</button>
                ))}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">참여한 사람은 모두 같은 권한이에요. 내역 입력·수정·삭제, 초대, 다른 참여자 내보내기를 할 수 있어요 (만든 사람은 내보낼 수 없어요).</p>
      </section>

      <section className="ns-sec">
        <h4>초대하기</h4>
        {invite ? (
          <div className="invite-box">
            <div className="invite-code" aria-label="초대 코드">{fmtCode(invite.code)}</div>
            <p className="hint">{fmtTime(invite.expires_at)}까지, 한 번만 쓸 수 있어요. 받는 사람은 자기 계정으로 로그인한 뒤 ☰ → 가계부 공유에서 입력하거나 링크를 열면 돼요.</p>
            <div className="form-actions">
              <button type="button" className="btn primary" onClick={copy}>복사</button>
              {typeof navigator.share === 'function' && <button type="button" className="btn" onClick={share}>공유하기</button>}
              <button type="button" className="btn" disabled={!!busy} onClick={makeInvite}>새 코드</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn primary" disabled={!!busy} onClick={makeInvite}>
            {busy === 'invite' ? '만드는 중…' : '초대 코드 만들기'}
          </button>
        )}
      </section>

      {!joined && (
        <section className="ns-sec">
          <h4>초대 코드로 참여</h4>
          {isOwner && others > 0 ? (
            <p className="hint">다른 사람이 내 가계부에 참여 중이라 다른 가계부에는 참여할 수 없어요.</p>
          ) : !peek ? (
            <>
              <div className="join-row">
                <input aria-label="초대 코드" placeholder="ABCDE-FGH23" value={codeInput} maxLength={80} autoCapitalize="characters"
                  onChange={(e) => setCodeInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } }} />
                <button type="button" className="btn primary" disabled={!!busy} onClick={check}>{busy === 'peek' ? '확인 중…' : '확인'}</button>
              </div>
              <p className="hint">참여하면 내 가계부 대신 공유 가계부가 보여요. 내 데이터는 지워지지 않고, 나가면 다시 보여요.</p>
            </>
          ) : (
            <div className="join-confirm">
              <p><b>{peek.owner || '상대'}님의 가계부</b> · {peek.count}명 사용 중</p>
              <p className="hint">이 가계부에서 나는 누구인가요? (내역의 "누가"에 쓰여요)</p>
              <div className="ns-kinds">
                {(peek.members || []).map((m) => (
                  <label key={m.id} className="check">
                    <input type="radio" name="join-person" checked={person === m.id} onChange={() => setPerson(m.id)} /> {m.name}
                  </label>
                ))}
                <label className="check">
                  <input type="radio" name="join-person" checked={person === ''} onChange={() => setPerson('')} />
                  새로 추가
                  <input className="join-name" aria-label="내 이름" value={newName} maxLength={12} disabled={person !== ''}
                    onChange={(e) => setNewName(e.target.value)} />
                </label>
              </div>
              {pendingCount > 0 && <p className="hint warn">아직 서버에 올리지 못한 내역 {pendingCount}건이 있어요. 연결되어 다 올라간 뒤 참여할 수 있어요.</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setPeek(null)}>취소</button>
                <button type="button" className="btn primary" disabled={!!busy || pendingCount > 0} onClick={join}>{busy === 'join' ? '참여하는 중…' : '참여하기'}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {joined && (
        <section className="ns-sec">
          <h4>가계부에서 나가기</h4>
          <p className="hint">나가면 원래 내 가계부로 돌아가요. 공유 가계부의 내역은 그대로 남아요.</p>
          {pendingCount > 0 && <p className="hint warn">아직 서버에 올리지 못한 내역 {pendingCount}건이 있어요. 다 올라간 뒤 나갈 수 있어요.</p>}
          {confirm === 'leave' ? (
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setConfirm(null)}>취소</button>
              <button type="button" className="btn danger" disabled={!!busy || pendingCount > 0} onClick={leave}>{busy === 'leave' ? '나가는 중…' : '정말 나가기'}</button>
            </div>
          ) : (
            <button type="button" className="btn danger" disabled={pendingCount > 0} onClick={() => setConfirm('leave')}>나가기</button>
          )}
        </section>
      )}

      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}
