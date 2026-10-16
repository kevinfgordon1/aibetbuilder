// Sweat meter: live expected profit vs the pregame baseline for this week's slate.
//
// Baseline storage (public.root_for_baselines, one row per slate week):
//  - The slate key is the ET date of the Tuesday that starts the NFL week, so Thu–Mon games share one row.
//  - Every /api/root-for call BEFORE the slate's first kickoff overwrites the row with the latest expected
//    profit, so the baseline is the last pregame number (not a stale morning one).
//  - Once the first kickoff passes, the row is frozen and becomes "Started at".
//  - Server-side, so it is the same on every device and survives reloads; if the table is missing or no
//    pregame snapshot was taken this week, the meter says so instead of guessing.

const ET = "America/New_York";
export function slateKey(nowMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const back = (wd - 2 + 7) % 7; // days since Tuesday
  const d = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day - back));
  return d.toISOString().slice(0, 10);
}

export function firstKickoff(perEvent = []) {
  let best = null;
  for (const e of perEvent) { const t = e && e.start ? Date.parse(e.start) : NaN; if (Number.isFinite(t) && (best == null || t < best)) best = t; }
  return best;
}

// row: existing DB row or null. Returns { write: row-to-upsert|null, sweat: payload for the client }.
export function decideBaseline(row, { now, ev, kickoff, key }) {
  const k = row && row.first_kickoff ? Date.parse(row.first_kickoff) : null;
  const first = [k, kickoff].filter((x) => Number.isFinite(x)).reduce((a, b) => (a == null || b < a ? b : a), null);
  if (first != null && now < first) {
    const write = { slate_key: key, ev: Math.round(ev * 100) / 100, first_kickoff: new Date(first).toISOString(), captured_at: new Date(now).toISOString() };
    return { write, sweat: { started: false, baseline: write.ev, firstKickoff: write.first_kickoff, capturedAt: write.captured_at, now: ev } };
  }
  if (row && Number.isFinite(Number(row.ev))) return { write: null, sweat: { started: true, baseline: Number(row.ev), firstKickoff: row.first_kickoff, capturedAt: row.captured_at, now: ev } };
  return { write: null, sweat: { started: first != null && now >= first, baseline: null, firstKickoff: first != null ? new Date(first).toISOString() : null, now: ev } };
}

// Map a value onto the gauge: left half = worst case → baseline, right half = baseline → upper bound.
export function gaugeFrac(v, lo, base, hi) {
  if (!Number.isFinite(v)) return 0.5;
  if (v <= base) return base > lo ? 0.5 * Math.max(0, (v - lo) / (base - lo)) : 0.5;
  return hi > base ? 0.5 + 0.5 * Math.min(1, (v - base) / (hi - base)) : 0.5;
}
