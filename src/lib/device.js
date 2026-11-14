// 이 기기(브라우저)를 구분하는 ID와, 이 기기에서 방금 저장한 항목 기록.
// 내가 입력한 내역이 실시간으로 되돌아왔을 때 나에게 알림을 띄우지 않기 위해 씀.
import { newId } from './outbox';

const DEVICE_KEY = 'ledger.device';
const OWN_KEY = 'ledger.ownIds';
const OWN_TTL = 10 * 60 * 1000; // 10분 안에 저장한 ID만 기억
const OWN_MAX = 300;

let memDevice = null;
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[\w-]{8,64}$/.test(id)) { id = `d-${newId()}`.slice(0, 64); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch {
    if (!memDevice) memDevice = `d-${newId()}`.slice(0, 64);
    return memDevice;
  }
}

let memOwn = [];
const readOwn = () => {
  try { const v = JSON.parse(localStorage.getItem(OWN_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return memOwn; }
};

/** 이 기기에서 저장한 ID 기록 (같은 기기의 다른 탭도 공유) */
export function markOwn(ids) {
  const now = Date.now();
  const list = readOwn().filter((x) => x && now - x.at < OWN_TTL && !ids.includes(x.id));
  for (const id of ids) list.push({ id, at: now });
  memOwn = list.slice(-OWN_MAX);
  try { localStorage.setItem(OWN_KEY, JSON.stringify(memOwn)); } catch { /* 메모리 기록으로 충분 */ }
}

export function isOwn(id) {
  const now = Date.now();
  return readOwn().some((x) => x && x.id === id && now - x.at < OWN_TTL) || memOwn.some((x) => x.id === id && now - x.at < OWN_TTL);
}
