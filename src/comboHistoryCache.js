// Combo Locks History load plan: what each 20s poll actually has to re-download.
//
// History = every archived lock (~600 rows, ~0.8 MB) plus per-lock quote rows read in
// .in(parlay_id) chunks (the slowest reads on the page: p95 ~8s on a busy Sunday).
// Archived locks barely change, so:
//   - archived lock rows are re-read when a lock left the living list (it moved to
//     History), on the first load, or every ARCHIVED_ROWS_TTL_MS (settlement stamps);
//   - per-lock quote rows for archived locks are read ONCE per lock: a newly archived
//     lock fetches only its own chunk instead of re-reading every archived lock, and
//     everything is refreshed every ARCHIVED_SUBS_FULL_TTL_MS.

export const ARCHIVED_ROWS_TTL_MS = 2 * 60 * 1000;
export const ARCHIVED_SUBS_FULL_TTL_MS = 30 * 60 * 1000;

// cache: { at, livingIds:Set, rows } | null. livingIds: ids of this poll's living locks
// (or null when that read failed this poll).
export function archivedRowsNeedRefetch(cache, livingIds, now = Date.now(), ttl = ARCHIVED_ROWS_TTL_MS) {
  if (!cache || !Array.isArray(cache.rows) || !cache.at) return true;
  if (now - cache.at >= ttl) return true;
  if (!livingIds) return false;
  // A lock came back from History (restored): drop it from the cached list.
  for (const r of cache.rows) if (r && livingIds.has(r.id)) return true;
  // A lock that was living last time and is gone now was archived (or deleted / merged).
  for (const id of cache.livingIds || []) if (!livingIds.has(id)) return true;
  return false;
}

// cache: { ids:Set, at, rows } — at = time of the last FULL read.
// -> { fetchIds, full }: ids whose per-lock rows must be read this poll.
export function archivedSubsPlan(cache, allIds, now = Date.now(), ttl = ARCHIVED_SUBS_FULL_TTL_MS) {
  const ids = (allIds || []).filter(Boolean);
  const full = !cache || !cache.at || !cache.ids || now - cache.at >= ttl;
  if (full) return { fetchIds: ids, full: true };
  return { fetchIds: ids.filter((id) => !cache.ids.has(id)), full: false };
}

// New cache after a read. fetched = rows returned for fetchIds; failedIds = ids whose
// chunk failed (not marked cached, so they are retried next poll; their old rows kept).
export function nextArchivedSubsCache(cache, { allIds, fetchIds, full, fetched, failedIds, now = Date.now(), merge }) {
  const all = new Set((allIds || []).filter(Boolean));
  const failed = failedIds || new Set();
  const prevRows = (cache && cache.rows) || [];
  const fetchSet = new Set(fetchIds || []);
  // Keep earlier rows for archived locks that were not re-read (or whose re-read failed).
  const kept = prevRows.filter((r) => r && all.has(r.parlay_id) && (!fetchSet.has(r.parlay_id) || failed.has(r.parlay_id)));
  const ids = new Set();
  if (!full && cache && cache.ids) for (const id of cache.ids) if (all.has(id)) ids.add(id);
  for (const id of fetchSet) if (!failed.has(id)) ids.add(id);
  const anyFailed = [...fetchSet].some((id) => failed.has(id));
  return {
    ids,
    // A failed full read stays "due" so the next poll retries everything still missing.
    at: full ? (anyFailed ? 0 : now) : (cache ? cache.at : now),
    rows: merge(fetched || [], kept),
  };
}
