export const db = { settings: [], push_subscriptions: [], transactions: [] };
export function createClient() {
  return { from(t) {
    const st = { f: [], del: false };
    const b = {
      select() { return b; }, delete() { st.del = true; return b; },
      eq(k, v) { st.f.push((r) => r[k] === v); return b; }, gte(k, v) { st.f.push((r) => r[k] >= v); return b; }, lte(k, v) { st.f.push((r) => r[k] <= v); return b; },
      maybeSingle() { const rows = db[t].filter((r) => st.f.every((f) => f(r))); return Promise.resolve({ data: rows[0] || null, error: null }); },
      then(res, rej) {
        if (st.del) { db[t] = db[t].filter((r) => !st.f.every((f) => f(r))); return Promise.resolve({ error: null }).then(res, rej); }
        return Promise.resolve({ data: db[t].filter((r) => st.f.every((f) => f(r))), error: null }).then(res, rej);
      },
    };
    return b;
  } };
}
