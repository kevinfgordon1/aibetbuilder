// Read every row of a Supabase query, a page at a time, so lists and totals
// never stop at PostgREST's row cap or a hard .limit(). makeQuery() must
// return a fresh builder with a stable order (ending in a unique column).
export const COMBO_PAGE_SIZE = 1000;
export const COMBO_MAX_PAGES = 50;

export async function fetchAllRows(makeQuery, { pageSize = COMBO_PAGE_SIZE, maxPages = COMBO_MAX_PAGES } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const res = await makeQuery().range(from, from + pageSize - 1);
    if (!res || res.error) return { data: page === 0 ? null : rows, error: (res && res.error) || new Error("no response") };
    const data = Array.isArray(res.data) ? res.data : [];
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return { data: rows, error: null };
}

// Split ids so .in("parlay_id", ids) URLs stay short.
export function chunkIds(ids, size = 100) {
  const out = [];
  const list = (ids || []).filter(Boolean);
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
