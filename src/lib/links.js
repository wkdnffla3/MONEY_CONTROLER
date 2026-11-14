// 메모 속 링크 찾기 — http/https 주소만 (javascript: 같은 위험한 주소는 무시)
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAIL = /[)\].,;:!?。、」』'"]+$/; // 문장 끝 문장부호는 링크에서 제외

export function extractLinks(text, max = 5) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(URL_RE)) {
    let raw = m[0].replace(TRAIL, '');
    // 여는 괄호 없이 닫는 괄호만 있으면 제외 (예: "(https://a.com)")
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      const href = u.href;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({ href, label: shortLabel(u) });
      if (out.length >= max) break;
    } catch { /* 주소 모양이 아님 */ }
  }
  return out;
}

/** 화면 표시용 짧은 이름: example.com/path… */
export function shortLabel(u) {
  const host = u.hostname.replace(/^www\./, '');
  const rest = (u.pathname === '/' ? '' : u.pathname) + (u.search || '');
  const s = host + rest;
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

export const hasLink = (text) => /\bhttps?:\/\//i.test(String(text || ''));
