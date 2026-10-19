// Shared settlement planner (page + auto-settle job).
import assert from "node:assert/strict";
import { planSettlementPatches, browserGetJson } from "./comboAutoSettle.js";

const now = () => Date.parse("2026-10-19T05:00:00Z");
const calls = [];
const getJson = async (url) => {
  calls.push(url);
  if (url.includes("KXMVE-A")) return { markets: { "KXMVE-A": { ticker: "KXMVE-A", status: "finalized", result: "no" } } };
  return { markets: {}, games: [] };
};
// Idle: nothing to do, no network.
let r = await planSettlementPatches({ living: [], archived: [{ id: "s", kalshi_result: "yes", legs: [] }] }, { getJson, now });
assert.equal(r.idle, true); assert.equal(calls.length, 0);
// Archived lock with a combo ticker: official Kalshi result stamped.
r = await planSettlementPatches({ living: [], archived: [{ id: "a", combo_ticker: "KXMVE-A", kalshi_result: null, legs: [{ ticker: "X-1" }, { ticker: "X-2" }] }], fills: [], outcomes: [], matchesByParlay: {}, submissions: [], filledById: {} }, { getJson, now });
assert.equal(r.rowPatch.a.kalshi_result, "no");
assert.equal(r.rowPatch.a.kalshi_status, "finalized");
assert.equal(r.rowPatch.a.settled_at, "2026-10-19T05:00:00.000Z");
assert.deepEqual(r.livePatch.a, { result: "no", status: "finalized", ticker: "KXMVE-A" });
// Living unfilled lock is NOT a Kalshi candidate (same rule as before).
calls.length = 0;
r = await planSettlementPatches({ living: [{ id: "l", combo_ticker: "KXMVE-A", kalshi_result: null, legs: [] }], archived: [], filledById: {} }, { getJson, now });
assert.equal(r.rowPatch.l, undefined);
// Not-ok responses are ignored.
const g = browserGetJson(async () => ({ ok: false, json: async () => ({ markets: { x: 1 } }) }));
assert.equal(await g("/api/kalshi-games?tickers=x"), null);
console.log("comboAutoSettle tests passed");
