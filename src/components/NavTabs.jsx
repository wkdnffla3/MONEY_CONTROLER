/** 페이지 탭: 가계부 / 내역 / 장보기 / 리포트 (주소 #list, #shopping, #report 로 바로 열 수 있음) */
export default function NavTabs({ page, onChange, cartCount = 0, todoCount = 0 }) {
  const tabs = [
    ['ledger', '가계부', null],
    ['list', '내역', null],
    ['shopping', '장보기', todoCount + cartCount || null],
    ['report', '리포트', null],
  ];
  return (
    <nav className="nav-tabs" aria-label="페이지">
      {tabs.map(([key, label, badge]) => (
        <button key={key} type="button" aria-current={page === key ? 'page' : undefined} onClick={() => onChange(key)}>
          {label}{badge ? <span className="badge">{badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}
