// Unpriced locks in a saved day: kept for Actual P/L, never in the EV numbers (Kevin, Nov 1 2026: Oct 31 missed the
// $55 ASU–BYU 17-pt spread + Virginia boost, so Actual showed −$2,261.21 instead of −$2,316.21).
import assert from "node:assert/strict";
import { addUnpriced, touchesDay, unpricedEvents, unpricedDecided } from "./rootForDayUnpriced.js";
import { dayValue, lockDecided } from "./rootForSweat.js";
import { computeRootFor } from "./rootForCompute.js";

// computeRootFor: an unpriced lock keeps its engine legs (spread buckets included) and its first kickoff
const byu = { id: "be13", label: "BYU -17 + Virginia", parlay_stake: 55, parlay_american: 1310, is_free_bet: false, starts_at: "2026-10-31T19:30:00Z",
  legs: [{ ticker: "KXNCAAFSPREAD-26OCT31ASUBYU-BYU17", side: "yes", label: "BYU -17" }, { ticker: "KXNCAAFGAME-26OCT30UVAWAKE-UVA", side: "yes", label: "Virginia" }] };
const out = computeRootFor({ parlays: [byu], fills: [], singles: [], kalshiBooks: {}, relay: {}, now: Date.parse("2026-10-31T20:00:00Z"), finals: {} });
assert.equal(out.unpriced.length, 1);
const u = out.unpriced[0];
assert.equal(u.start, "2026-10-31T19:30:00Z"); assert.equal(u.miss, -55);
const sp = u.legs.find((l) => l.event === "KXNCAAFGAME-26OCT31ASUBYU");
assert.ok(sp && sp.allowed.includes("BYU>=17") && sp.outcomes.includes("ASU"), "spread leg resolved into buckets");
assert.equal(out.model.positions.length, 0, "unpriced lock stays out of the model");

// touchesDay: first kickoff on the sheet day (ET), or a leg in one of the day's games
assert.equal(touchesDay(u, "2026-10-31"), true);
assert.equal(touchesDay(u, "2026-11-01"), false);
assert.equal(touchesDay({ ...u, start: "2026-10-30T23:00:00Z" }, "2026-10-31", new Set(["KXNCAAFGAME-26OCT30UVAWAKE"])), true);
assert.equal(touchesDay({ ...u, start: "2026-10-30T23:00:00Z" }, "2026-10-31"), false);
assert.equal(touchesDay({ ...u, start: "2026-11-01T03:30:00Z" }, "2026-10-31"), true, "after-midnight kickoff counts to the night before");

// addUnpriced: day's locks only, priced ones never duplicated, single hedges follow their lock
const priced = { id: "p1", legs: [{ event: "KXNBAGAME-26OCT31PORUTA", allowed: ["UTA"], outcomes: ["POR", "UTA"] }], hit: 900, miss: -100 };
const snap = { positions: { p1: priced }, last: { "KXNBAGAME-26OCT31PORUTA": { POR: 1, UTA: 0 } }, frozen: {} };
addUnpriced(snap, [
  u,
  { ...u, id: "be13:o1", label: "single", hit: 5, miss: -3 },
  { ...u, id: "other", start: "2026-11-02T18:00:00Z" },
  { ...u, id: "p1" },
  { id: "nolegs", hit: 1, miss: -1 },
], "2026-10-31");
assert.deepEqual(Object.keys(snap.unpriced).sort(), ["be13", "be13:o1"]);
assert.deepEqual(Object.keys(snap.positions), ["p1"]);
// idempotent; a lock that later gets priced leaves snap.unpriced
addUnpriced(snap, [u], "2026-10-31"); assert.equal(Object.keys(snap.unpriced).length, 2);
const s2 = JSON.parse(JSON.stringify(snap)); s2.positions.be13 = { id: "be13", legs: u.legs, hit: 1, miss: -55 }; addUnpriced(s2, [], "2026-10-31");
assert.equal(s2.unpriced, undefined);

// finals for unpriced legs are resolvable; Actual = priced + unpriced once decided
const evs = unpricedEvents(snap);
assert.deepEqual(Object.keys(evs["KXNCAAFGAME-26OCT31ASUBYU"]).sort(), ["ASU", "BYU<17", "BYU>=17"]);
assert.equal(unpricedDecided(snap), false);
snap.final = { "KXNBAGAME-26OCT31PORUTA": { POR: 1, UTA: 0 }, "KXNCAAFGAME-26OCT30UVAWAKE": { UVA: 0, WAKE: 1 } };
assert.equal(unpricedDecided(snap), true, "Virginia lost → decided");
const unp = Object.values(snap.unpriced).filter((p) => lockDecided(p, snap.final));
const actual = dayValue(Object.values(snap.positions), snap.final, snap.final) + dayValue(unp, snap.final, snap.final);
assert.equal(actual, -100 + -55 + -3);
// Oct 31 numbers: priced locks −2,261.21 + the $55 unpriced boost = −2,316.21
assert.equal(Math.round((-2261.21 - 55) * 100) / 100, -2316.21);
console.log("rootForDayUnpriced ok");
