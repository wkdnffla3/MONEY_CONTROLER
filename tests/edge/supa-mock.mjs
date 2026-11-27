export const db = { settings: [], push_subscriptions: [], transactions: [], ledger_members: [] };
export function createClient() {
  return { from(t) {
    const st = { f: [], del: false, range: null, order: null };
    const b = {
      select() { return b; }, delete() { st.del = true; return b; },
      eq(k, v) { st.f.push((r) => r[k] === v); return b; }, gte(k, v) { st.f.push((r) => r[k] >= v); return b; }, lte(k, v) { st.f.push((r) => r[k] <= v); return b; },
      order(k) { st.order = k; return b; }, range(a, z) { st.range = [a, z]; return b; },
      maybeSingle() { const rows = db[t].filter((r) => st.f.every((f) => f(r))); return Promise.resolve({ data: rows[0] || null, error: null }); },
      then(res, rej) {
        if (st.del) { db[t] = db[t].filter((r) => !st.f.every((f) => f(r))); return Promise.resolve({ error: null }).then(res, rej); }
        // 실제 Supabase처럼 한 번에 최대 1000줄 (말없이 잘림)
        let rows = db[t].filter((r) => st.f.every((f) => f(r)));
        if (st.order) rows = [...rows].sort((a, b) => String(a[st.order]).localeCompare(String(b[st.order])));
        rows = st.range ? rows.slice(st.range[0], st.range[1] + 1) : rows;
        return Promise.resolve({ data: rows.slice(0, 1000), error: null }).then(res, rej);
      },
    };
    return b;
  } };
}
