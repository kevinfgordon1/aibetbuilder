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

// Live meter leg chart: each in-play game's signed share of the needle's move from pregame.
// Telescoping in kickoff order (earlier games first): a game's share = EV with it at live chances minus EV
// just before, so the shares of every started game add up exactly to (now − pregame). Games already decided
// (some outcome ≥ 98%, or in `finished`: no longer priced, held at last live chances) are not "live"; their
// combined share comes back as `settled`.
export function liveLegMoves(positions = [], probs = {}, frozen = {}, starts = {}, finished = new Set()) {
  const held = new Set(positions.flatMap((p) => p.legs.map((l) => l.event)));
  const evs = Object.keys(frozen).filter((ev) => held.has(ev) && probs[ev] && frozen[ev])
    .sort((a, b) => (Date.parse(starts[a] || "") || 0) - (Date.parse(starts[b] || "") || 0) || a.localeCompare(b));
  let cur = { ...probs }; for (const ev of evs) cur[ev] = frozen[ev];
  const pregame = expectedProfit(positions, cur); let prev = pregame;
  const legs = []; let settled = 0;
  for (const ev of evs) {
    cur = { ...cur, [ev]: probs[ev] }; const v = expectedProfit(positions, cur); const move = v - prev; prev = v;
    if (finished.has(ev) || Math.max(...Object.values(probs[ev])) >= 0.98) settled += move; else legs.push({ event: ev, move });
  }
  legs.sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
  return { legs, settled, total: prev - pregame };
}

// All view: finished games stay counted at their LAST live chances (same as Today) for 12 hours after the game
// ended, then they're forgotten (out of Now, Pregame and "from games played").
// A game that has ended stops being priced (no book, or a side outside 1.5–98.5%), so its locks drop out of the
// live model. The daily needle rows (root_for_needle_days.snap) keep every lock seen that day, each game's last
// live chances (snap.last), the time it was last seen priced (snap.lastAt) and its kickoff chances (snap.frozen).
// days = [{ day, snap, updatedAt }]. Ended = snap.lastAt; older snaps without it fall back to
// min(row updated_at, kickoff + 4h). Later legs of a kept lock use current prices when priced (else their own
// last live chances); a kept lock with a leg priced nowhere, or a leg in a forgotten game, is left out.
export const FINISHED_KEEP_MS = 12 * 3600 * 1000;
// keep(ev, endedMs, day) picks which finished games count; default = ended within keepMs (All).
// Today & beyond passes keep = finished game belongs to today's sheet day (any age).
export function finishedCarry({ positions = [], probs = {}, frozen = {}, days = [], kickoffs = {}, now = Date.now(), keepMs = FINISHED_KEEP_MS, keep = null }) {
  const live = new Set(positions.map((p) => String(p.id)));
  const seen = {}; const last = {}; const fz = {}; const ended = {}; const dayOf = {};
  for (const r of days) {
    const sn = r && r.snap; if (!sn) continue;
    const upd = Date.parse(r.updatedAt || "") || now;
    for (const [id, p] of Object.entries(sn.positions || {})) seen[id] = p;
    for (const [ev, d] of Object.entries(sn.last || {})) {
      last[ev] = d; dayOf[ev] = String(r.day).slice(0, 10);
      const at = sn.lastAt && Date.parse(sn.lastAt[ev] || "");
      const ko = Date.parse(kickoffs[ev] || "");
      ended[ev] = Number.isFinite(at) ? at : Math.min(upd, Number.isFinite(ko) ? ko + 4 * 3600 * 1000 : upd);
    }
    Object.assign(fz, sn.frozen || {});
  }
  const finished = Object.keys(last).filter((ev) => !probs[ev] && fz[ev] && (keep ? keep(ev, ended[ev], dayOf[ev]) : now - ended[ev] <= keepMs));
  const lastP = Object.fromEntries(finished.map((ev) => [ev, last[ev]]));
  const frozenFinished = Object.fromEntries(finished.map((ev) => [ev, fz[ev]]));
  const nowP = { ...lastP, ...probs };
  const preP = { ...nowP, ...frozenFinished, ...frozen };
  const ok = (p) => p.legs.every((l) => nowP[l.event] && preP[l.event]);
  const kept = Object.entries(seen).filter(([id, p]) => !live.has(id) && p && Array.isArray(p.legs) && ok(p)).map(([, p]) => p);
  return { kept, last: lastP, frozen: frozenFinished, finished, finishedDay: Object.fromEntries(finished.map((ev) => [ev, dayOf[ev]])),
    endedAt: Object.fromEntries(finished.map((ev) => [ev, new Date(ended[ev]).toISOString()])), nowAdd: expectedProfit(kept, nowP), baseAdd: expectedProfit(kept, preP) };
}
