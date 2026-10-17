import assert from "node:assert/strict";
import { slateKey, expectedProfit, pregameBaseline, gaugeFrac, outcomeSig, liveLegMoves } from "./rootForSweat.js";
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
console.log("rootForSweat tests ok");
