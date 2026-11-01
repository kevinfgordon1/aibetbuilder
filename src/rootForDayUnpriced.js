// Unpriced locks in a saved "What to root for" day (Kevin, Nov 1 2026: Oct 31 left out ASU–BYU 17-pt spread +
// Virginia, a $55 boost that lost, because a leg never had a usable price).
// A lock with a leg that has no price can't get an expected value, so it stays out of Pregame / Now / the bars,
// but its settled result is real money: the day row keeps it in snap.unpriced (same shape as snap.positions:
// { id, label, legs:[{ event, kind, outcomes, allowed }], hit, miss, reason }) and Actual P/L counts it once decided.
import { gameDay } from "./rootForToday.js";
import { lockDecided } from "./rootForSweat.js";

const baseId = (id) => String(id).split(":")[0];

/** Does this unpriced entry touch the sheet day? Any leg in one of the day's games, or the lock's first kickoff on
 *  that day (ET game day). */
export function touchesDay(u, day, dayEvents = new Set()) {
  if (!u || !Array.isArray(u.legs) || !u.legs.length) return false;
  if (u.legs.some((l) => l && dayEvents.has(l.event))) return true;
  const t = u.start ? Date.parse(u.start) : NaN;
  return Number.isFinite(t) && gameDay(t) === day;
}

/** Add the day's unpriced locks (computeRootFor().unpriced entries) to snap.unpriced; a lock that is (or becomes)
 *  priced lives in snap.positions only. Single-leg hedge entries ("<lock>:<order>") follow their lock. Mutates snap. */
export function addUnpriced(snap, unpriced = [], day, dayEvents = new Set(Object.keys((snap && snap.last) || {}))) {
  if (!snap) return snap;
  snap.positions = snap.positions || {}; snap.unpriced = snap.unpriced || {};
  const pricedIds = new Set(Object.keys(snap.positions).map((k) => baseId((snap.positions[k] || {}).id || k)));
  const list = (unpriced || []).filter((u) => u && u.id != null && Array.isArray(u.legs));
  const touching = new Set(list.filter((u) => !String(u.id).includes(":") && touchesDay(u, day, dayEvents)).map((u) => String(u.id)));
  for (const u of list) {
    const id = String(u.id); const lock = baseId(id);
    if (!touching.has(lock) || pricedIds.has(lock)) continue;
    snap.unpriced[id] = { id: u.id, label: u.label || null, legs: u.legs.map(({ event, kind, outcomes, allowed }) => ({ event, kind, outcomes, allowed })), hit: Number(u.hit) || 0, miss: Number(u.miss) || 0, reason: u.reason || null };
  }
  for (const id of Object.keys(snap.unpriced)) if (pricedIds.has(baseId(id))) delete snap.unpriced[id];
  if (!Object.keys(snap.unpriced).length) delete snap.unpriced;
  return snap;
}

/** Events of the unpriced locks' legs → an outcome map (values unused) for resolveFinal. */
export function unpricedEvents(snap) {
  const out = {};
  for (const p of Object.values((snap && snap.unpriced) || {})) for (const l of (p && p.legs) || []) {
    if (!l || !l.event || out[l.event]) continue;
    const outs = Array.isArray(l.outcomes) && l.outcomes.length ? l.outcomes : ["yes", "no"];
    out[l.event] = Object.fromEntries(outs.map((o) => [o, 0]));
  }
  return out;
}

/** Every unpriced lock decided (a settled leg lost, or every leg settled). */
export function unpricedDecided(snap) {
  return Object.values((snap && snap.unpriced) || {}).every((p) => lockDecided(p, (snap && snap.final) || {}));
}
