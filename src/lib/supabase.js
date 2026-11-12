import { createClient } from '@supabase/supabase-js';

// 붙여넣은 주소를 https://<프로젝트ID>.supabase.co 형태로 정리
// (끝의 / , /rest/v1 , 대시보드 주소, 따옴표·공백 등을 자동으로 바로잡음)
export function normalizeSupabaseUrl(raw) {
  let s = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
  if (!s) return '';
  const dash = s.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,})/i);
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

// ---------- 자동 로그인 ----------
// ON  → localStorage   (브라우저를 닫아도 로그인 유지)
// OFF → sessionStorage (탭을 닫으면 로그아웃)
const REMEMBER_KEY = 'ledger.remember';
const safe = (fn, fallback) => {
  try { return fn(); } catch { return fallback; }
};
export const getRemember = () => safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true);
export const setRemember = (on) => safe(() => localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'));

const authStorage = {
  getItem: (k) => safe(() => localStorage.getItem(k) ?? sessionStorage.getItem(k), null),
  setItem: (k, v) => safe(() => {
    if (getRemember()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
    else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
  }),
  removeItem: (k) => safe(() => { localStorage.removeItem(k); sessionStorage.removeItem(k); }),
};

// ---------- 클라이언트 ----------
const url = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim().replace(/^['"]|['"]$/g, '');

export const configError =
  !url || url.includes('your-project') ? 'VITE_SUPABASE_URL 환경변수가 비어 있거나 잘못됐어요.'
  : !key || key.startsWith('your-') ? 'VITE_SUPABASE_ANON_KEY 환경변수가 비어 있어요.'
  : null;

export const supabase = configError
  ? null
  : createClient(url, key, {
      auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

export const redirectUrl = () => window.location.origin + window.location.pathname;
