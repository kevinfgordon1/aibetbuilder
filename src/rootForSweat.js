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
  const legs = []; const done = []; let settled = 0;
  for (const ev of evs) {
    cur = { ...cur, [ev]: probs[ev] }; const v = expectedProfit(positions, cur); const move = v - prev; prev = v;
    // authoritative finals only (a 98% in-play price is not a final)
    if (finished.has(ev)) { settled += move; done.push({ event: ev, move }); } else legs.push({ event: ev, move });
  }
  // what-if per live leg (Kevin, Oct 25): EV with this leg settled as currently leading (1/0), every other leg at
  // current prices, minus current EV; plus the same if the runner-up wins instead ("if it flips").
  const nowEv = expectedProfit(positions, probs);
  // Spread games split a team into margin buckets ("MIN>=7"/"MIN<7"): grouped by team, the winning team's buckets
  // keep their current split (the margin is still open), the rest go to 0.
  for (const l of legs) {
    const d = probs[l.event]; const team = {};
    for (const [o, p] of Object.entries(d)) if (o !== "__neither") { const t = o.split(/[<>]=?/)[0]; team[t] = (team[t] || 0) + p; }
    const ranked = Object.entries(team).sort((a, b) => b[1] - a[1]);
    const ifWins = (t) => expectedProfit(positions, { ...probs, [l.event]: Object.fromEntries(Object.keys(d).map((k) => [k, k !== "__neither" && k.split(/[<>]=?/)[0] === t ? (team[t] > 0 ? d[k] / team[t] : 1) : 0])) }) - nowEv;
    if (ranked[0]) { l.leader = ranked[0][0]; l.ifFinal = ifWins(ranked[0][0]); }
    if (ranked[1]) { l.flip = ranked[1][0]; l.ifFlip = ifWins(ranked[1][0]); }
  }
  legs.sort((a, b) => Math.abs(b.move) - Math.abs(a.move)); done.sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
  return { legs, done, settled, total: prev - pregame };
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
  const seen = {}; const last = {}; const fz = {}; const ended = {}; const dayOf = {}; const decided = {};
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
    Object.assign(decided, sn.final || {}); // authoritative: Kalshi market settled/determined (resolveSnapFinals)
  }
  // carried = not priced right now (game over OR a momentary gap: thin in-play book, failed fetch, stale relay).
  // Being unpriced is NOT proof a game is over (Oct 25: live 1 PM NFL games showed "final" at 1:33 because one
  // request couldn't price them). Only an authoritative settled result (snap.final) makes a game "finished";
  // the rest are carried at their last live chances so EV stays continuous, and listed as stale (still live).
  const carried = Object.keys(last).filter((ev) => !probs[ev] && fz[ev] && (keep ? keep(ev, ended[ev], dayOf[ev]) : now - ended[ev] <= keepMs));
  const finished = carried.filter((ev) => decided[ev]);
  const stale = carried.filter((ev) => !decided[ev]);
  const lastP = Object.fromEntries(carried.map((ev) => [ev, decided[ev] || last[ev]]));
  const frozenFinished = Object.fromEntries(carried.map((ev) => [ev, fz[ev]]));
  const nowP = { ...lastP, ...probs };
  const preP = { ...nowP, ...frozenFinished, ...frozen };
  const ok = (p) => p.legs.every((l) => nowP[l.event] && preP[l.event]);
  const kept = Object.entries(seen).filter(([id, p]) => !live.has(id) && p && Array.isArray(p.legs) && ok(p)).map(([, p]) => p);
  return { kept, last: lastP, frozen: frozenFinished, finished, stale, finishedDay: Object.fromEntries(carried.map((ev) => [ev, dayOf[ev]])),
    endedAt: Object.fromEntries(finished.map((ev) => [ev, new Date(ended[ev]).toISOString()])), nowAdd: expectedProfit(kept, nowP), baseAdd: expectedProfit(kept, preP) };
}

// Pregame fallback when a game's outcome set changed after kickoff (e.g. one side's lock settled, so the
// "neither" outcome or a spread split appeared/disappeared): reuse the latest ON-TIME row (captured no later than
// 5 min after kickoff) for the same game, mapped onto the new outcome set. Same inverse-bet chances, only regrouped:
//  - an outcome present in both keeps its chance; a team = sum of its saved margin buckets;
//  - "neither" dropped -> the rest scaled back to 100%; "neither" added -> 0.
// A split the saved row can't provide (team -> margin buckets, or a different strike) -> null.
const NEI = "__neither";
export function adaptPregame(rows = [], ev, dist, kickoffMs) {
  const want = Object.keys(dist || {}); if (!want.length || !Number.isFinite(kickoffMs)) return null;
  const ok = rows.filter((r) => r && r.event === ev && r.probs && r.captured_at && Date.parse(r.captured_at) - kickoffMs <= 5 * 60000)
    .sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at));
  for (const r of ok) {
    const src = r.probs; const out = {}; let bad = false;
    for (const o of want) {
      if (o === NEI) { out[o] = src[NEI] || 0; continue; }
      if (o in src) { out[o] = src[o]; continue; }
      const parts = Object.keys(src).filter((k) => k !== o && k.split(/[<>]=?/)[0] === o && /[<>]/.test(k));
      if (parts.length >= 2) out[o] = parts.reduce((a, k) => a + src[k], 0); else { bad = true; break; }
    }
    if (bad) continue;
    if (!want.includes(NEI)) { const z = want.reduce((a, o) => a + out[o], 0); if (!(z > 0)) continue; for (const o of want) out[o] /= z; }
    return { ...r, sig: outcomeSig(dist), probs: out, adaptedFrom: r.sig };
  }
  return null;
}

// Day baseline with per-lock freezes (api lockBaselines): a frozen lock counts its contracts and leg chances as of
// its first kickoff (+ later adds); any other lock at preP (live pregame, so it moves baseline and Now alike).
export function lockedPregameEv(positions, preP, lockPre) {
  let sum = 0;
  for (const p of positions || []) {
    const f = lockPre && lockPre[String(p.id)];
    sum += f ? expectedProfit([f.pos], { ...preP, ...f.probs }) + Number(f.adds || 0) : expectedProfit([p], preP);
  }
  return sum;
}

// A lock is decided once any settled leg lost (it can't win any more) or every leg settled.
export function lockDecided(p, final = {}) {
  let all = true;
  for (const l of p.legs || []) { const f = final[l.event]; if (!f) { all = false; continue; } if (!(l.allowed || []).some((o) => f[o] === 1)) return true; }
  return all;
}

// Day value of one lock: settled loss → its miss, every leg won → its hit (even if a later-day leg has no price in
// the day's snapshot), else expected profit at the given chances.
export function dayLockValue(p, probs = {}, final = {}) {
  let all = true;
  for (const l of p.legs || []) { const f = final[l.event]; if (!f) { all = false; continue; } if (!(l.allowed || []).some((o) => f[o] === 1)) return Number(p.miss) || 0; }
  return all ? Number(p.hit) || 0 : expectedProfit([p], probs);
}
export const dayValue = (positions = [], probs = {}, final = {}) => positions.reduce((a, p) => a + dayLockValue(p, probs, final), 0);
