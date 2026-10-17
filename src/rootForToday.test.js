import assert from "node:assert/strict";
import { todayEvents, touchedLocks, todayDistribution } from "./rootForToday.js";
import { expectedProfit } from "./rootForSweat.js";
const now = Date.parse("2026-10-16T22:34:00Z"); // Fri 6:34 PM ET
const ev = todayEvents([{ event: "T1", start: "2026-10-16T23:30Z" }, { event: "T2", start: "2026-10-17T03:30Z" }, { event: "S1", start: "2026-10-18T17:00Z" }], now);
assert.deepEqual([...ev].sort(), ["T1", "T2"], "11:30 PM ET Fri is still today; Sunday is not");
const model = {
  positions: [
    { id: "a", legs: [{ event: "T1", allowed: ["A"] }, { event: "S1", allowed: ["X"] }], hit: 100, miss: -10 },
    { id: "b", legs: [{ event: "S1", allowed: ["Y"] }], hit: 50, miss: -20 },
  ],
  probs: { T1: { A: 0.5, B: 0.5 }, S1: { X: 0.4, Y: 0.6 } },
};
assert.deepEqual(touchedLocks(model, new Set(["T1"])).map((p) => p.id), ["a"]);
const d = todayDistribution(model, new Set(["T1"]), { samples: 40000 });
const full = expectedProfit(model.positions, model.probs);
assert.ok(Math.abs(d.ev - full) < 1, "average after today = expected profit now");
// two possible values: T1=A → lock a at 0.4 hit; T1=B → lock a misses
const vA = 0.4 * 100 + 0.6 * -10 + (0.6 * 50 + 0.4 * -20), vB = -10 + (0.6 * 50 + 0.4 * -20);
assert.ok(Math.abs(d.worst.pnl - vB) < 1e-9 && Math.abs(d.best.pnl - vA) < 1e-9);
assert.equal(d.touched, 1);
console.log("rootForToday tests ok");
