// 웹 푸시 (앱을 닫아 둬도 오는 알림) — 이 기기를 구독 목록(push_subscriptions)에 등록/해제.
// 실제 발송은 Supabase Edge Function(supabase/functions/push-notify)이 함.
import { supabase } from './supabase';
import { getDeviceId } from './device';
import { isIOS, isStandalone } from './pwa';

const VAPID_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim();
const READY_TIMEOUT_MS = 8000;

function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// 공개키 모양 검사: P-256 비압축 공개키 = 65바이트, 0x04로 시작
export function isValidVapidKey(k) {
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(k || '')) return false;
  try { const b = keyBytes(k); return b.length === 65 && b[0] === 4; } catch { return false; }
}

const hasApis = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  if (!navigator.serviceWorker) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) return null; // 개발 서버(npm run dev)에서는 서비스워커가 없음
  return Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), READY_TIMEOUT_MS))]);
}

/**
 * 이 기기의 웹 푸시 상태
 * 'ios-install' 아이폰: 홈 화면에 추가한 앱에서만 가능 · 'unsupported' 이 브라우저는 안 됨
 * 'no-key' 관리자 설정 전(VITE_VAPID_PUBLIC_KEY 없음) · 'no-sw' 서비스워커 없음(개발 모드)
 * 'denied' 브라우저에서 알림 차단됨 · 'off' 꺼짐 · 'on' 켜짐
 */
export async function getPushState() {
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!hasApis()) return 'unsupported';
  if (!isValidVapidKey(VAPID_KEY)) return 'no-key';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration().catch(() => null);
  if (!reg) return 'no-sw';
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** 웹 푸시 켜기: 권한 요청 → 구독 → 서버에 이 기기 등록 */
export async function enablePush(prefs) {
  if (!supabase) throw new Error('Supabase 설정이 없어요');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? '브라우저에서 알림이 차단돼 있어요' : '알림 권한을 허용해 주세요');
  const reg = await registration();
  if (!reg) throw new Error('서비스워커가 준비되지 않았어요. 배포된 사이트에서 다시 시도해 주세요');
  // 예전 구독(다른 계정이 쓰던 것일 수도 있음)은 버리고 새로 받음
  const old = await reg.pushManager.getSubscription().catch(() => null);
  if (old) await old.unsubscribe().catch(() => {});
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY) });
  const json = sub.toJSON();
  const deviceId = getDeviceId();
  try {
    // 이 기기의 예전 줄 정리 후 등록
    await supabase.from('push_subscriptions').delete().eq('device_id', deviceId);
    const { error } = await supabase.from('push_subscriptions').upsert({
      device_id: deviceId,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      prefs,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) throw error;
  } catch (e) {
    await sub.unsubscribe().catch(() => {});
    throw e;
  }
  return 'on';
}

/** 웹 푸시 끄기: 서버에서 이 기기를 지우고 구독 해제 */
export async function disablePush() {
  const reg = await registration().catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (supabase) {
    const q = supabase.from('push_subscriptions').delete();
    await (sub ? q.eq('endpoint', sub.endpoint) : q.eq('device_id', getDeviceId())).then(() => {}, () => {});
  }
  if (sub) await sub.unsubscribe().catch(() => {});
  return 'off';
}

/** 알림 종류·방해 금지 시간 바꾸면 서버의 이 기기 설정도 갱신 */
export async function syncPushPrefs(prefs) {
  if (!supabase || !hasApis()) return;
  const reg = await registration().catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (!sub) return;
  await supabase.from('push_subscriptions').update({ prefs, updated_at: new Date().toISOString() }).eq('endpoint', sub.endpoint);
}

/** 이 기기에 웹 푸시 구독이 있는지 (앱 안 알림과 겹치지 않게 확인용) */
export async function hasPushSubscription() {
  if (!hasApis()) return false;
  const reg = await registration().catch(() => null);
  return !!(reg && await reg.pushManager.getSubscription().catch(() => null));
}
