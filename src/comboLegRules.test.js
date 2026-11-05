import assert from "node:assert/strict";
import { lockLegsError, isSingleLegLock } from "./comboLegRules.js";
import { resolveComboTicker, lockResultFromMarket, singleLegOf } from "./comboSettlement.js";
import { venueRows } from "./singleLegView.js";

const wild = { ticker: "KXNHLGAME-26OCT12MINVGK-MIN", side: "yes" };
assert.equal(lockLegsError([]), "Pick at least 1 leg (game + market).");
assert.equal(lockLegsError([wild]), "");
assert.equal(lockLegsError([wild, { ...wild }]), "The same market is picked twice.");
assert.equal(lockLegsError([{ ticker: "X", side: "maybe" }]), "Every leg needs a market and a side.");
assert.equal(lockLegsError(Array.from({ length: 13 }, (_, i) => ({ ticker: "T" + i, side: "yes" }))), "A lock can have at most 12 legs.");
assert.ok(isSingleLegLock({ legs: [wild] }));
assert.ok(!isSingleLegLock({ legs: [wild, { ticker: "B", side: "yes" }] }));

// Settlement: single leg uses its own market; a NO leg flips the result.
assert.equal(resolveComboTicker({ parlay: { id: "a", legs: [wild] }, fills: [{ parlay_id: "a", ticker: "aec-nhl-min-veg-2026-10-12" }] }), wild.ticker);
assert.equal(lockResultFromMarket({ legs: [wild] }, "yes"), "yes");
assert.equal(lockResultFromMarket({ legs: [{ ...wild, side: "no" }] }, "yes"), "no");
assert.equal(lockResultFromMarket({ legs: [wild, { ticker: "B", side: "no" }] }, "yes"), "yes");
assert.equal(singleLegOf({ legs: [wild, { ticker: "B" }] }), null);

// Card rows: per-venue resting / filled.
const rows = venueRows([
  { venue: "kalshi", status: "canceled", size: 100, filled: 30, open: 0, price: 0.5, updated_at: "2026-10-12T20:00:00Z" },
  { venue: "polymarket", status: "resting", size: 70, filled: 0, open: 70, price: 0.49, updated_at: "2026-10-12T20:01:00Z" },
]);
assert.deepEqual(rows.map((r) => [r.venue, r.state, r.filled, r.resting]), [["Kalshi", "Filled 30", 30, 0], ["Polymarket", "Resting 70 @ 49¢", 0, 70]]);
assert.deepEqual(venueRows([]), []);
console.log("comboLegRules tests passed");

// Single-leg heads-up popup (shown before save, owner + testers).
import { buildSingleLegConfirm, singleLegWarningLines } from "./comboLockSubmitted.js";
{
  const c = buildSingleLegConfirm([{ ...wild, label: "Minnesota Wild ML" }], 120, { feesEnabled: true, onConfirm: () => {} });
  assert.equal(c.kind, "confirm");
  assert.equal(c.autoMs, 0);
  assert.deepEqual(c.legs, ["Minnesota Wild ML"]);
  const text = c.warnings.join(" ");
  assert.match(text, /both Kalshi and Polymarket/);
  assert.match(text, /1\.5 seconds/);
  assert.match(text, /over-hedged/);
  assert.match(text, /maker fee/);
  assert.match(text, /Polymarket charges \$0/);
  assert.match(text, /1%/);
  assert.match(singleLegWarningLines({ feesEnabled: false }).join(" "), /Our 1% fee applies only/);
  console.log("single-leg confirm tests passed");
}
