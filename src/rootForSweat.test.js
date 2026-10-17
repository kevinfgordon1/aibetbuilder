import assert from "node:assert/strict";
import { slateKey, expectedProfit, pregameBaseline, gaugeFrac, outcomeSig, liveLegMoves, finishedCarry } from "./rootForSweat.js";
assert.equal(slateKey(Date.parse("2026-10-16T23:00:00Z")), "2026-10-13");
assert.equal(slateKey(Date.parse("2026-10-20T02:00:00Z")), "2026-10-13");
assert.equal(slateKey(Date.parse("2026-10-20T16:00:00Z")), "2026-10-20");
// two games; one lock needs A in G1 and X in G2
const positions = [{ legs: [{ event: "G1", allowed: ["A"] }, { event: "G2", allowed: ["X"] }], hit: 100, miss: -10 }];
const pre = { G1: { A: 0.5, B: 0.5 }, G2: { X: 0.5, Y: 0.5 } };
assert.equal(expectedProfit(positions, pre), 0.25 * 100 + 0.75 * -10);
const starts = { G1: "2026-10-18T17:00:00Z", G2: "2026-10-18T20:00:00Z" }; const t1 = Date.parse(starts.G1);
// before any kickoff: everything overwritten, baseline == live
let r = pregameBaseline({ model: { positions, probs: pre }, starts, now: t1 - 1, key: "w", rows: [] });
assert.equal(r.overwrite.length, 2); assert.equal(r.started.length, 0); assert.equal(r.baseline, expectedProfit(positions, pre));
const rows = r.overwrite;
// G1 in progress (A now 0.9) and G2 price drifted pregame (X 0.6): only G1 is frozen
const live = { G1: { A: 0.9, B: 0.1 }, G2: { X: 0.6, Y: 0.4 } };
r = pregameBaseline({ model: { positions, probs: live }, starts, now: t1 + 1, key: "w", rows });
assert.deepEqual(r.started, ["G1"]); assert.equal(r.overwrite.length, 1);
assert.equal(r.baseline, expectedProfit(positions, { G1: pre.G1, G2: live.G2 }));
// a game first seen after kickoff is saved once at its current value
r = pregameBaseline({ model: { positions, probs: live }, starts, now: t1 + 1, key: "w", rows: [] });
assert.equal(r.insertOnce.length, 1); assert.equal(r.baseline, expectedProfit(positions, live));
assert.equal(outcomeSig({ b: 1, a: 2 }), "a|b");
assert.equal(gaugeFrac(2600, -4000, 2600, 15000), 0.5);
assert.equal(gaugeFrac(-4000, -4000, 2600, 15000), 0);
assert.equal(gaugeFrac(99999, -4000, 2600, 15000), 1);
// live leg chart: shares add up exactly to now − pregame; decided games go to `settled`
{
  const ps = [{ legs: [{ event: "A", allowed: ["a"] }, { event: "B", allowed: ["b"] }], hit: 1000, miss: -100 }, { legs: [{ event: "B", allowed: ["b"] }, { event: "C", allowed: ["c"] }], hit: 500, miss: -80 }];
  const live = { A: { a: 0.7, x: 0.3 }, B: { b: 0.3, y: 0.7 }, C: { c: 0.99, z: 0.01 } };
  const fz = { A: { a: 0.5, x: 0.5 }, B: { b: 0.45, y: 0.55 }, C: { c: 0.6, z: 0.4 } };
  const r = liveLegMoves(ps, live, fz, {});
  const want = expectedProfit(ps, live) - expectedProfit(ps, fz);
  assert.ok(Math.abs(r.total - want) < 1e-9);
  assert.ok(Math.abs(r.legs.reduce((a, l) => a + l.move, 0) + r.settled - want) < 1e-9);
  assert.deepEqual(r.legs.map((l) => l.event), ["B", "A"]);
  assert.equal(liveLegMoves(ps, live, {}, {}).legs.length, 0);
}
// All view: finished games kept at last live chances for 12h after they end, then forgotten
{
  const H = 3600 * 1000; const now = Date.parse("2026-10-18T23:00:00Z");
  const L1 = { id: "L1", legs: [{ event: "F", allowed: ["f"] }, { event: "G", allowed: ["g"] }], hit: 1000, miss: -100 }; // F finished, G live
  const L2 = { id: "L2", legs: [{ event: "G", allowed: ["g"] }], hit: 200, miss: -50 }; // still in the live model
  const L3 = { id: "L3", legs: [{ event: "OLD", allowed: ["o"] }], hit: 300, miss: -60 }; // game ended 13h ago
  const probs = { G: { g: 0.6, h: 0.4 } }; const frozen = { G: { g: 0.5, h: 0.5 } };
  const snap = { positions: { L1, L2, L3 }, last: { F: { f: 0.97, x: 0.03 }, OLD: { o: 0.99, p: 0.01 }, G: { g: 0.55, h: 0.45 } },
    lastAt: { F: new Date(now - 2 * H).toISOString(), OLD: new Date(now - 13 * H).toISOString() }, frozen: { F: { f: 0.4, x: 0.6 }, OLD: { o: 0.5, p: 0.5 }, G: frozen.G } };
  const r = finishedCarry({ positions: [L2], probs, frozen, days: [{ day: "2026-10-18", snap, updatedAt: new Date(now).toISOString() }], now });
  assert.deepEqual(r.finished, ["F"]);
  assert.deepEqual(r.kept.map((p) => p.id), ["L1"]); // L2 is live (not double counted), L3's game is forgotten
  // L1 Now: F at last live 0.97, G at current 0.6; Pregame: F at kickoff 0.4, G at kickoff 0.5
  assert.ok(Math.abs(r.nowAdd - (0.97 * 0.6 * 1000 + (1 - 0.97 * 0.6) * -100)) < 1e-9);
  assert.ok(Math.abs(r.baseAdd - (0.4 * 0.5 * 1000 + (1 - 0.4 * 0.5) * -100)) < 1e-9);
  assert.equal(r.finishedDay.F, "2026-10-18");
  // 12h later F is forgotten too: L1 leaves both Now and Pregame
  const r2 = finishedCarry({ positions: [L2], probs, frozen, days: [{ day: "2026-10-18", snap, updatedAt: new Date(now).toISOString() }], now: now + 11 * H });
  assert.equal(r2.kept.length, 0); assert.equal(r2.nowAdd, 0); assert.equal(r2.baseAdd, 0);
  // older snaps without lastAt: ended = min(row updated_at, kickoff + 4h)
  const old = { ...snap, lastAt: undefined };
  const r3 = finishedCarry({ positions: [L2], probs, frozen, days: [{ day: "2026-10-18", snap: old, updatedAt: new Date(now).toISOString() }], kickoffs: { F: new Date(now - 20 * H).toISOString() }, now });
  assert.ok(!r3.finished.includes("F")); assert.ok(r3.finished.includes("OLD")); // F kicked off 20h ago → ended ~16h ago; OLD falls back to updated_at
  // chart: kept finished game goes to the "Finished games" line and everything still sums to now − pregame
  const pos = [L2, ...r.kept]; const P = { ...r.last, ...probs }; const Fz = { ...r.frozen, ...frozen };
  const m = liveLegMoves(pos, P, Fz, {}, new Set(r.finished));
  assert.deepEqual(m.legs.map((l) => l.event), ["G"]);
  assert.ok(Math.abs(m.total - (expectedProfit(pos, P) - expectedProfit(pos, { ...P, ...Fz }))) < 1e-9);
  assert.ok(Math.abs(m.legs[0].move + m.settled - m.total) < 1e-9 && m.settled !== 0);
}
console.log("rootForSweat tests ok");
