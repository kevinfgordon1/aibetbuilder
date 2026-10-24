import assert from "node:assert/strict";
import { profitAtAmerican, depthFromStake } from "./depthProfit.js";
import { formatAvailableSizeClause } from "./trueOddsLine.js";
import { walk } from "./rootForPrices.js";

// Kevin: at −200 with $3,000 bettable, depth is $1,500.
assert.equal(profitAtAmerican(3000, -200), 1500);
assert.equal(profitAtAmerican(1000, 150), 1500);
assert.equal(depthFromStake(0, -200), null);
assert.equal(depthFromStake(100, null), null);
assert.equal(formatAvailableSizeClause(3000, -200), " · $1,500 depth (to win)");
assert.equal(formatAvailableSizeClause(1250), " · $1,250 currently available", "no price → raw $ unchanged");

// rootForPrices.walk ($500 inverse-bet fair) now walks to $500 PROFIT (Novig, $0 fee).
// 0.40 asks: each contract wins 0.60 → 833.33 contracts ($333.33 stake) for $500 profit.
const w = walk([[0.40, 10000]], "novig", 500);
assert.ok(Math.abs(w.profitUsd - 500) < 1e-6 && Math.abs(w.stakeUsd - 333.333) < 0.01, JSON.stringify(w));
// favourite side 0.667 (−200): needs ~$1,000 stake for $500 profit; $600 of book fails.
assert.equal(walk([[2 / 3, 900]], "novig", 500).fail, "depth");
assert.ok(walk([[2 / 3, 1600]], "novig", 500).vwap > 0);
console.log("depthProfit ok");
