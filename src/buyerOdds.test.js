import assert from "node:assert/strict";
import { quotedYesPrice, buyerSeesAfterFees, buyerSeesFromNoPrice, sellerKeeps, buyerSeesLabel, youKeepLabel, makerRateFromSeries, seriesOfTicker, setSeriesFee, makerRateForTicker, loadSeriesFees, FALLBACK_MAKER_RATE } from "./buyerOdds.js";

assert.equal(makerRateFromSeries("quadratic", 1), 0);
assert.equal(makerRateFromSeries("quadratic_with_maker_fees", 1), 0.0175);
assert.equal(makerRateFromSeries("quadratic_with_combo_maker_fees", 1), 0.035);
assert.equal(makerRateFromSeries("mystery", 1), FALLBACK_MAKER_RATE);
const KENNY = "KXMVECROSSCATEGORY0-S2026A0E24EEACD4-D44B4A1E301";
assert.equal(seriesOfTicker(KENNY), "KXMVECROSSCATEGORY0");
// Not loaded yet → conservative 0.035.
assert.equal(makerRateForTicker(KENNY), 0.035);
await loadSeriesFees([KENNY, "KXMVECROSSCATEGORY-A-B"], async (u) => {
  assert.match(u, /^\/api\/kalshi-series-fee\?series=KXMVECROSSCATEGORY0%2CKXMVECROSSCATEGORY$/);
  return { ok: true, json: async () => ({ series: { KXMVECROSSCATEGORY0: { fee_type: "quadratic", fee_multiplier: 1 }, KXMVECROSSCATEGORY: { fee_type: "quadratic_with_combo_maker_fees", fee_multiplier: 1 } } }) };
});
assert.equal(makerRateForTicker(KENNY), 0);

// Kenny's lock 799f71e3: fill_american 1188 on KXMVECROSSCATEGORY0 (no maker fee) → YES 7.8¢, buyer +1104.
assert.equal(quotedYesPrice(1188, { ticker: KENNY }), 0.078);
const b = buyerSeesAfterFees(1188, { ticker: KENNY });
assert.equal(b.text, "+1104");
assert.equal(buyerSeesLabel(b), "Buyer sees +1104 after fees");
// Old fixed 0.0175 gave 7.9¢ / +1089; combo-maker series (0.035) quotes further out.
assert.equal(quotedYesPrice(1188, { makerRate: 0.0175 }), 0.079);
assert.equal(buyerSeesAfterFees(1188, { makerRate: 0.0175 }).text, "+1089");
assert.ok(quotedYesPrice(1188, { ticker: "KXMVECROSSCATEGORY-A-B" }) > 0.079);
assert.equal(youKeepLabel(sellerKeeps(1188, { feeRate: 0.01 })), "You keep +1200");
assert.equal(sellerKeeps(1188).text, "+1188");
// Same price from the NO bid on a quote row.
assert.equal(buyerSeesFromNoPrice(0.921).text, "+1089");
// Penny grid fallback.
assert.equal(quotedYesPrice(1188, { subcent: false, makerRate: 0.0175 }), 0.08);
// Polymarket: no maker fee, only the taker schedule.
assert.equal(buyerSeesAfterFees(300, { venue: "polymarket_us" }).text, "+280");
// Favorites and junk.
assert.ok(buyerSeesAfterFees(-150).american < -150);
assert.equal(buyerSeesAfterFees(null), null);
assert.equal(buyerSeesAfterFees(50), null);
assert.equal(buyerSeesFromNoPrice(1), null);
console.log("buyerOdds.test.js ok");
