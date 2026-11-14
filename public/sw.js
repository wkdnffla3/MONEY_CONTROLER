/* 가계부 서비스워커
 * - 화면(HTML): 네트워크 우선 → 오프라인이면 저장해 둔 화면을 보여줌 (새 배포가 바로 반영됨)
 * - JS·CSS·아이콘: 캐시 우선 (Vite가 파일명에 해시를 붙여서 내용이 바뀌면 이름도 바뀜)
 * - Supabase 등 다른 도메인 요청과 GET 이외 요청은 건드리지 않음 → 내역 데이터는 캐시하지 않음
 * 캐시 구조를 바꿀 때만 VERSION 을 올리세요.
 */
const VERSION = 'v1'; // 알림 코드를 추가해도 캐시 구조는 같아서 그대로
const SHELL_CACHE = `ledger-shell-${VERSION}`;
const ASSET_CACHE = `ledger-assets-${VERSION}`;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

// index.html 이 불러오는 빌드 파일(/assets/...)도 설치할 때 함께 저장
// → 첫 방문 직후에도 오프라인에서 화면이 열림
async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  await shell.addAll(SHELL_URLS);
  try {
    const res = await shell.match('/');
    const html = res ? await res.text() : '';
    const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
    if (assets.length) await (await caches.open(ASSET_CACHE)).addAll(assets);
  } catch {
    // 실패해도 다음 방문 때 fetch 단계에서 채워짐
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('ledger-') && k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, 폰트 등은 브라우저에 맡김

  // 화면 이동(주소 입력, 새로고침, 홈 화면 아이콘으로 열기)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  // 빌드 결과물과 아이콘
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })),
    );
  }
});

// ===== 웹 푸시 (supabase/functions/push-notify 가 보냄) =====
// 앱 화면을 보고 있으면 앱 안 배너가 이미 알려주므로 시스템 알림은 생략
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: '가계부', body: event.data ? event.data.text() : '' }; }
  const title = String(data.title || '가계부').slice(0, 80);
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.some((c) => c.visibilityState === 'visible' && c.focused)) return undefined;
      return self.registration.showNotification(title, {
        body: String(data.body || '').slice(0, 160),
        tag: typeof data.tag === 'string' ? data.tag.slice(0, 80) : undefined,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url },
      });
    }),
  );
});

// 알림을 누르면: 열린 앱 창이 있으면 그 창으로, 없으면 새로 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const url = typeof raw === 'string' && raw.startsWith('/') ? raw : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (win) {
        win.postMessage({ type: 'navigate', url });
        return win.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
