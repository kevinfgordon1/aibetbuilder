import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  UNDERDOG_PREDICT_UDX_FEE_RATE,
  UNDERDOG_PREDICT_FEE_PER_CONTRACT,
  underdogPredictFeePerContract,
  applyUnderdogPredictFee,
  underdogCashOfferAmerican,
  applyUnderdogCashLegPrices,
} from "./underdogPredictFee.js";

const require = createRequire(import.meta.url);
const cjs = require("../lib/underdog-predict-fee.js");

assert.equal(UNDERDOG_PREDICT_UDX_FEE_RATE, 0.072);
assert.equal(UNDERDOG_PREDICT_UDX_FEE_RATE, cjs.UNDERDOG_PREDICT_UDX_FEE_RATE);
assert.equal(UNDERDOG_PREDICT_FEE_PER_CONTRACT, 0.02);
assert.equal(applyUnderdogPredictFee(100), -107);
assert.equal(applyUnderdogPredictFee(525), 489);
assert.equal(applyUnderdogPredictFee(266), 248);
assert.equal(applyUnderdogPredictFee(331), 308);
assert.ok(Math.abs(10 * underdogPredictFeePerContract(0.50) - 0.18) < 1e-12);
assert.ok(Math.abs(10 * underdogPredictFeePerContract(0.20) - 0.12) < 0.005);

for (const raw of [100, 150, -110, 266, 331, 525, 529, 1.12, 2.87, 87.28, 2]) {
  assert.equal(
    applyUnderdogPredictFee(raw),
    cjs.applyUnderdogPredictFee(raw),
    `CJS/ESM mismatch on ${raw}`,
  );
}

assert.equal(applyUnderdogPredictFee(1.12), applyUnderdogPredictFee(-833));
assert.equal(applyUnderdogPredictFee(2.87), applyUnderdogPredictFee(187));
assert.equal(applyUnderdogPredictFee(2), applyUnderdogPredictFee(100));
assert.equal(applyUnderdogPredictFee(87.28), null);
assert.equal(applyUnderdogPredictFee(1), null);
assert.notEqual(applyUnderdogPredictFee(1.12), 8628);
assert.notEqual(applyUnderdogPredictFee(2), -5387);

assert.equal(underdogCashOfferAmerican("underdog_predict", 252, true, 245), 245);
assert.equal(underdogCashOfferAmerican("underdog_predict", 252, false, "+245"), cjs.underdogCashOfferAmerican("underdog_predict", 252, false, "+245"));
assert.equal(underdogCashOfferAmerican("underdog_predict", 252, true, null), null);
assert.equal(cjs.underdogCashOfferAmerican("underdog_predict", 252, true, null), null);
assert.equal(applyUnderdogCashLegPrices([{ bookKey: "underdog_predict", dk: 252 }], true).length, 0);
assert.equal(cjs.applyUnderdogCashLegPrices([{ bookKey: "underdog_predict", dk: 252 }], false).length, 0);
assert.equal(applyUnderdogCashLegPrices([{ bookKey: "underdog_predict", dk: 252, predictionAmerican: "+245" }], false)[0].dk, 245);
assert.equal(cjs.applyUnderdogCashLegPrices([{ bookKey: "underdog_predict", dk: 252, predictionAmerican: "+245" }], true)[0].dk, 245);
assert.notEqual(applyUnderdogCashLegPrices([{ bookKey: "underdog_predict", dk: 252, predictionAmerican: 245 }], true)[0].dk, 244);
assert.notEqual(applyUnderdogCashLegPrices([{ bookKey: "underdog_predict", dk: 252, predictionAmerican: 245 }], true)[0].dk, 252);

console.log("underdogPredictFee.test.js ok");
