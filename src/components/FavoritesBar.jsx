import { useState } from 'react';
import { useCategories, iconOf } from '../lib/categories';
import { won } from '../lib/format';
import { groupFavorites, loadFavView, saveFavView } from '../lib/favorites';
import { useHScroll } from '../hooks/useHScroll';

/** 옆으로 넘기는 줄 + PC용 ◀ ▶ (마우스가 있는 기기에서만 보임) */
function HScroll({ className, label, watch, children }) {
  const { ref, edge, by } = useHScroll(watch);
  return (
    <div className="hs">
      <div ref={ref} className={className} role={label ? 'group' : undefined} aria-label={label}>{children}</div>
      {edge.left && <button type="button" className="hs-btn left" aria-label="왼쪽으로 넘기기" onClick={() => by(-1)}>‹</button>}
      {edge.right && <button type="button" className="hs-btn right" aria-label="오른쪽으로 넘기기" onClick={() => by(1)}>›</button>}
    </div>
  );
}

function Chips({ items, cats, onUse, wrap }) {
  const chips = items.map((f) => (
    <button key={f.id} type="button" className={`fav-chip ${f.type}`} onClick={() => onUse(f)}
      title={f.amount ? '누르면 오늘 날짜로 바로 저장돼요' : '누르면 금액을 입력하는 창이 열려요'}>
      <span className="fi" aria-hidden="true">{iconOf(cats, f.type, f.category)}</span>
      <span className="fl">{f.label}</span>
      <span className="fa">{f.amount ? won(f.amount) : '금액 입력'}</span>
    </button>
  ));
  if (wrap) return <div className="fav-chips wrap">{chips}</div>;
  return <HScroll className="fav-chips" watch={items.map((f) => f.id).join()}>{chips}</HScroll>;
}

/**
 * 즐겨찾기: 누르면 바로 저장(금액이 정해진 것) 또는 입력창 열기(금액 매번 입력).
 * 사람별로 나눠 보여 주고(이 기기를 쓰는 사람 먼저), "펼치기"로 전부 한눈에. 고른 탭·펼침은 기기에 기억
 */
export default function FavoritesBar({ favorites, members = [], meId = null, onUse, onManage }) {
  const cats = useCategories();
  const [view, setView] = useState(loadFavView);
  const update = (v) => { const next = { ...view, ...v }; setView(next); saveFavView(next); };

  if (!favorites.length) {
    return (
      <section className="card fav-bar fav-empty">
        <span>⭐ 자주 쓰는 내역을 즐겨찾기로 만들면 한 번에 입력돼요</span>
        <button type="button" className="btn sm" onClick={onManage}>만들기</button>
      </section>
    );
  }

  const groups = groupFavorites(favorites, members, meId);
  const split = groups.length > 1;
  const tab = split && groups.some((g) => g.key === view.tab) ? view.tab : 'all';
  const shown = tab === 'all' ? groups : groups.filter((g) => g.key === tab);

  return (
    <section className={`card fav-bar${view.open ? ' open' : ''}`} aria-label="즐겨찾기">
      <div className="fav-head">
        <h2>⭐ 즐겨찾기 <small>{favorites.length}</small></h2>
        <span className="fav-actions">
          <button type="button" className="link-btn" aria-expanded={view.open} onClick={() => update({ open: !view.open })}>
            {view.open ? '접기 ▴' : '펼치기 ▾'}
          </button>
          <button type="button" className="link-btn" onClick={onManage}>편집</button>
        </span>
      </div>
      {split && (
        <HScroll className="fav-tabs" label="사람별 보기" watch={groups.map((g) => `${g.key}${g.items.length}`).join()}>
          <button type="button" className="chip" aria-pressed={tab === 'all'} onClick={() => update({ tab: 'all' })}>전체 {favorites.length}</button>
          {groups.map((g) => (
            <button key={g.key} type="button" className="chip" aria-pressed={tab === g.key} onClick={() => update({ tab: g.key })}>
              <span className="dot" style={{ background: g.color }} />{g.label}{g.isMe ? ' (나)' : ''} {g.items.length}
            </button>
          ))}
        </HScroll>
      )}
      {shown.map((g) => (
        <div key={g.key} className="fav-group">
          {split && tab === 'all' && (
            <div className="fav-glabel"><span className="dot" style={{ background: g.color }} />{g.label}{g.isMe ? ' (나)' : ''}</div>
          )}
          <Chips items={g.items} cats={cats} onUse={onUse} wrap={view.open} />
        </div>
      ))}
    </section>
  );
}
