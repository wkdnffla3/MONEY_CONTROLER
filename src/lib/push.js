// 웹 푸시 (앱을 닫아 둬도 오는 알림) — 이 기기를 구독 목록(push_subscriptions)에 등록/해제.
// 실제 발송은 Supabase Edge Function(supabase/functions/push-notify)이 함.
import { supabase } from './supabase';
import { getDeviceId } from './device';
import { isPushEndpoint } from '../../supabase/functions/_shared/notifyMessage.js';
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

// 단계마다 제한 시간: 브라우저가 대답하지 않으면 "처리 중…"에서 멈추지 않고 이유를 알려줌
const PERMISSION_TIMEOUT_MS = 45000; // 사람이 허용을 누를 시간
const SUBSCRIBE_TIMEOUT_MS = 20000;  // 브라우저 ↔ 푸시 서비스(구글·애플·모질라) 연결
const SERVER_TIMEOUT_MS = 15000;     // 우리 서버(Supabase)에 등록
const timeout = (p, ms, message) => Promise.race([
  Promise.resolve(p),
  new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(message), { code: 'push_timeout' })), ms)),
]);

/** 카카오톡·네이버·인스타그램 등 앱 안 브라우저 (웹 푸시가 안 되거나 권한 창이 안 뜸) */
export function isInAppBrowser(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  return /KAKAOTALK|NAVER\(inapp|; ?NAVER|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|everytimeApp|wv\)/i.test(ua);
}

/** 삼성 인터넷 (웹 푸시는 되지만 브라우저·휴대폰 알림 설정이 꺼져 있으면 권한 창이 안 뜸) */
export const isSamsungBrowser = (ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') => /SamsungBrowser/i.test(ua);
const SAMSUNG_HINT = '삼성 인터넷이면 ① 휴대폰 설정 → 애플리케이션 → 삼성 인터넷 → 알림 허용, ② 삼성 인터넷 메뉴(≡) → 설정 → 사이트 및 다운로드 → 알림 → "사이트가 알림을 요청하도록 허용"을 켠 뒤 다시 눌러 주세요';

// 예전 사파리는 콜백 방식이라 둘 다 받음
function askPermission() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const p = Notification.requestPermission(finish);
      if (p && typeof p.then === 'function') p.then(finish, () => finish('default'));
    } catch { finish(Notification.permission); }
  });
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
  if (isInAppBrowser()) return 'inapp';
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!hasApis()) return 'unsupported';
  if (!isValidVapidKey(VAPID_KEY)) return 'no-key';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration().catch(() => null);
  if (!reg) return 'no-sw';
  const sub = await timeout(reg.pushManager.getSubscription(), 5000, '').catch(() => null);
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/**
 * 웹 푸시 켜기: 권한 요청 → 구독 → 서버에 이 기기 등록
 * onStep(text): 지금 하는 단계 (화면에 보여 줌 → 멈추면 어디서 멈췄는지 알 수 있음)
 */
export async function enablePush(prefs, ledgerId, onStep = () => {}) {
  if (!supabase) throw new Error('Supabase 설정이 없어요');
  if (isInAppBrowser()) throw new Error('카카오톡·네이버 같은 앱 안 브라우저에서는 켤 수 없어요. 크롬·사파리로 열어 주세요');
  if (Notification.permission !== 'granted') {
    onStep('알림 권한 확인 중… (허용을 눌러 주세요)');
    const perm = await timeout(askPermission(), isSamsungBrowser() ? 20000 : PERMISSION_TIMEOUT_MS,
      isSamsungBrowser() ? `알림 권한 창이 뜨지 않았어요. ${SAMSUNG_HINT}`
        : '알림 권한 창에 대답이 없어요. 주소창 옆의 🔔(또는 자물쇠) 아이콘을 눌러 알림을 "허용"한 뒤 다시 눌러 주세요');
    if (perm !== 'granted') {
      if (perm === 'denied') throw new Error(isSamsungBrowser() ? `알림이 차단돼 있어요. ${SAMSUNG_HINT}` : '브라우저에서 알림이 차단돼 있어요');
      throw new Error(isSamsungBrowser() ? `알림 권한이 허용되지 않았어요. ${SAMSUNG_HINT}` : '알림 권한을 허용해 주세요');
    }
  }
  onStep('앱 준비 확인 중…');
  const reg = await registration();
  if (!reg) throw new Error('앱이 아직 준비되지 않았어요. 페이지를 새로고침한 뒤 다시 시도해 주세요');
  onStep('푸시 서비스에 연결 중…');
  // 예전 구독(다른 계정이 쓰던 것일 수도 있음)은 버리고 새로 받음
  const old = await timeout(reg.pushManager.getSubscription(), 5000, '').catch(() => null);
  if (old) await timeout(old.unsubscribe(), 5000, '').catch(() => {});
  let sub;
  try {
    sub = await timeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY) }), SUBSCRIBE_TIMEOUT_MS,
      '이 기기의 브라우저가 푸시 서비스에 연결하지 못했어요. 인터넷 연결을 확인하고, 브레이브는 설정 → 개인 정보 → "푸시 메시지에 Google 서비스 사용"을 켜 주세요. 삼성 인터넷·웨일이면 크롬에서 열어 보세요');
  } catch (e) {
    if (e?.code === 'push_timeout') throw e;
    // AbortError / NotAllowedError 등 브라우저가 거절
    throw new Error(`브라우저가 푸시 구독을 거절했어요 (${e?.name || '오류'}). 크롬·엣지·파이어폭스·사파리 최신 버전에서 켜 주세요`);
  }
  const json = sub.toJSON();
  if (!isPushEndpoint(json.endpoint)) {
    await sub.unsubscribe().catch(() => {});
    throw new Error('이 브라우저의 푸시 서비스는 지원하지 않아요. 크롬·엣지·파이어폭스·사파리에서 켜 주세요');
  }
  const deviceId = getDeviceId();
  onStep('서버에 이 기기 등록 중…');
  try {
    // 이 기기의 예전 줄 정리 후 등록
    await timeout(supabase.from('push_subscriptions').delete().eq('device_id', deviceId), SERVER_TIMEOUT_MS, '서버 응답이 없어요. 인터넷 연결을 확인하고 다시 눌러 주세요');
    const { error } = await timeout(supabase.from('push_subscriptions').upsert({
      ...(ledgerId ? { user_id: ledgerId } : {}), // 알림 받을 가계부 (공유 가계부 참여 중이면 그 가계부)
      device_id: deviceId,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      prefs,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' }), SERVER_TIMEOUT_MS, '서버 응답이 없어요. 인터넷 연결을 확인하고 다시 눌러 주세요');
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
  const sub = reg ? await timeout(reg.pushManager.getSubscription(), 5000, '').catch(() => null) : null;
  if (supabase) {
    const q = supabase.from('push_subscriptions').delete();
    await timeout(sub ? q.eq('endpoint', sub.endpoint) : q.eq('device_id', getDeviceId()), SERVER_TIMEOUT_MS, '').then(() => {}, () => {});
  }
  if (sub) await timeout(sub.unsubscribe(), 5000, '').catch(() => {});
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
