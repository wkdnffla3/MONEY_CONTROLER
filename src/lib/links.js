// 메모 속 링크 찾기 — http/https 주소만 (javascript: 같은 위험한 주소는 무시)
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAIL_PUNCT = /[.,;:!?。、」』'"]/; // 문장 끝 문장부호는 링크에서 제외
const count = (s, ch) => s.split(ch).length - 1;

// 끝의 문장부호를 뗌. 닫는 괄호는 주소 안에 여는 괄호가 없을 때만 뗌
// ("(https://a.com)" → a.com, "https://ko.wikipedia.org/wiki/서울_(도시)" → 괄호 그대로)
function trimTrail(raw) {
  let s = raw;
  for (;;) {
    const ch = s.slice(-1);
    if (ch === ')' && count(s, ')') > count(s, '(')) s = s.slice(0, -1);
    else if (ch === ']' && count(s, ']') > count(s, '[')) s = s.slice(0, -1);
    else if (ch && TRAIL_PUNCT.test(ch)) s = s.slice(0, -1);
    else return s;
  }
}

export function extractLinks(text, max = 5) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(URL_RE)) {
    const raw = trimTrail(m[0]);
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
