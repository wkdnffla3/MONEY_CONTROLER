// Supabase(PostgREST)는 한 번에 최대 1,000줄만 돌려주고 오류도 내지 않음(API 설정 "Max rows" 기본값).
// → ID 순으로 1,000줄씩 끝까지 받아 옴. build 는 매번 새 쿼리를 만드는 함수 (select·eq 까지).
// 대시보드에서 Max rows 를 1,000보다 작게 바꾸면 끝까지 못 받으니 1,000 이상으로 두세요.
export const PAGE_SIZE = 1000;
const MAX_PAGES = 500; // 50만 줄 — 무한 반복 안전장치

export async function fetchAll(build, pageSize = PAGE_SIZE) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * pageSize;
    const { data, error } = await build().order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const list = data || [];
    rows.push(...list);
    if (list.length < pageSize) break;
  }
  return { data: rows, error: null };
}
