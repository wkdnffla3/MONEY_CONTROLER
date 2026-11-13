const ITEMS = [
  ['recurring', '🔁', '반복 내역', '월세·구독료·월급 자동 기록'],
  ['categories', '🏷️', '카테고리 편집', '추가·이름 변경·순서·삭제'],
  ['catBudgets', '🎯', '카테고리별 예산', '카테고리마다 한도 정하기'],
  ['budget', '💰', '월 예산', '한 달 전체 예산'],
  ['members', '👥', '함께 쓰는 사람', '사람별로 나눠 보기'],
  ['export', '📄', 'CSV 내보내기', '엑셀에서 열기, 백업'],
];

export default function SettingsMenu({ onOpen, counts = {} }) {
  return (
    <ul className="menu-list">
      {ITEMS.map(([kind, icon, title, desc]) => (
        <li key={kind}>
          <button type="button" onClick={() => onOpen(kind)}>
            <span className="mi">{icon}</span>
            <span className="mt"><b>{title}</b><small>{desc}</small></span>
            {counts[kind] ? <span className="mc">{counts[kind]}</span> : null}
            <span className="chev" aria-hidden="true">›</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
