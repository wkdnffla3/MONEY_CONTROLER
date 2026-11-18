// 전체 백업·복원
//  - 백업 파일: 가계부 내역·장보기·설정 전체를 JSON 하나로 (이 기기 화면 기준, 오프라인에서도 받을 수 있음)
//  - 복원: 파일을 검사 → 무엇이 바뀌는지 미리 보여 주고 → 내역·장보기는 DB 함수(014)로 300건씩, 설정은 보관 목록으로
//  - 댓글·변경 기록은 포함하지 않음
import { isValidItem, isValidTx, SETTINGS } from './outbox.js';
import { DEFAULT_CATEGORIES } from './categories.js';

export const BACKUP_FORMAT = 'ledger-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 30 * 1024 * 1024;
const MAX_ROWS = 200_000;
const SETTING_KEYS = Object.keys(SETTINGS);
const TX_KEYS = ['type', 'amount', 'category', 'memo', 'date', 'memberId', 'tags', 'cardId', 'inst', 'createdAt'];
const ITEM_KEYS = ['name', 'qty', 'price', 'category', 'memberId', 'memo', 'checked', 'status', 'paid', 'txId', 'boughtAt', 'createdAt'];
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const pad = (n) => String(n).padStart(2, '0');

/** 이 기기에서 보이는 가계부 전체 → 백업 객체 */
export function buildBackup(view, { ledgerId, exportedAt = new Date() } = {}) {
  const transactions = Object.entries(view.tx || {})
    .map(([id, t]) => ({ id, ...normTx(t) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
  const items = Object.entries(view.items || {}).map(([id, i]) => ({ id, ...normItem(i) }));
  const settings = Object.fromEntries(SETTING_KEYS.map((k) => [k, view[k] ?? SETTINGS[k].empty]));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: '가계부',
    exportedAt: new Date(exportedAt).toISOString(),
    ledgerId: ledgerId || null,
    counts: { transactions: transactions.length, items: items.length },
    settings,
    transactions,
    items,
  };
}

export const backupFileName = (d = new Date()) => `가계부-백업-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;

function normTx(t) {
  return {
    type: t.type, amount: t.amount, category: t.category, memo: t.memo || '', date: t.date,
    memberId: t.memberId ?? null, tags: Array.isArray(t.tags) ? t.tags : [], cardId: t.cardId ?? null,
    inst: Number.isInteger(t.inst) ? t.inst : 1, createdAt: Number.isSafeInteger(t.createdAt) && t.createdAt >= 0 ? t.createdAt : 0,
  };
}
function normItem(i) {
  return {
    name: i.name, qty: i.qty, price: i.price, category: i.category, memberId: i.memberId ?? null, memo: i.memo || '',
    checked: !!i.checked, status: i.status === 'bought' ? 'bought' : 'todo', paid: i.paid ?? null, txId: i.txId ?? null,
    boughtAt: i.boughtAt ?? null, createdAt: Number.isSafeInteger(i.createdAt) && i.createdAt >= 0 ? i.createdAt : 0,
  };
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

/**
 * 백업 파일 내용 검사. 형식이 틀린 줄은 버리고 개수만 알려 줌 (파일이 조작돼도 앱·DB에 이상한 값이 안 들어가게)
 * → { ok: true, backup: { ledgerId, exportedAt, tx: [[id, data]], items: [[id, data]], settings }, invalid: { tx, items, settings: [] } }
 * → { ok: false, error }
 */
export function parseBackup(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '빈 파일이에요.' };
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: '파일이 너무 커요 (30MB까지).' };
  let j;
  try { j = JSON.parse(text.replace(/^﻿/, '')); } catch { return { ok: false, error: '가계부 백업 파일이 아니에요. (JSON 형식이 아님)' }; }
  if (!j || typeof j !== 'object' || j.format !== BACKUP_FORMAT) return { ok: false, error: '가계부 백업 파일이 아니에요. 이 앱의 "백업 파일 받기"로 만든 파일을 골라 주세요.' };
  if (!Number.isInteger(j.version) || j.version < 1) return { ok: false, error: '백업 파일 형식을 알 수 없어요.' };
  if (j.version > BACKUP_VERSION) return { ok: false, error: '더 새로운 버전의 앱에서 만든 백업이에요. 앱을 새로고침한 뒤 다시 시도해 주세요.' };
  const txIn = Array.isArray(j.transactions) ? j.transactions : [];
  const itIn = Array.isArray(j.items) ? j.items : [];
  if (txIn.length + itIn.length > MAX_ROWS) return { ok: false, error: '내역이 너무 많아요.' };

  const invalid = { tx: 0, items: 0, settings: [] };
  const tx = new Map();
  for (const r of txIn) {
    if (!r || typeof r !== 'object' || !isId(r.id)) { invalid.tx += 1; continue; }
    const data = normTx(pick(r, TX_KEYS));
    if (!isValidTx(data)) { invalid.tx += 1; continue; }
    tx.set(r.id, data);
  }
  const items = new Map();
  for (const r of itIn) {
    if (!r || typeof r !== 'object' || !isId(r.id)) { invalid.items += 1; continue; }
    const data = normItem(pick(r, ITEM_KEYS));
    if (!isValidItem(data)) { invalid.items += 1; continue; }
    items.set(r.id, data);
  }
  const settings = {};
  const src = j.settings && typeof j.settings === 'object' ? j.settings : {};
  for (const k of SETTING_KEYS) {
    if (!(k in src)) continue;
    if (SETTINGS[k].valid(src[k])) settings[k] = src[k];
    else invalid.settings.push(k);
  }
  const exportedAt = typeof j.exportedAt === 'string' && !Number.isNaN(Date.parse(j.exportedAt)) ? j.exportedAt : null;
  return {
    ok: true,
    backup: { ledgerId: typeof j.ledgerId === 'string' ? j.ledgerId : null, exportedAt, tx: [...tx], items: [...items], settings },
    invalid,
  };
}

// 다른 가계부의 백업을 넣을 때 쓰는 새 ID. 같은 백업을 두 번 넣어도 같은 ID가 나와서 중복되지 않음
function hashId(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b ^= b >>> 15;
  }
  return `rb-${a.toString(36)}${b.toString(36)}`;
}
const sameJson = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/**
 * 복원 계획: 지금 화면(current) 과 비교해서 보낼 줄과 미리 보기 숫자.
 * overwrite=false → 없는 것만 추가 / true → 내용이 다른 것도 백업 때로 되돌림
 * sameLedger=false(다른 가계부의 백업) → 모든 줄에 새 ID (원래 가계부의 줄과 부딪히지 않게)
 */
export function planRestore(backup, current, { overwrite = false, sameLedger = true, ledgerId = '' } = {}) {
  const idOf = (kind, id) => (sameLedger ? id : hashId(`${backup.ledgerId || ''}:${ledgerId}:${kind}:${id}`));
  const txIdMap = new Map(backup.tx.map(([id]) => [id, idOf('tx', id)]));
  const count = { txNew: 0, txSame: 0, txChanged: 0, itemsNew: 0, itemsSame: 0, itemsChanged: 0 };
  const tx = [];
  for (const [oldId, data] of backup.tx) {
    const id = txIdMap.get(oldId);
    const cur = current.tx?.[id];
    if (!cur) { count.txNew += 1; tx.push([id, data]); continue; }
    if (sameJson(normTx(cur), data)) { count.txSame += 1; continue; }
    count.txChanged += 1;
    if (overwrite) tx.push([id, data]);
  }
  const items = [];
  for (const [oldId, raw] of backup.items) {
    const id = idOf('item', oldId);
    const data = sameLedger ? raw : { ...raw, txId: raw.txId ? (txIdMap.get(raw.txId) ?? null) : null };
    const cur = current.items?.[id];
    if (!cur) { count.itemsNew += 1; items.push([id, data]); continue; }
    if (sameJson(normItem(cur), data)) { count.itemsSame += 1; continue; }
    count.itemsChanged += 1;
    if (overwrite) items.push([id, data]);
  }
  const settings = planSettings(current, backup.settings, overwrite);
  return { tx, items, settings, count };
}

const addById = (cur, bak, max) => {
  const have = new Set(cur.map((x) => x.id));
  const out = [...cur];
  for (const x of bak) { if (out.length >= max) break; if (!have.has(x.id)) { out.push(x); have.add(x.id); } }
  return out;
};

/** 설정 복원 작업 목록 [{ kind, value }] — 덮어쓰기면 백업 값, 아니면 지금 값에 빠진 것만 더함 */
export function planSettings(cur, bak = {}, overwrite = false) {
  const out = [];
  for (const k of SETTING_KEYS) {
    if (!(k in bak)) continue;
    const now = cur[k] ?? SETTINGS[k].empty;
    let next;
    if (overwrite) next = bak[k];
    else if (k === 'budget') next = now > 0 ? now : bak[k];
    else if (k === 'members' || k === 'cards') next = addById(now, bak[k], 10);
    else if (k === 'recurring') next = addById(now, bak[k], 50);
    else if (k === 'favorites') next = addById(now, bak[k], 20);
    else if (k === 'catBudgets') {
      next = { ...now };
      for (const [name, amt] of Object.entries(bak[k])) { if (Object.keys(next).length >= 60) break; if (!(name in next)) next[name] = amt; }
    } else if (k === 'dismissedSubs') next = [...new Set([...now, ...bak[k]])].slice(0, 100);
    else if (k === 'categories') {
      if (bak[k] == null) continue;
      const base = now ?? DEFAULT_CATEGORIES;
      next = {};
      for (const t of ['expense', 'income']) {
        const list = [...base[t]];
        for (const c of bak[k][t]) { if (list.length >= 30) break; if (!list.some((x) => x.name === c.name)) list.push(c); }
        next[t] = list;
      }
      if (now == null && sameJson(next, DEFAULT_CATEGORIES)) continue;
    }
    if (next === undefined || sameJson(next, now) || !SETTINGS[k].valid(next)) continue;
    out.push({ kind: k, value: next });
  }
  return out;
}

const LAST_KEY = (ledgerId) => `ledger.lastBackup.${ledgerId}`;
/** 이 기기에서 마지막으로 백업 파일을 받은 때 (없으면 null) */
export function getLastBackup(ledgerId) {
  try { const v = localStorage.getItem(LAST_KEY(ledgerId)); return v && !Number.isNaN(Date.parse(v)) ? new Date(v) : null; } catch { return null; }
}
export function setLastBackup(ledgerId, d = new Date()) {
  try { localStorage.setItem(LAST_KEY(ledgerId), d.toISOString()); } catch { /* 저장 공간 부족 등 → 안내만 안 뜸 */ }
}
/** 백업 권장 안내: 내역이 20건 이상인데 30일 넘게(또는 한 번도) 안 받았으면 */
export function backupDue(ledgerId, txCount, now = new Date()) {
  if (!ledgerId || txCount < 20) return false;
  const last = getLastBackup(ledgerId);
  return !last || now - last > 30 * 86400000;
}
