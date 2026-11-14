import { useState } from 'react';
import { iconOf, useCategories } from '../lib/categories';
import { formatAmountInput, parseAmount, won } from '../lib/format';
import { MAX_AMOUNT, MAX_FAVORITES, newId } from '../lib/outbox';
import { memberColor, SHARED_LABEL } from '../lib/members';

const empty = (cats) => ({ label: '', type: 'expense', amount: 0, category: cats.expense[0].name, memo: '', memberId: null });

/** 즐겨찾기 하나 입력 (새로 만들기 / 고치기 공용) */
function FavoriteForm({ initial, members, onSubmit, onCancel, onDelete }) {
  const cats = useCategories();
  const [f, setF] = useState(() => ({ ...empty(cats), ...initial }));
  const [amount, setAmount] = useState(initial?.amount ? formatAmountInput(initial.amount) : '');
  const [err, setErr] = useState('');
  const list = cats[f.type].some((c) => c.name === f.category) ? cats[f.type] : [...cats[f.type], { name: f.category, icon: '📦' }];

  const submit = (e) => {
    e.preventDefault();
    const label = f.label.trim();
    const n = parseAmount(amount);
    if (!label) { setErr('이름을 입력해 주세요 (예: 점심, 출근 버스).'); return; }
    if (n > MAX_AMOUNT) { setErr('금액이 너무 커요.'); return; }
    onSubmit({
      id: initial?.id || newId().slice(0, 40), label: label.slice(0, 16), type: f.type, amount: n, category: f.category,
      memo: f.memo.trim().slice(0, 100), memberId: f.memberId && members.some((m) => m.id === f.memberId) ? f.memberId : null,
      cardId: initial?.cardId ?? null, tags: initial?.tags ?? [],
    });
  };

  return (
    <form className="form fav-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="fav-label">이름 (버튼에 보이는 글자)</label>
        <input id="fav-label" maxLength={16} placeholder="예: 점심, 출근 버스" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
      </div>
      <div className="typeswitch" role="group" aria-label="유형">
        {[['expense', '지출'], ['income', '수입']].map(([t, l]) => (
          <button key={t} type="button" data-t={t} aria-pressed={f.type === t}
            onClick={() => setF({ ...f, type: t, category: cats[t].some((c) => c.name === f.category) ? f.category : cats[t][0].name })}>{l}</button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="fav-amt">금액 (비워 두면 누를 때마다 입력)</label>
        <div className="amount-input">
          <input id="fav-amt" inputMode="numeric" placeholder="매번 입력" value={amount}
            onChange={(e) => setAmount(formatAmountInput(parseAmount(e.target.value)))} />
          <span>원</span>
        </div>
      </div>
      <div className="field">
        <label>카테고리</label>
        <div className="chips">
          {list.map(({ name, icon }) => (
            <button key={name} type="button" className="chip" aria-pressed={f.category === name} onClick={() => setF({ ...f, category: name })}>{icon} {name}</button>
          ))}
        </div>
      </div>
      {members.length > 0 && (
        <div className="field">
          <label>누가</label>
          <div className="chips">
            {members.map((m) => (
              <button key={m.id} type="button" className="chip" aria-pressed={f.memberId === m.id} onClick={() => setF({ ...f, memberId: m.id })}>
                <span className="dot" style={{ background: memberColor(m) }} />{m.name}
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={!f.memberId} onClick={() => setF({ ...f, memberId: null })}>
              {SHARED_LABEL} · 입력하는 사람
            </button>
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="fav-memo">메모</label>
        <input id="fav-memo" maxLength={100} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} />
      </div>
      <div className="err" aria-live="polite">{err}</div>
      <div className="form-actions">
        {onDelete && <button type="button" className="btn danger" onClick={onDelete}>삭제</button>}
        <button type="button" className="btn" onClick={onCancel}>취소</button>
        <button type="submit" className="btn primary">저장</button>
      </div>
    </form>
  );
}

/** 즐겨찾기 관리: 목록 · 순서 · 고치기 · 삭제 · 새로 만들기 */
export default function FavoritesManager({ favorites, members, onSave }) {
  const cats = useCategories();
  const [editing, setEditing] = useState(null); // 즐겨찾기 id 또는 'new'

  const put = (fav) => {
    const exists = favorites.some((x) => x.id === fav.id);
    const next = exists ? favorites.map((x) => (x.id === fav.id ? fav : x)) : [...favorites, fav];
    setEditing(null);
    onSave(next, exists ? `"${fav.label}" 즐겨찾기를 고쳤어요` : `"${fav.label}" 즐겨찾기를 만들었어요`);
  };
  const del = (fav) => { setEditing(null); onSave(favorites.filter((x) => x.id !== fav.id), `"${fav.label}" 즐겨찾기를 지웠어요`); };
  const move = (i, d) => {
    const next = [...favorites];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onSave(next, '순서를 바꿨어요');
  };

  if (editing) {
    return (
      <FavoriteForm key={editing} members={members} initial={favorites.find((x) => x.id === editing) || null}
        onSubmit={put} onCancel={() => setEditing(null)}
        onDelete={editing !== 'new' ? () => del(favorites.find((x) => x.id === editing)) : undefined} />
    );
  }

  return (
    <div className="form fav-manager">
      {favorites.length === 0 ? (
        <p className="hint">아직 즐겨찾기가 없어요. 자주 쓰는 내역(점심, 교통비, 커피 등)을 만들어 두면 가계부 화면에서 한 번 눌러 입력돼요.
          내역을 눌러 수정 화면에서 "⭐ 즐겨찾기에 추가"를 눌러도 돼요.</p>
      ) : (
        <ul className="fav-list">
          {favorites.map((f, i) => (
            <li key={f.id}>
              <button type="button" className="fav-row" onClick={() => setEditing(f.id)}>
                <span className="fi" aria-hidden="true">{iconOf(cats, f.type, f.category)}</span>
                <span className="fr-main"><b>{f.label}</b><small>{f.type === 'income' ? '수입' : '지출'} · {f.category}{f.memo ? ` · ${f.memo}` : ''}</small></span>
                <span className={`fr-amt ${f.type}`}>{f.amount ? won(f.amount) : '매번 입력'}</span>
              </button>
              <span className="fr-move">
                <button type="button" aria-label={`${f.label} 위로`} disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                <button type="button" aria-label={`${f.label} 아래로`} disabled={i === favorites.length - 1} onClick={() => move(i, 1)}>▼</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn primary" disabled={favorites.length >= MAX_FAVORITES} onClick={() => setEditing('new')}>
        {favorites.length >= MAX_FAVORITES ? `최대 ${MAX_FAVORITES}개까지예요` : '+ 새 즐겨찾기'}
      </button>
      <p className="hint">금액을 정해 둔 즐겨찾기는 누르면 오늘 날짜로 바로 저장되고, 잘못 눌렀으면 알림의 "되돌리기"로 취소할 수 있어요.</p>
    </div>
  );
}
