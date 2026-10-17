// Sweat meter: live expected profit vs a "pregame" expected profit.
//
// Each game is locked at its OWN kickoff. Storage: public.root_for_pregame_probs, one row per
// (slate week, game, outcome set) holding that game's outcome probabilities (the inverse bet method fairs the
// engine already uses, incl. spread nesting and both-sides "neither").
//  - Before a game kicks off, every refresh overwrites its row with the latest pregame probabilities.
//  - After kickoff the row is never overwritten, so it holds the last pregame value.
//  - A game that had already started when first seen (e.g. a lock added mid-game, or a new outcome set
//    because a lock added the other side) is saved once with its probabilities at that moment.
// Baseline = expected profit with started games at their frozen pregame probabilities and unstarted games at
// current ones, so the needle only moves for games that have started. Expected profit is linear, so it's
// computed exactly per lock: P(lock hits) multiplies each game's chance over the outcomes the lock allows
// (same-game legs intersected), matching the joint engine's expected profit.

const ET = "America/New_York";
export function slateKey(nowMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const back = (wd - 2 + 7) % 7; // days since Tuesday
  const d = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day - back));
  return d.toISOString().slice(0, 10);
}

export const outcomeSig = (dist) => Object.keys(dist || {}).sort().join("|");

// Exact expected profit for positions under per-game outcome probabilities.
export function expectedProfit(positions = [], probs = {}) {
  let ev = 0;
  for (const p of positions) {
    const by = {};
    for (const l of p.legs) by[l.event] = by[l.event] ? by[l.event].filter((o) => l.allowed.includes(o)) : [...l.allowed];
    let P = 1;
    for (const [e, al] of Object.entries(by)) { const dist = probs[e]; if (!dist) { P = NaN; break; } P *= al.reduce((a, o) => a + (dist[o] || 0), 0); }
    if (Number.isFinite(P)) ev += P * p.hit + (1 - P) * p.miss;
  }
  return ev;
}

// rows: stored [{ event, sig, probs }] for this week. starts: { event: ISO }.
// Returns { baseline, started: [events], overwrite: rows (pregame), insertOnce: rows (started, unseen) }.
export function pregameBaseline({ model, starts = {}, now, key, rows = [] }) {
  const stored = new Map(rows.map((r) => [`${r.event}#${r.sig}`, r]));
  const probs = {}; const started = []; const overwrite = []; const insertOnce = [];
  for (const [ev, dist] of Object.entries((model && model.probs) || {})) {
    const t = starts[ev] ? Date.parse(starts[ev]) : NaN; const sig = outcomeSig(dist);
    const row = { slate_key: key, event: ev, sig, probs: dist, kickoff: Number.isFinite(t) ? new Date(t).toISOString() : null, captured_at: new Date(now).toISOString() };
    if (!Number.isFinite(t) || now < t) { probs[ev] = dist; if (Number.isFinite(t)) overwrite.push(row); continue; }
    started.push(ev);
    const have = stored.get(`${ev}#${sig}`);
    if (have && have.probs) probs[ev] = have.probs; else { probs[ev] = dist; insertOnce.push(row); }
  }
  return { baseline: expectedProfit((model && model.positions) || [], probs), started, overwrite, insertOnce };
}

// Map a value onto the gauge: left half = worst case → baseline, right half = baseline → upper bound.
export function gaugeFrac(v, lo, base, hi) {
  if (!Number.isFinite(v)) return 0.5;
  if (v <= base) return base > lo ? 0.5 * Math.max(0, (v - lo) / (base - lo)) : 0.5;
  return hi > base ? 0.5 + 0.5 * Math.min(1, (v - base) / (hi - base)) : 0.5;
}
