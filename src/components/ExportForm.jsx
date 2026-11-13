import { useMemo, useState } from 'react';
import { downloadText, toCsv } from '../lib/csv';
import { SHARED, SHARED_LABEL, filterByOwner, findMember } from '../lib/members';
import { isRecurringTxId } from '../lib/recurring';
import { pad, ymKey } from '../lib/format';

/** 내역을 CSV로 내려받기 (엑셀·구글 시트에서 열 수 있음) */
export default function ExportForm({ allTx, members, ym, onDone }) {
  const [scope, setScope] = useState('month'); // month | year | all | range
  const [from, setFrom] = useState(`${ym.y}-01`);
  const [to, setTo] = useState(ymKey(ym.y, ym.m));
  const [who, setWho] = useState('all');
  const [error, setError] = useState('');

  const rows = useMemo(() => {
    let list = allTx.filter((t) => typeof t.date === 'string');
    if (scope === 'month') list = list.filter((t) => t.date.startsWith(ymKey(ym.y, ym.m)));
    else if (scope === 'year') list = list.filter((t) => t.date.startsWith(`${ym.y}-`));
    else if (scope === 'range') list = list.filter((t) => t.date.slice(0, 7) >= from && t.date.slice(0, 7) <= to);
    list = filterByOwner(list, members, who);
    return [...list].sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1));
  }, [allTx, members, scope, from, to, who, ym]);

  const totals = rows.reduce((a, t) => {
    if (t.type === 'income') a.inc += t.amount; else a.exp += t.amount;
    return a;
  }, { inc: 0, exp: 0 });

  const fileName = () => {
    const base = scope === 'month' ? `${ym.y}-${pad(ym.m)}` : scope === 'year' ? `${ym.y}` : scope === 'range' ? `${from}_${to}` : '전체';
    const whoName = who === 'all' ? '' : who === SHARED ? `_${SHARED_LABEL}` : `_${findMember(members, who)?.name || ''}`;
    return `가계부_${base}${whoName}.csv`.replace(/[\\/:*?"<>|]/g, '_');
  };

  const download = () => {
    if (scope === 'range' && from > to) { setError('시작 월이 끝 월보다 늦어요.'); return; }
    if (!rows.length) { setError('내보낼 내역이 없어요.'); return; }
    const header = ['날짜', '구분', '카테고리', '금액', '메모', ...(members.length ? ['누가'] : []), '반복'];
    const body = rows.map((t) => [
      t.date,
      t.type === 'income' ? '수입' : '지출',
      t.category,
      t.amount,
      t.memo || '',
      ...(members.length ? [findMember(members, t.memberId)?.name || SHARED_LABEL] : []),
      isRecurringTxId(t.id) ? '예' : '',
    ]);
    const ok = downloadText(fileName(), toCsv(header, body));
    if (!ok) { setError('이 브라우저에서는 내려받을 수 없어요.'); return; }
    onDone(rows.length);
  };

  return (
    <div className="form">
      <div className="field">
        <label>기간</label>
        <div className="chips">
          {[['month', `${ym.m}월`], ['year', `${ym.y}년`], ['all', '전체'], ['range', '기간 지정']].map(([k, l]) => (
            <button key={k} type="button" className="chip" aria-pressed={scope === k} onClick={() => { setScope(k); setError(''); }}>{l}</button>
          ))}
        </div>
      </div>
      {scope === 'range' && (
        <div className="row2">
          <div className="field"><label htmlFor="ex-from">시작 월</label><input id="ex-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label htmlFor="ex-to">끝 월</label><input id="ex-to" type="month" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      )}
      {members.length > 0 && (
        <div className="field">
          <label>누구</label>
          <div className="chips">
            {[['all', '전체'], ...members.map((m) => [m.id, m.name]), [SHARED, SHARED_LABEL]].map(([k, l]) => (
              <button key={k} type="button" className="chip" aria-pressed={who === k} onClick={() => setWho(k)}>{l}</button>
            ))}
          </div>
        </div>
      )}
      <div className="export-sum">
        <b>{rows.length.toLocaleString('ko-KR')}건</b>
        <span>수입 {totals.inc.toLocaleString('ko-KR')}원 · 지출 {totals.exp.toLocaleString('ko-KR')}원</span>
      </div>
      <p className="hint">엑셀·구글 시트·Numbers에서 열 수 있어요. 메모가 =, +, -, @로 시작하면 수식으로 실행되지 않도록 앞에 '를 붙여 저장해요.</p>
      <div className="err" aria-live="polite">{error}</div>
      <div className="form-actions">
        <button type="button" className="btn primary" onClick={download}>CSV 내려받기</button>
      </div>
    </div>
  );
}
