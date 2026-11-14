import { useMemo, useState } from 'react';
import { cardBills, addMonths } from '../lib/cards';
import { colorVar } from '../lib/members';
import { won } from '../lib/format';

const fmt = (s) => { const [, m, d] = s.split('-').map(Number); return `${m}/${d}`; };

/** 카드 결제 예정: 이번 달·다음 달 청구액, 남은 할부. 카드를 누르면 청구 내역 */
export default function CardBills({ allTx, cards, thisMonth, onManage }) {
  const [open, setOpen] = useState(null); // `${cardId}|${ym}`
  const months = [thisMonth, addMonths(thisMonth, 1)];
  const data = useMemo(() => cardBills(allTx, cards, months), [allTx, cards, thisMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cards.length) {
    return (
      <div className="card">
        <h2>카드 결제 예정</h2>
        <div className="empty-mini">신용카드를 등록하면 결제일과 할부에 맞춰<br />언제 얼마가 빠져나가는지 알려드려요.<br />
          <button type="button" className="btn ghost" style={{ marginTop: 10 }} onClick={onManage}>카드 등록</button></div>
      </div>
    );
  }

  const totals = months.map((_, i) => data.reduce((a, d) => a + d.bills[i].total, 0));
  const remaining = data.reduce((a, d) => a + d.remaining, 0);

  return (
    <div className="card">
      <h2>카드 결제 예정 <button type="button" className="linkbtn" onClick={onManage}>카드 관리</button></h2>
      <table className="bill-table">
        <thead><tr><th scope="col">카드</th>{months.map((ym) => <th key={ym} scope="col">{Number(ym.slice(5))}월</th>)}</tr></thead>
        <tbody>
          {data.map(({ card, bills }) => (
            <tr key={card.id}>
              <th scope="row"><span className="dot" style={{ background: colorVar(card.color) }} />{card.name}</th>
              {bills.map((b) => (
                <td key={b.ym}>
                  <button type="button" className="bill-cell" disabled={!b.items.length}
                    aria-expanded={open === `${card.id}|${b.ym}`} onClick={() => setOpen(open === `${card.id}|${b.ym}` ? null : `${card.id}|${b.ym}`)}>
                    <span className="num">{won(b.total)}</span><small>{fmt(b.date)}</small>
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot><tr><th scope="row">합계</th>{totals.map((t, i) => <td key={i} className="num">{won(t)}</td>)}</tr></tfoot>
      </table>
      {open && (() => {
        const [cid, ym] = open.split('|');
        const bill = data.find((d) => d.card.id === cid)?.bills.find((b) => b.ym === ym);
        return bill ? (
          <ul className="bill-items">
            {bill.items.map((it) => (
              <li key={`${it.id}-${it.index}`}>
                <span>{it.tx.date.slice(5).replace('-', '/')} {it.tx.memo || it.tx.category}{it.of > 1 && <small> · 할부 {it.index}/{it.of}</small>}</span>
                <span className="num">{won(it.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null;
      })()}
      {remaining > 0 && <p className="hint">그 뒤로 남은 할부 {won(remaining)}</p>}
    </div>
  );
}
