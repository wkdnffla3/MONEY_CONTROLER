import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { isMissingFn } from '../lib/household';
import { PRIVACY_HASH } from '../lib/privacy';

const CONFIRM_WORD = '탈퇴';

/**
 * 계정·개인정보: 로그인 이메일, 처리방침, 백업, 회원 탈퇴.
 * ownerWithOthers: 내 가계부에 다른 사람이 참여 중 (탈퇴 불가) / joined: 남의 가계부에 참여 중
 */
export default function AccountPanel({ email, ownerWithOthers = false, joined = false, online = true, onBackup, onShare, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const del = async () => {
    if (word.trim() !== CONFIRM_WORD || busy) return;
    setBusy(true); setError('');
    const { error: e } = await supabase.rpc('delete_account');
    if (e) {
      setBusy(false);
      if (/ledger_has_members/.test(e.message || '')) setError('다른 사람이 참여 중인 가계부예요. 가계부 공유에서 참여자를 먼저 내보낸 뒤 다시 시도해 주세요.');
      else if (isMissingFn(e)) setError('DB 업데이트가 필요해요. Supabase SQL Editor에서 supabase/016_delete_account.sql 을 실행한 뒤 다시 시도해 주세요.');
      else setError(`탈퇴하지 못했어요: ${e.message || e}`);
      return;
    }
    await onDeleted?.();
  };

  return (
    <div className="form account-panel">
      <section className="acc-sec">
        <h4>로그인 계정</h4>
        <p className="acc-email">{email}</p>
        <p className="hint"><a href={PRIVACY_HASH}>개인정보 처리방침 보기</a></p>
      </section>

      <section className="acc-sec">
        <h4>내 정보 내려받기</h4>
        <p className="hint">가계부 전체를 파일로 받아 둘 수 있어요. 탈퇴하기 전에 받아 두면 나중에 다른 계정에서 되살릴 수 있어요.</p>
        <button type="button" className="btn ghost" onClick={onBackup}>백업·복원 열기</button>
      </section>

      <section className="acc-sec">
        <h4>회원 탈퇴</h4>
        {ownerWithOthers ? (
          <>
            <p className="hint">다른 사람이 내 가계부에 참여 중이라 지금은 탈퇴할 수 없어요. 탈퇴하면 그 사람들이 함께 쓰던 내역까지 지워지기 때문이에요.
              가계부 공유에서 참여자를 먼저 내보내 주세요.</p>
            <button type="button" className="btn ghost" onClick={onShare}>가계부 공유 열기</button>
          </>
        ) : !open ? (
          <button type="button" className="btn ghost danger-text" onClick={() => setOpen(true)}>회원 탈퇴…</button>
        ) : (
          <div className="del-box" role="alert">
            <b>탈퇴하면 되돌릴 수 없어요.</b>
            <ul>
              {joined ? (
                <>
                  <li>계정, 공유 참여 정보, 내 기기 알림 설정, 내가 쓴 댓글이 지워져요.</li>
                  <li>내가 공유 가계부에 입력한 내역은 그 가계부에 남아요.</li>
                </>
              ) : (
                <li>계정과 가계부 전체(내역·설정·반복·카드·장보기·즐겨찾기·댓글·변경 기록·알림 설정)가 바로 지워져요.</li>
              )}
              <li>같은 이메일로 다시 가입하면 빈 가계부로 시작해요.</li>
            </ul>
            <div className="field">
              <label htmlFor="del-word">계속하려면 <b>{CONFIRM_WORD}</b> 를 입력하세요</label>
              <input id="del-word" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => { setOpen(false); setWord(''); setError(''); }}>취소</button>
              <button type="button" className="btn danger" disabled={word.trim() !== CONFIRM_WORD || busy || !online} onClick={del}>
                {busy ? '지우는 중…' : '탈퇴하기'}
              </button>
            </div>
            {!online && <p className="hint">인터넷에 연결된 뒤 탈퇴할 수 있어요.</p>}
          </div>
        )}
        <div className="err" aria-live="polite">{error}</div>
      </section>
    </div>
  );
}
