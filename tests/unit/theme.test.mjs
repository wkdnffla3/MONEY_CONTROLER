// 화면 테마 선택 단위 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_KEY, THEMES, getTheme, saveTheme, applyTheme, isValidTheme } from '../../src/lib/theme.js';

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    has: (k) => m.has(k),
  };
};
const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
const fakeRoot = () => {
  const attrs = {};
  return { attrs, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
};

test('세 가지 테마만 올바른 값', () => {
  assert.deepEqual(THEMES, ['system', 'light', 'dark']);
  for (const t of THEMES) assert.equal(isValidTheme(t), true);
  for (const bad of ['', 'Dark', 'auto', null, undefined, 1, {}]) assert.equal(isValidTheme(bad), false);
});

test('저장한 값을 다시 읽음', () => {
  const s = memStorage();
  assert.equal(saveTheme('dark', s), 'dark');
  assert.equal(getTheme(s), 'dark');
  assert.equal(saveTheme('light', s), 'light');
  assert.equal(getTheme(s), 'light');
});

test('기본값과 손상·조작된 값은 기기 설정(system)', () => {
  assert.equal(getTheme(memStorage()), 'system');
  assert.equal(getTheme(memStorage({ [THEME_KEY]: 'purple' })), 'system');
  assert.equal(getTheme(memStorage({ [THEME_KEY]: '"dark"' })), 'system');
  assert.equal(getTheme(null), 'system');
});

test('system으로 바꾸면 저장 값을 지움, 잘못된 값은 system으로 저장', () => {
  const s = memStorage({ [THEME_KEY]: 'dark' });
  assert.equal(saveTheme('system', s), 'system');
  assert.equal(s.has(THEME_KEY), false);
  s.setItem(THEME_KEY, 'light');
  assert.equal(saveTheme('<script>', s), 'system');
  assert.equal(s.has(THEME_KEY), false);
});

test('저장소를 못 써도 오류 없이 동작', () => {
  assert.equal(getTheme(throwing), 'system');
  assert.equal(saveTheme('dark', throwing), 'dark');
});

test('applyTheme: light·dark는 속성, system·잘못된 값은 속성 제거', () => {
  const r = fakeRoot();
  applyTheme('dark', r); assert.equal(r.attrs['data-theme'], 'dark');
  applyTheme('light', r); assert.equal(r.attrs['data-theme'], 'light');
  applyTheme('system', r); assert.equal('data-theme' in r.attrs, false);
  applyTheme('dark', r); applyTheme('weird', r); assert.equal('data-theme' in r.attrs, false);
  assert.doesNotThrow(() => applyTheme('dark', null));
});
