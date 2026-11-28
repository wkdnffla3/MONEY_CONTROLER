// 안드로이드 "공유 → 가계부"로 받은 글 (manifest 의 share_target → 서비스워커가 받음)
// 서비스워커(public/sw.js)가 공유 글을 이 기기의 캐시에 잠깐 넣고 "/?share=1" 로 앱을 열면,
// 앱이 여기서 읽고 바로 지움. 서버로는 보내지 않음 (sw.js 의 SHARE_CACHE·SHARE_KEY 와 같은 값)
export const SHARE_CACHE = 'ledger-share';
export const SHARE_KEY = '/__shared-text';
export const SHARE_PARAM = 'share';

/** 공유로 열렸는지 (주소에 ?share=1) */
export const openedFromShare = (search = window.location.search) => new URLSearchParams(search).has(SHARE_PARAM);

/** 받아 둔 공유 글을 꺼내고 지움. 없거나 읽을 수 없으면 '' */
export async function takeSharedText() {
  try {
    if (typeof caches === 'undefined') return '';
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match(SHARE_KEY);
    if (!res) return '';
    const text = await res.text();
    await cache.delete(SHARE_KEY);
    return text.slice(0, 2000);
  } catch {
    return '';
  }
}
