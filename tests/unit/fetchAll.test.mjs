// 1,000줄씩 나눠 끝까지 받기 (lib/fetchAll.js)
import assert from 'node:assert/strict';
import { fetchAll } from '../../src/lib/fetchAll.js';

const fakeTable = (n, cap = 1000, failAt = -1) => {
  const calls = [];
  const build = () => {
    const st = {};
    const q = {
      order(k, o) { st.order = [k, o]; return q; },
      range(a, z) {
        st.range = [a, z]; calls.push([a, z]);
        if (calls.length - 1 === failAt) return Promise.resolve({ data: null, error: { message: 'boom' } });
        const rows = Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(6, '0') }));
        return Promise.resolve({ data: rows.slice(a, Math.min(z + 1, a + cap)), error: null });
      },
    };
    return q;
  };
  return { build, calls };
};

let t = fakeTable(2500);
let r = await fetchAll(t.build);
assert.equal(r.data.length, 2500);
assert.deepEqual(t.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
assert.equal(new Set(r.data.map((x) => x.id)).size, 2500);

t = fakeTable(1000); // 딱 1,000줄 → 다음 쪽이 비어 있는지 한 번 더 확인
r = await fetchAll(t.build);
assert.equal(r.data.length, 1000);
assert.equal(t.calls.length, 2);

t = fakeTable(5);
r = await fetchAll(t.build);
assert.equal(r.data.length, 5);
assert.equal(t.calls.length, 1);

t = fakeTable(0);
r = await fetchAll(t.build);
assert.deepEqual(r, { data: [], error: null });

t = fakeTable(2500, 1000, 1); // 두 번째 쪽에서 오류 → 일부만 돌려주지 않고 오류
r = await fetchAll(t.build);
assert.equal(r.data, null);
assert.equal(r.error.message, 'boom');

console.log('fetchAll unit tests: all passed');
