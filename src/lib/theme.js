// 화면 테마 직접 선택 (기기마다 저장, 서버에 보내지 않음)
// 'system' = 기기 설정 따라감(기본), 'light' = 항상 밝게, 'dark' = 항상 어둡게
// CSS(styles.css)는 <html data-theme="light|dark"> 가 있으면 그걸 따르고, 없으면 prefers-color-scheme 을 따른다.

export const THEME_KEY = 'ledger.theme';
export const THEMES = ['system', 'light', 'dark'];
export const THEME_LABELS = { system: '기기 설정', light: '밝게', dark: '어둡게' };

const defaultStorage = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export const isValidTheme = (v) => THEMES.includes(v);

// 저장된 값이 없거나 손상·조작됐으면 'system'
export function getTheme(storage = defaultStorage()) {
  try {
    const v = storage?.getItem(THEME_KEY);
    return isValidTheme(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

// 'system'이면 저장 값을 지움. 저장소를 못 써도(사생활 보호 모드 등) 오류를 내지 않음
export function saveTheme(theme, storage = defaultStorage()) {
  const t = isValidTheme(theme) ? theme : 'system';
  try {
    if (t === 'system') storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, t);
  } catch { /* 무시: 이번 화면에는 그대로 적용됨 */ }
  return t;
}

// <html>에 data-theme 반영. 'system'이면 속성을 지워 CSS 미디어 쿼리에 맡김
export function applyTheme(theme, root = globalThis.document?.documentElement) {
  if (!root) return;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}
