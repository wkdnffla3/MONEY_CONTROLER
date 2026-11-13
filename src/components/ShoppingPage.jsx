import { useMemo, useRef, useState } from 'react';
import { iconOf, useCategories } from '../lib/categories';
import { findMember, memberColor } from '../lib/members';
import { formatAmountInput, parseAmount, won } from '../lib/format';
import { expectedTotal, groupHistory, summarize } from '../lib/shopping';

const fmtDate = (s) => { if (!s) return ''; const [, m, d] = s.split('-').map(Number); return `${m}월 ${d}일`; };

/**
 * 장보기 목록 페이지.
 * actions: { add(data), open(id), toggle(id), remove(id), confirm(), rebuy(items), removeHistory(ids) }
 */
export default function ShoppingPage({ items, members, defaultMemberId, actions }) {
  const cats = useCategories();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [showAll, setShowAll] = useState(false);
  const nameRef = useRef(null);

  const list = useMemo(() => Object.entries(items).map(([id, i]) => ({ id, ...i })), [items]);
  const todo = list.filter((i) => i.status === 'todo' && !i.checked).sort((a, b) => a.createdAt - b.createdAt);
  const cart = list.filter((i) => i.status === 'todo' && i.checked).sort((a, b) => a.createdAt - b.createdAt);
  const history = useMemo(() => groupHistory(list), [list]);
  const sum = summarize(list);
  const defaultCat = cats.expense.some((c) => c.name === '식비') ? '식비' : cats.expense[0].name;

  const quickAdd = (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) { nameRef.current?.focus(); return; }
    actions.add({
      name: n.slice(0, 40), qty: 1, price: parseAmount(price), category: defaultCat,
      memberId: defaultMemberId && members.some((m) => m.id === defaultMemberId) ? defaultMemberId : null,
      memo: '', checked: false, status: 'todo', paid: null, txId: null, boughtAt: null, createdAt: Date.now(),
    });
    setName(''); setPrice('');
    nameRef.current?.focus();
  };

  const renderRow = (i) => {
    const m = members.length ? findMember(members, i.memberId) : null;
    return (
      <li key={i.id} className={`shop-row ${i.checked ? 'in-cart' : ''}`}>
        <button type="button" className="check" role="checkbox" aria-checked={i.checked}
          aria-label={`${i.name} ${i.checked ? '장바구니에서 빼기' : '장바구니에 담기'}`} onClick={() => actions.toggle(i.id)}>
          {i.checked && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>}
        </button>
        <button type="button" className="body" onClick={() => actions.open(i.id)} aria-label={`${i.name} 수정`}>
          <span className="nm">{i.name}{i.qty > 1 && <span className="qty">×{i.qty}</span>}</span>
          <span className="sub">
            {members.length > 0 && <span className="who-badge"><span className="dot" style={{ background: memberColor(m) }} />{m ? m.name : '공동'}</span>}
            {iconOf(cats, 'expense', i.category)} {i.category}{i.memo && ` · ${i.memo}`}
          </span>
        </button>
        <span className={`pr num ${i.price ? '' : 'unset'}`}>{i.price ? won(expectedTotal(i)) : '가격 미정'}</span>
        <button type="button" className="iconbtn sm del" onClick={() => actions.remove(i.id)} aria-label={`${i.name} 삭제`}>✕</button>
      </li>
    );
  };

  return (
    <div className="shop">
      <section className="shop-sum">
        <div><span className="k">살 것</span><b className="num">{sum.todo}개</b></div>
        <div><span className="k">예상 금액</span><b className="num">{won(sum.todoSum)}</b></div>
        <div><span className="k">장바구니</span><b className="num">{sum.cart}개</b></div>
        {sum.unpriced > 0 && <p className="hint">가격 미정 {sum.unpriced}개는 예상 금액에서 빠져 있어요.</p>}
      </section>

      <form className="quick-add card" onSubmit={quickAdd} noValidate>
        <input ref={nameRef} value={name} maxLength={40} placeholder="살 물품 (예: 우유)" aria-label="물품 이름" onChange={(e) => setName(e.target.value)} />
        <div className="amount-input sm">
          <input inputMode="numeric" placeholder="예상 가격" aria-label="예상 가격" value={price} onChange={(e) => setPrice(formatAmountInput(parseAmount(e.target.value)))} />
          <span>원</span>
        </div>
        <button type="submit" className="btn primary sm">추가</button>
      </form>

      <section className="card">
        <h2>살 것 <span style={{ fontWeight: 500, fontSize: 12.5 }}>{todo.length ? `${todo.length}개` : ''}</span></h2>
        {todo.length === 0 ? (
          <div className="empty-mini">{cart.length ? '모두 장바구니에 담았어요.' : '살 물품을 위에서 추가해 보세요.'}</div>
        ) : <ul className="shop-list">{todo.map(renderRow)}</ul>}
      </section>

      {cart.length > 0 && (
        <section className="card">
          <h2>장바구니 <span style={{ fontWeight: 500, fontSize: 12.5 }}>{cart.length}개 · 예상 {won(sum.cartSum)}</span></h2>
          <ul className="shop-list">{cart.map(renderRow)}</ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="card">
          <h2>구매 기록</h2>
          <ul className="history">
            {(showAll ? history : history.slice(0, 5)).map((g) => (
              <li key={g.key}>
                <div className="top">
                  <span><b>{fmtDate(g.date)}</b> · 🛒 가계부에 기록됨</span>
                  <span className="num">{won(g.total)}</span>
                </div>
                <div className="names">{g.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(', ')}</div>
                <div className="acts">
                  <button type="button" className="linkbtn" onClick={() => actions.rebuy(g.items)}>다시 사기</button>
                  <button type="button" className="linkbtn danger-text" onClick={() => actions.removeHistory(g.items.map((i) => i.id))}>기록 지우기</button>
                </div>
              </li>
            ))}
          </ul>
          {history.length > 5 && (
            <button type="button" className="linkbtn" onClick={() => setShowAll((v) => !v)}>{showAll ? '접기' : `${history.length - 5}건 더 보기`}</button>
          )}
          <p className="hint">기록을 지워도 가계부 내역은 남아요. 가계부에서 지우려면 가계부의 내역을 지워 주세요.</p>
        </section>
      )}

      {cart.length > 0 && (
        <div className="cart-bar" role="region" aria-label="결제">
          <div className="txt"><b>담은 {cart.length}개</b><span>예상 {won(sum.cartSum)}</span></div>
          <button type="button" className="btn primary" onClick={actions.confirm}>결제 확정</button>
        </div>
      )}
    </div>
  );
}
