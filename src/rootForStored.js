// Per-leg fair prices saved for a lock (combo_lock_leg_fairs) and how "What to root for" turns them back into the
// per-event chances it freezes as each lock's pregame baseline.
// Saved values are the same inverse bet fairs the sheet computes live (rootForPrices.legFair), so a value saved
// just before kickoff is the kickoff number itself instead of a candle / earlier-snapshot estimate.
import { legFair } from "./rootForPrices.js";
import { tickersNeeded } from "./rootForCompute.js";

const NEITHER = "__neither";
/** A saved pregame value counts as the kickoff number when taken at most this long before the first kickoff. */
export const KICKOFF_MAX_AGE_MS = 15 * 60 * 1000;
/** The capture job refreshes "pregame" while a lock's first game is this close to kickoff. */
export const CAPTURE_WINDOW_MS = 20 * 60 * 1000;

/** (ticker, side) pairs to save for one lock: both moneyline sides of every game touched (yes) + each leg's own side. */
export function captureKeys(parlay) {
  const out = new Map();
  for (const t of tickersNeeded([parlay])) out.set(`${t}:yes`, { ticker: t, side: "yes" });
  for (const l of (parlay && parlay.legs) || []) {
    const t = String((l && l.ticker) || "").toUpperCase(); if (!t) continue;
    const side = String(l.side || "yes").toLowerCase() === "no" ? "no" : "yes";
    out.set(`${t}:${side}`, { ticker: t, side });
  }
  return [...out.values()];
}

/** { "TICKER:side": { p, a, v } } from live books (px = { kalshiBooks, relay, now, kalshiAt }). Unpriced legs are left out. */
export function captureFairs(parlay, px) {
  const fairs = {};
  for (const { ticker, side } of captureKeys(parlay)) {
    const f = legFair({ ticker, side }, px);
    if (f && f.p != null && f.p > 0 && f.p < 1) fairs[`${ticker}:${side}`] = { p: Math.round(f.p * 1e4) / 1e4, a: f.american, v: (f.best && typeof f.best === "object" ? f.best.venue : f.best) || null };
  }
  return fairs;
}

/** Saved fairs to use for a lock frozen at t0 (ms): 'kickoff' (pregame taken ≤15 min before t0), else 'early'
 *  (latest saved value taken before t0), else null. Values captured after t0 are never used. */
export function pickStored(rec, t0, maxAgeMs = KICKOFF_MAX_AGE_MS) {
  if (!rec || !Number.isFinite(t0)) return null;
  const snaps = [["pregame", rec.pregame, rec.pregame_at], ["at_lock", rec.at_lock, rec.at_lock_at]]
    .map(([k, fairs, at]) => ({ k, fairs, at: Date.parse(at) }))
    .filter((x) => x.fairs && Object.keys(x.fairs).length && Number.isFinite(x.at) && x.at <= t0)
    .sort((a, b) => b.at - a.at);
  const best = snaps[0]; if (!best) return null;
  return { kind: t0 - best.at <= maxAgeMs ? "kickoff" : "early", fairs: best.fairs, at: new Date(best.at).toISOString(), from: best.k };
}

const pOf = (fairs, key) => { const x = fairs && fairs[key]; const p = x && Number(x.p); return p > 0 && p < 1 ? p : null; };

/** Event chances from saved fairs, in the same shape as the live distribution `dist` for event `ev`
 *  (binary {yes,no}; game {A,B[,__neither]}; spread-nested game {S>=k, S<k, O[,__neither]}). `held` = outcomes
 *  any position holds alone on this event (same one-side / both-sides rule as computeRootFor). null if not priced. */
export function storedEventProbs(ev, dist, fairs, held = new Set()) {
  const keys = Object.keys(dist || {}); const outs = keys.filter((o) => o !== NEITHER);
  if (!outs.length || !fairs) return null;
  if (outs.length === 2 && outs.includes("yes") && outs.includes("no")) {
    const py = pOf(fairs, `${ev}:yes`), pn = pOf(fairs, `${ev}:no`);
    if (held.has("no") && !held.has("yes") && pn != null) return { yes: 1 - pn, no: pn };
    if (py != null) return { yes: py, no: 1 - py };
    if (pn != null) return { yes: 1 - pn, no: pn };
    return null;
  }
  const bucket = outs.map((o) => /^([A-Z]+)(>=|<)(\d+)$/.exec(o)).filter(Boolean);
  const teamsOf = () => {
    if (!bucket.length) return outs.length === 2 ? outs : null;
    const S = bucket[0][1]; const O = outs.find((o) => !/[<>=]/.test(o)); return O ? [S, O] : null;
  };
  const teams = teamsOf(); if (!teams) return null;
  const [a, b] = teams; const ra = pOf(fairs, `${ev}-${a}:yes`), rb = pOf(fairs, `${ev}-${b}:yes`);
  let pa, pb, pn = 0;
  if (held.has(a) && held.has(b) && ra != null && rb != null) { const z = ra + rb; if (z > 1) { pa = ra / z; pb = rb / z; } else { pa = ra; pb = rb; pn = 1 - z; } }
  else if (held.has(b) && !held.has(a) && rb != null) { pb = rb; pa = 1 - rb; }
  else if (ra != null) { pa = ra; pb = 1 - ra; }
  else if (rb != null) { pb = rb; pa = 1 - rb; }
  else return null;
  const withN = (o) => (pn > 0 || keys.includes(NEITHER) ? { ...o, [NEITHER]: pn } : o);
  if (!bucket.length) return withN({ [a]: pa, [b]: pb });
  const S = a, O = b, k = bucket[0][3];
  const spreadTicker = `${ev.replace(/GAME-/, "SPREAD-")}-${S}${k}`;
  let big = pOf(fairs, `${spreadTicker}:yes`);
  if (big == null) { const n = pOf(fairs, `${spreadTicker}:no`); if (n != null) big = pa - (n - pb); }
  if (big == null) return null;
  big = Math.min(pa, Math.max(0, big));
  return withN({ [`${S}>=${k}`]: big, [`${S}<${k}`]: pa - big, [O]: pb });
}

/** Outcomes held alone on each event across positions ([{ legs: [{ event, allowed }] }]). */
export function heldByEvent(positions) {
  const m = {};
  for (const p of positions || []) for (const l of (p && p.legs) || []) if (l && l.allowed && l.allowed.length === 1) (m[l.event] = m[l.event] || new Set()).add(l.allowed[0]);
  return m;
}
