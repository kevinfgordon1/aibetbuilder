// Saved-day leg bars reconcile to the headline (Kevin, Nov 1 2026: Oct 31 bars summed to −$2,040 vs a −$2,544
// headline because the bars started from game-level kickoff prices and skipped games with no game-level freeze).
import assert from "node:assert/strict";
import { liveLegMoves, lockedPregameEv, dayValue, RESIDUAL_EVENT } from "./rootForSweat.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
// L1 holds G1 + G2, L2 holds G2 + G3. G3 has NO game-level frozen price (only L2's own kickoff freeze).
const L1 = { id: "L1", legs: [{ event: "G1", allowed: ["A"] }, { event: "G2", allowed: ["X"] }], hit: 900, miss: -100 };
const L2 = { id: "L2", legs: [{ event: "G2", allowed: ["Y"] }, { event: "G3", allowed: ["M"] }], hit: 400, miss: -50 };
const positions = [L1, L2];
const frozen = { G1: { A: 0.4, B: 0.6 }, G2: { X: 0.5, Y: 0.5 } }; // game-level kickoff numbers
const lockPre = { // per-lock first-kickoff freezes (what the headline Pregame uses)
  L1: { pos: L1, probs: { G1: { A: 0.45, B: 0.55 }, G2: { X: 0.55, Y: 0.45 } }, adds: 0 },
  L2: { pos: L2, probs: { G2: { X: 0.52, Y: 0.48 }, G3: { M: 0.3, N: 0.7 } }, adds: 0 },
};
// final results: G1 A won, G2 Y won, G3 M won → L1 lost (miss), L2 hit
const final = { G1: { A: 1, B: 0 }, G2: { X: 0, Y: 1 }, G3: { M: 1, N: 0 } };
const probs = { ...final };
const finished = new Set(Object.keys(final));
const pre = lockedPregameEv(positions, { ...probs, ...frozen }, lockPre);
const now = dayValue(positions, probs, final);
near(now, -100 + 400, "day value");

// old (game-level) path: G3 gets no bar and the bars miss the headline
const old = liveLegMoves(positions, probs, frozen, {}, finished);
assert.ok(!old.done.some((l) => l.event === "G3"), "old path skips games with no game-level freeze");
assert.ok(Math.abs(old.settled - (now - pre)) > 1, "old path does not reconcile (the bug)");

// per-lock path: every game has a bar and finished bars add up to Now − Pregame exactly
const starts = { G1: "2026-10-31T16:00:00Z", G2: "2026-10-31T19:00:00Z", G3: "2026-10-31T23:00:00Z" };
const r = liveLegMoves(positions, probs, frozen, starts, finished, { lockPre, now, pregame: pre });
assert.deepEqual(new Set(r.done.map((l) => l.event)), new Set(["G1", "G2", "G3"]));
near(r.settled, now - pre, "bars sum to headline");
near(r.total, now - pre, "total");
near(r.done.reduce((a, l) => a + l.move, 0), now - pre, "sum of bars");
assert.ok(!r.done.some((l) => l.residual), "no residual needed when every leg has a price");

// kickoff order changes the individual bars but never the sum; no starts = alphabetical
const rev = liveLegMoves(positions, probs, frozen, { G1: starts.G3, G3: starts.G1, G2: starts.G2 }, finished, { lockPre, now, pregame: pre });
near(rev.settled, now - pre, "reordered sum");
const bar = (x, ev) => x.done.find((l) => l.event === ev).move;
assert.ok(Math.abs(bar(rev, "G2") - bar(r, "G2")) > 1e-6 || Math.abs(bar(rev, "G1") - bar(r, "G1")) > 1e-6, "order is by kickoff");

// headline Now/Pregame that the game bars can't explain (contracts added, a leg with no price) → one residual bar
const r2 = liveLegMoves(positions, probs, frozen, starts, finished, { lockPre, now: now - 55, pregame: pre + 10 });
const res = r2.done.find((l) => l.event === RESIDUAL_EVENT);
assert.ok(res && res.residual, "residual bar");
near(res.move, -65, "residual size");
near(r2.settled, now - 55 - (pre + 10), "still reconciles");

// a lock still live (G3 in play) → its bar is live, finished + live = headline
const probsLive = { G1: final.G1, G2: final.G2, G3: { M: 0.6, N: 0.4 } };
const nowLive = dayValue(positions, probsLive, { G1: final.G1, G2: final.G2 });
const r3 = liveLegMoves(positions, probsLive, frozen, starts, new Set(["G1", "G2"]), { lockPre, now: nowLive, pregame: pre });
assert.deepEqual(r3.legs.map((l) => l.event), ["G3"]);
near(r3.settled + r3.legs.reduce((a, l) => a + l.move, 0), nowLive - pre, "live + finished");
console.log("rootForDayLegs ok");
