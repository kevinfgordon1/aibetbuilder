// Combo Locks polls combo_fills every 20s. Re-reading the user's whole history each time was the
// biggest repeat read (audit Oct 24). Between full reads (every FULL_MS) fetch only rows recorded
// at/after the newest one we already have, and merge by id. The periodic full read picks up any
// edited/re-attributed rows.
export const FILLS_FULL_MS = 120000;

export function fillsPlan(cache, nowMs, fullMs = FILLS_FULL_MS) {
  if (!cache || !Array.isArray(cache.rows) || !cache.maxRecorded || !(nowMs - cache.fullAt < fullMs)) return { full: true, since: null };
  return { full: false, since: cache.maxRecorded };
}

const keyOf = (r) => (r && r.id != null ? `id:${r.id}` : `f:${r && r.fill_id}|${r && r.order_id}|${r && r.recorded_at}`);
const cmp = (a, b) => (String(a.recorded_at || "") < String(b.recorded_at || "") ? -1 : String(a.recorded_at || "") > String(b.recorded_at || "") ? 1 : (Number(a.id) || 0) - (Number(b.id) || 0));

export function mergeFills(prevRows, newRows) {
  const m = new Map();
  for (const r of prevRows || []) m.set(keyOf(r), r);
  for (const r of newRows || []) m.set(keyOf(r), r);
  return [...m.values()].sort(cmp);
}

export function nextFillsCache(prev, plan, rows, nowMs) {
  const merged = plan.full ? [...(rows || [])].sort(cmp) : mergeFills(prev && prev.rows, rows);
  const maxRecorded = merged.reduce((mx, r) => (r && r.recorded_at && String(r.recorded_at) > mx ? String(r.recorded_at) : mx), "");
  return { rows: merged, maxRecorded: maxRecorded || null, fullAt: plan.full ? nowMs : (prev ? prev.fullAt : nowMs) };
}
