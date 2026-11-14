import { useCategories, iconOf } from '../lib/categories';
import { won } from '../lib/format';

/** 즐겨찾기 줄: 누르면 바로 저장(금액이 정해진 것) 또는 입력창 열기(금액 매번 입력) */
export default function FavoritesBar({ favorites, onUse, onManage }) {
  const cats = useCategories();
  if (!favorites.length) {
    return (
      <section className="card fav-bar fav-empty">
        <span>⭐ 자주 쓰는 내역을 즐겨찾기로 만들면 한 번에 입력돼요</span>
        <button type="button" className="btn sm" onClick={onManage}>만들기</button>
      </section>
    );
  }
  return (
    <section className="card fav-bar" aria-label="즐겨찾기">
      <div className="fav-head">
        <h2>⭐ 즐겨찾기</h2>
        <button type="button" className="link-btn" onClick={onManage}>편집</button>
      </div>
      <div className="fav-chips">
        {favorites.map((f) => (
          <button key={f.id} type="button" className={`fav-chip ${f.type}`} onClick={() => onUse(f)}
            title={f.amount ? '누르면 오늘 날짜로 바로 저장돼요' : '누르면 금액을 입력하는 창이 열려요'}>
            <span className="fi" aria-hidden="true">{iconOf(cats, f.type, f.category)}</span>
            <span className="fl">{f.label}</span>
            <span className="fa">{f.amount ? won(f.amount) : '금액 입력'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
