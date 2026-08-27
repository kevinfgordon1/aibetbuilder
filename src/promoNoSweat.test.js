import assert from "node:assert/strict";
import { calcNoSweatEV, DEFAULT_CREDIT_CONVERSION, DEFAULT_REFUND_PCT } from "./promoNoSweat.js";

// $100 stake, +100 (D=2), p=0.5, 100% refund, 70% conversion
// EV = 0.5×100 + 0.5×(−100+70) = 50 − 15 = +35
const even = calcNoSweatEV({
  stake: 100,
  decimal: 2,
  p: 0.5,
  refundPct: 100,
  conversionPct: 70,
});
assert.equal(even.refund, 100);
assert.equal(even.creditValue, 70);
assert.equal(even.winProfit, 100);
assert.equal(even.loseNet, -30);
assert.equal(even.ev, 35);
assert.equal(even.ev, 0.5 * 100 - 0.5 * 0.30 * 100);
assert.equal(DEFAULT_REFUND_PCT, 100);
assert.equal(DEFAULT_CREDIT_CONVERSION, 70);

// Defaults are 100% refund / 70% conversion
const defaults = calcNoSweatEV({ stake: 100, decimal: 2, p: 0.5 });
assert.equal(defaults.ev, 35);
assert.equal(defaults.creditValue, 70);

// 50% refund: R=50, V=35
// EV = 0.5×100 + 0.5×(−100+35) = 50 − 32.5 = +17.5
const halfRefund = calcNoSweatEV({
  stake: 100,
  decimal: 2,
  p: 0.5,
  refundPct: 50,
  conversionPct: 70,
});
assert.equal(halfRefund.refund, 50);
assert.equal(halfRefund.creditValue, 35);
assert.equal(halfRefund.winProfit, 100);
assert.equal(halfRefund.loseNet, -65);
assert.equal(halfRefund.ev, 17.5);

// Parlay-style combined p: two independent +100 legs at p=0.5 each.
// Combined D = 2×2 = 4, combined p = 0.5×0.5 = 0.25 (same product as boost parlays).
// Win +300, lose −30 → EV = 0.25×300 + 0.75×(−30) = 75 − 22.5 = +52.5
const parlay = calcNoSweatEV({
  stake: 100,
  decimal: 2 * 2,
  p: 0.5 * 0.5,
  refundPct: 100,
  conversionPct: 70,
});
assert.equal(parlay.winProfit, 300);
assert.equal(parlay.loseNet, -30);
assert.equal(parlay.ev, 52.5);

console.log("promoNoSweat.test.js: all passed");
