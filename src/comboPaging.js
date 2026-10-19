// Read every row of a Supabase query, a page at a time, so lists and totals
// never stop at PostgREST's row cap or a hard .limit(). makeQuery() must
// return a fresh builder with a stable order (ending in a unique column).
export const COMBO_PAGE_SIZE = 1000;
export const COMBO_MAX_PAGES = 50;

// expectedRows (e.g. last poll's count): request that many pages at once instead of one
// after another; any further pages are still read in order. Same rows either way.
export async function fetchAllRows(makeQuery, { pageSize = COMBO_PAGE_SIZE, maxPages = COMBO_MAX_PAGES, expectedRows = 0 } = {}) {
  const rows = [];
  const ahead = Math.min(maxPages, Math.max(1, Math.ceil((Number(expectedRows) || 0) / pageSize) + (expectedRows > 0 && expectedRows % pageSize === 0 ? 1 : 0)));
  let start = 0;
  if (ahead > 1) {
    const res = await Promise.all(Array.from({ length: ahead }, (_, page) => makeQuery().range(page * pageSize, page * pageSize + pageSize - 1)));
    for (let page = 0; page < res.length; page += 1) {
      const r = res[page];
      if (!r || r.error) return { data: page === 0 ? null : rows, error: (r && r.error) || new Error("no response") };
      const data = Array.isArray(r.data) ? r.data : [];
      rows.push(...data);
      if (data.length < pageSize) return { data: rows, error: null };
    }
    start = ahead;
  }
  for (let page = start; page < maxPages; page += 1) {
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
