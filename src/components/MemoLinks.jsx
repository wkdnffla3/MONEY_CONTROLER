import { extractLinks } from '../lib/links';

/** 메모 아래 "링크 열기" 버튼들 (새 탭으로, 앱 정보는 넘기지 않음) */
export default function MemoLinks({ text }) {
  const links = extractLinks(text);
  if (!links.length) return null;
  return (
    <div className="memo-links" aria-label="메모 속 링크">
      {links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="memo-link" title={l.href}>
          🔗 <span>{l.label}</span>
        </a>
      ))}
    </div>
  );
}
