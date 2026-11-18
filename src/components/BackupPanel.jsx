import { useMemo, useRef, useState } from 'react';
import { downloadText } from '../lib/csv';
import { backupFileName, buildBackup, getLastBackup, parseBackup, planRestore, setLastBackup } from '../lib/backup';

const SETTING_LABELS = {
  budget: '월 예산', members: '함께 쓰는 사람', recurring: '반복 내역', categories: '카테고리', catBudgets: '카테고리별 예산',
  cards: '신용카드', favorites: '즐겨찾기', dismissedSubs: '구독 발견 숨김',
};
const n = (v) => v.toLocaleString('ko-KR');
const ago = (d) => {
  if (!d) return '아직 없음';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const when = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  return days <= 0 ? `오늘 (${when})` : `${days}일 전 (${when})`;
};

/**
 * 전체 백업·복원.
 * ledger: useLedger 결과, ledgerId: 지금 가계부, online: 연결 여부
 */
export default function BackupPanel({ ledger, ledgerId, online, onToast }) {
  const [last, setLast] = useState(() => getLastBackup(ledgerId));
  const [file, setFile] = useState(null);        // { name, parsed }
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(null);        // { done, total }
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const txCount = Object.keys(ledger.tx).length;
  const itemCount = Object.keys(ledger.items).length;

  const download = () => {
    setError('');
    const b = buildBackup(ledger, { ledgerId });
    const ok = downloadText(backupFileName(), JSON.stringify(b), 'application/json;charset=utf-8');
    if (!ok) { setError('이 브라우저에서는 파일을 내려받을 수 없어요.'); return; }
    setLastBackup(ledgerId);
    setLast(getLastBackup(ledgerId));
    onToast?.(`백업 파일을 받았어요 (내역 ${n(b.counts.transactions)}건)`);
  };

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    setResult(null); setError(''); setFile(null);
    if (!f) return;
    let text = '';
    try { text = await f.text(); } catch { setError('파일을 읽지 못했어요.'); return; }
    const parsed = parseBackup(text);
    if (!parsed.ok) { setError(parsed.error); return; }
    setFile({ name: f.name, parsed });
  };

  const sameLedger = !file?.parsed.backup.ledgerId || file.parsed.backup.ledgerId === ledgerId;
  const plan = useMemo(() => (file
    ? planRestore(file.parsed.backup, ledger, { overwrite, sameLedger, ledgerId })
    : null), [file, ledger, overwrite, sameLedger, ledgerId]);
  const work = plan ? plan.tx.length + plan.items.length + plan.settings.length : 0;

  const restore = async () => {
    if (!plan || !work) return;
    setError(''); setResult(null);
    setBusy({ done: 0, total: plan.tx.length + plan.items.length });
    try {
      const r = await ledger.restoreBackup(plan, { overwrite, onProgress: (done, total) => setBusy({ done, total }) });
      setResult(r);
      setFile(null);
      onToast?.('복원했어요');
    } catch (err) {
      if (err?.code === 'need014') setError('DB 업데이트가 필요해요. Supabase SQL Editor에서 supabase/014_restore_backup.sql 을 실행한 뒤 다시 눌러 주세요.');
      else if (err?.code === 'offline') setError('인터넷에 연결된 뒤 다시 눌러 주세요. (중간까지 들어간 내용은 다시 눌러도 중복되지 않아요)');
      else setError(`복원하지 못했어요: ${err?.message || err}. 다시 눌러도 중복되지 않아요.`);
    } finally {
      setBusy(null);
    }
  };

  const c = plan?.count;
  const inv = file?.parsed.invalid;
  return (
    <div className="form backup">
      <section className="bk-sec">
        <h4>백업 파일 받기</h4>
        <p className="hint">내역 {n(txCount)}건, 장보기 {n(itemCount)}개, 설정(예산·반복·카테고리·카드·즐겨찾기 등)을 파일 하나로 받아요.
          휴대폰을 바꾸거나 실수로 지웠을 때 되돌릴 수 있어요. 댓글·변경 기록은 들어가지 않아요.</p>
        <p className="bk-last">이 기기에서 마지막 백업: <b>{ago(last)}</b></p>
        <button type="button" className="btn primary" onClick={download}>백업 파일 받기</button>
      </section>

      <section className="bk-sec">
        <h4>백업에서 복원</h4>
        <p className="hint">지금 가계부에 있는 내역은 지우지 않아요. 백업에 있는데 지금 없는 것을 되살려요.</p>
        <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={pick} aria-label="백업 파일 고르기" />
        <button type="button" className="btn ghost" onClick={() => inputRef.current?.click()} disabled={!!busy}>백업 파일 고르기</button>

        {file && plan && (
          <div className="bk-preview" aria-live="polite">
            <p className="bk-file"><b>{file.name}</b>
              {file.parsed.backup.exportedAt && <> · {new Date(file.parsed.backup.exportedAt).toLocaleString('ko-KR')} 백업</>}</p>
            {!sameLedger && <p className="bk-note">다른 가계부(또는 다른 계정)의 백업이에요. 모두 새 내역으로 추가돼요.</p>}
            <ul className="bk-counts">
              <li>내역: 새로 추가 <b>{n(c.txNew)}</b>건 · 이미 있음 {n(c.txSame + c.txChanged)}건{c.txChanged ? ` (그중 내용이 다른 ${n(c.txChanged)}건)` : ''}</li>
              <li>장보기: 새로 추가 <b>{n(c.itemsNew)}</b>개 · 이미 있음 {n(c.itemsSame + c.itemsChanged)}개{c.itemsChanged ? ` (그중 다른 ${n(c.itemsChanged)}개)` : ''}</li>
              <li>설정: {plan.settings.length ? plan.settings.map((s) => SETTING_LABELS[s.kind] || s.kind).join(', ') : '바뀌는 것 없음'}</li>
            </ul>
            {(inv.tx > 0 || inv.items > 0 || inv.settings.length > 0) && (
              <p className="bk-note">형식이 맞지 않아 건너뛰는 항목: {[inv.tx && `내역 ${inv.tx}건`, inv.items && `장보기 ${inv.items}개`, inv.settings.length && `설정 ${inv.settings.length}개`].filter(Boolean).join(', ')}</p>
            )}
            <fieldset className="bk-mode">
              <label><input type="radio" name="bk-mode" checked={!overwrite} onChange={() => setOverwrite(false)} />
                <span><b>빠진 것만 되살리기</b><small>지금 내용은 그대로 두고, 없는 것만 추가 (설정도 빠진 항목만 더함)</small></span></label>
              <label><input type="radio" name="bk-mode" checked={overwrite} onChange={() => setOverwrite(true)} />
                <span><b>백업 때로 덮어쓰기</b><small>내용이 다른 {n(c.txChanged + c.itemsChanged)}건과 설정을 백업 때로 되돌려요. 되돌린 내역은 변경 기록에서 다시 되돌릴 수 있어요.</small></span></label>
            </fieldset>
            <button type="button" className={`btn ${overwrite ? 'danger' : 'primary'}`} onClick={restore} disabled={!!busy || !work || !online}>
              {busy ? `올리는 중… ${n(busy.done)} / ${n(busy.total)}` : work ? '복원하기' : '되살릴 것이 없어요'}
            </button>
            {busy && busy.total > 0 && <div className="bar"><span style={{ width: `${Math.round((busy.done / busy.total) * 100)}%` }} /></div>}
            {!online && <p className="bk-note">인터넷에 연결되면 복원할 수 있어요.</p>}
          </div>
        )}

        {result && (
          <p className="bk-done" role="status">
            복원 완료: 내역 {n(result.tx_added)}건 추가{result.tx_updated ? `, ${n(result.tx_updated)}건 되돌림` : ''}
            {' · '}장보기 {n(result.items_added)}개 추가{result.items_updated ? `, ${n(result.items_updated)}개 되돌림` : ''}
            {result.settings ? ` · 설정 ${result.settings}개` : ''}
            {result.tx_skipped + result.items_skipped > 0 ? ` · 다른 가계부와 겹쳐 건너뜀 ${n(result.tx_skipped + result.items_skipped)}건` : ''}
          </p>
        )}
      </section>
      <div className="err" aria-live="polite">{error}</div>
    </div>
  );
}
