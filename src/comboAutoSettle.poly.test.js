// Polymarket-hedged locks move to History once their legs settle (Kevin, Nov 1 2026: Cleveland + Philadelphia +
// Sacramento, hedged on a Polymarket combo "crossd-…", lost at 10:59 PM ET Oct 31 but stayed active until the
// first-kickoff + 6h auto-archive at 12:00 AM, because it waited for a Kalshi result that never comes).
import assert from "node:assert/strict";
import { planSettlementPatches, isFinalLock, isNonKalshiCombo } from "./comboAutoSettle.js";

assert.equal(isNonKalshiCombo("crossd-ab1f5c0126834dc4"), true);
assert.equal(isNonKalshiCombo("caoc-123"), true);
assert.equal(isNonKalshiCombo("KXMVECROSSCATEGORY-S2026-X"), false);
assert.equal(isNonKalshiCombo(null), false);

// filled + Polymarket combo + legs settled → final
assert.equal(isFinalLock({ combo_ticker: "crossd-1", underlying_result: "lost" }, 257.75), true);
assert.equal(isFinalLock({ combo_ticker: "caoc-1", underlying_result: "push" }, 10), true);
// filled + Kalshi combo still waits for the Kalshi combo result
assert.equal(isFinalLock({ combo_ticker: "KXMVE-Y", underlying_result: "lost" }, 10), false);
assert.equal(isFinalLock({ combo_ticker: "KXMVE-Y", underlying_result: "lost", kalshi_result: "no" }, 10), true);
// filled with no combo ticker yet: unchanged (waits)
assert.equal(isFinalLock({ combo_ticker: null, underlying_result: "lost" }, 10), false);
// legs not settled: never final
assert.equal(isFinalLock({ combo_ticker: "crossd-1", underlying_result: null }, 10), false);
// unfilled: unchanged
assert.equal(isFinalLock({ underlying_result: "won" }, 0), true);

{ // planner archives the Polymarket-hedged lock as soon as its loss is known
  const row = { id: "cle", active: true, archived_at: null, combo_ticker: "crossd-ab1f5c0126834dc4", underlying_result: "lost", underlying_source: "kalshi_legs", legs: [] };
  const { rowPatch } = await planSettlementPatches({ living: [row], archived: [], fills: [], filledById: { cle: 257.75 } }, { getJson: async () => null, now: () => Date.parse("2026-11-01T03:00:00Z") });
  assert.equal(rowPatch.cle.active, false);
  assert.equal(rowPatch.cle.archived_at, "2026-11-01T03:00:00.000Z");
}
console.log("comboAutoSettle poly tests passed");
