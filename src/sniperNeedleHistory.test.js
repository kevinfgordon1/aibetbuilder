import assert from "node:assert/strict";
import { sniperNeedleHistory } from "./sniperMatched.js";
const base = { dry_run: false, status: "open", filled_contracts: 100, filled_cost: 80, filled_fee: 1, fair_yes: 0.15, legs: ["KXA-26OCT23NEBUF:yes"] };
const rows = [
  { ...base, rfq_id: "a", created_at: "2026-10-22T18:00:00Z", status: "settled", phase: "settled", settled_at: "2026-10-23T01:00:00Z", realized_pnl: 19 },
  { ...base, rfq_id: "b", created_at: "2026-10-23T05:00:00Z" }, // 1 AM ET Oct 23 -> Oct 22 fill day (2 AM rollover)
  { ...base, rfq_id: "c", created_at: "2026-10-23T18:00:00Z" },
];
const h = sniperNeedleHistory(rows, Date.parse("2026-10-24T05:00:00Z"));
assert.equal(h.length, 2);
assert.equal(h[0].day, "2026-10-22"); assert.equal(h[0].locks, 2);
assert.equal(h[0].pregame_ev, 8); // 2 × (100×0.85 − 81)
assert.equal(h[0].live_ev, 23); assert.equal(h[0].result, 15); assert.equal(h[0].pnl, 19); assert.equal(h[0].open, 1); assert.equal(h[0].final, false);
assert.equal(h[1].day, "2026-10-23"); assert.equal(h[1].result, 0);
console.log("sniperNeedleHistory ok");
