import { useMemo } from 'react';
import { summarizeByMember } from '../lib/members';
import { won } from '../lib/format';

/** 사람별 지출·수입 합계 (항상 그 달 전체 내역 기준). 행을 누르면 그 사람 보기로 전환 */
export default function MemberSummary({ list, members, who, onSelect, onManage }) {
  const { rows, totalExp, totalInc } = useMemo(() => summarizeByMember(list, members), [list, members]);

  if (!members.length) {
    return (
      <div className="card wide">
        <h2>사람별 합계</h2>
        <div className="empty-mini">
          한 계정을 여러 명이 쓰나요?<br />함께 쓰는 사람을 등록하면 누가 얼마나 썼는지 나눠 볼 수 있어요.<br />
          <button type="button" className="btn ghost" style={{ marginTop: 10 }} onClick={onManage}>사람 등록하기</button>
        </div>
      </div>
    );
  }

  const withExp = rows.filter((r) => r.exp > 0);

  return (
    <div className="card wide">
      <h2>사람별 합계 <button type="button" className="linkbtn" onClick={onManage}>사람 관리</button></h2>

      {totalExp > 0 ? (
        <div className="share-bar" role="img"
          aria-label={withExp.map((r) => `${r.name} ${r.pct}%`).join(', ')}>
          {withExp.map((r) => (
            <span key={r.key} style={{ width: `${(r.exp / totalExp) * 100}%`, background: r.color }} title={`${r.name} ${won(r.exp)}`} />
          ))}
        </div>
      ) : (
        <div className="empty-mini" style={{ padding: '6px 0 10px' }}>이번 달 지출이 아직 없어요.</div>
      )}

      <table className="member-table">
        <thead>
          <tr><th scope="col">사람</th><th scope="col">지출</th><th scope="col">비율</th><th scope="col">수입</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={who === r.key ? 'active' : ''} onClick={() => onSelect(who === r.key ? 'all' : r.key)}
              tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(who === r.key ? 'all' : r.key); } }}
              aria-label={`${r.name} 내역만 보기`}>
              <td><span className="dot" style={{ background: r.color }} />{r.name}<span className="cnt">{r.count}건</span></td>
              <td className="num">{won(r.exp)}</td>
              <td className="num pct">{totalExp ? `${r.pct}%` : '-'}</td>
              <td className="num inc">{r.inc ? won(r.inc) : '-'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">합계</th>
            <td className="num">{won(totalExp)}</td>
            <td className="num pct">{totalExp ? '100%' : '-'}</td>
            <td className="num inc">{totalInc ? won(totalInc) : '-'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
