import assert from "node:assert/strict";
import { quotedYesPrice, buyerSeesAfterFees, buyerSeesFromNoPrice, sellerKeeps, buyerSeesLabel, youKeepLabel } from "./buyerOdds.js";

// Kenny's lock 799f71e3: fill_american 1188, fees on → keeps +1200 all-in; worker logged yes_bid 0.079 no_bid 0.921.
assert.equal(quotedYesPrice(1188), 0.079);
const b = buyerSeesAfterFees(1188);
assert.equal(b.text, "+1089");
assert.equal(buyerSeesLabel(b), "Buyer sees +1089 after fees");
assert.equal(youKeepLabel(sellerKeeps(1188, { feeRate: 0.01 })), "You keep +1200");
assert.equal(sellerKeeps(1188).text, "+1188");
// Same price from the NO bid on a quote row.
assert.equal(buyerSeesFromNoPrice(0.921).text, "+1089");
// Penny grid fallback.
assert.equal(quotedYesPrice(1188, { subcent: false }), 0.08);
// Polymarket: no maker fee, only the taker schedule.
assert.equal(buyerSeesAfterFees(300, { venue: "polymarket_us" }).text, "+280");
// Favorites and junk.
assert.ok(buyerSeesAfterFees(-150).american < -150);
assert.equal(buyerSeesAfterFees(null), null);
assert.equal(buyerSeesAfterFees(50), null);
assert.equal(buyerSeesFromNoPrice(1), null);
console.log("buyerOdds.test.js ok");
