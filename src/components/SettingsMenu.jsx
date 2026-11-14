const ITEMS = [
  ['share', '🏠', '가계부 공유', '각자 계정으로 같은 가계부 쓰기'],
  ['favorites', '⭐', '즐겨찾기', '자주 쓰는 내역 한 번에 입력'],
  ['history', '🕘', '변경 기록', '누가 언제 무엇을 바꿨는지 · 되살리기'],
  ['recurring', '🔁', '반복 내역', '월세·구독료·월급 자동 기록'],
  ['categories', '🏷️', '카테고리 편집', '추가·이름 변경·순서·삭제'],
  ['catBudgets', '🎯', '카테고리별 예산', '카테고리마다 한도 정하기'],
  ['cards', '💳', '신용카드', '결제일·이용 마감일, 할부'],
  ['search', '🔍', '상세 검색', '기간·금액·태그로 찾기'],
  ['notify', '🔔', '알림', '다른 사람이 추가하면 알려주기'],
  ['budget', '💰', '월 예산', '한 달 전체 예산'],
  ['members', '👥', '함께 쓰는 사람', '사람별로 나눠 보기'],
  ['export', '📄', 'CSV 내보내기', '엑셀에서 열기, 백업'],
];

export default function SettingsMenu({ onOpen, counts = {}, shared = false }) {
  return (
    <ul className="menu-list">
      {ITEMS.map(([kind, icon, title, desc]) => (
        <li key={kind}>
          <button type="button" onClick={() => onOpen(kind)}>
            <span className="mi">{icon}</span>
            <span className="mt"><b>{title}</b><small>{desc}</small></span>
            {kind === 'share' && shared ? <span className="share-badge">공유 중</span> : null}
            {counts[kind] ? <span className="mc">{counts[kind]}</span> : null}
            <span className="chev" aria-hidden="true">›</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
