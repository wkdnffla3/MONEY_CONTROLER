// 알림 설정(기기마다 저장)과 문구 도우미. 문구 규칙은 Edge Function 과 같은 파일을 씀.
export {
  DEFAULT_PREFS, NOTIFY_KINDS, buildNotification, inQuietHours, normalizePrefs, shouldSend,
} from '../../supabase/functions/_shared/notifyMessage.js';
import { normalizePrefs } from '../../supabase/functions/_shared/notifyMessage.js';

const key = (uid) => `ledger.notify.${uid}`;

export function getPrefs(uid) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key(uid)) || 'null'); } catch { /* 기본값 */ }
  const p = normalizePrefs(saved);
  // 처음엔 이 기기의 시간대로
  if (!saved || !saved.tz) {
    try { p.tz = normalizePrefs({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone }).tz; } catch { /* 기본 Asia/Seoul */ }
  }
  return p;
}

export function setPrefs(uid, prefs) {
  const p = normalizePrefs(prefs);
  try { localStorage.setItem(key(uid), JSON.stringify(p)); } catch { /* 이번 접속 동안만 */ }
  return p;
}
