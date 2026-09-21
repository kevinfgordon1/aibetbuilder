'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  UNDERDOG_PREDICT_UDX_FEE_RATE,
  UNDERDOG_PREDICT_FEE_PER_CONTRACT,
  underdogPredictFeePerContract,
  applyUnderdogPredictFee,
  underdogCashOfferAmerican,
  applyUnderdogCashLegPrices,
  stampUnderdogPredictionLegs,
} = require('./underdog-predict-fee');

assert.equal(UNDERDOG_PREDICT_UDX_FEE_RATE, 0.072);
assert.equal(UNDERDOG_PREDICT_FEE_PER_CONTRACT, 0.02, 'deprecated flat constant kept for migration notes');
assert.equal(applyUnderdogPredictFee(null), null);
assert.equal(applyUnderdogPredictFee(undefined), undefined);
assert.equal(underdogPredictFeePerContract(0), 0);
assert.equal(underdogPredictFeePerContract(1), 0);
assert.equal(underdogPredictFeePerContract(-0.2), 0);
assert.equal(underdogPredictFeePerContract(1.4), 0);

// Published UDX examples (maker = taker). 10@$0.20 is 0.1152 before ticket rounding.
{
  const fee50 = 10 * underdogPredictFeePerContract(0.50);
  assert.ok(Math.abs(fee50 - 0.18) < 1e-12, `10@$0.50 fee ${fee50}`);
  const fee20 = 10 * underdogPredictFeePerContract(0.20);
  assert.ok(Math.abs(fee20 - 0.12) < 0.005, `10@$0.20 fee ${fee20} ≈ $0.12`);
  assert.ok(Math.abs(fee20 - 0.1152) < 1e-12, `10@$0.20 closed form ${fee20}`);
}

// +100 (p=0.50) + 0.072·0.50·0.50 = 0.518 → −107. Not flat $0.02 (−108) or ProphetX (−102).
assert.equal(applyUnderdogPredictFee(100), -107);
assert.notEqual(applyUnderdogPredictFee(100), -108);
assert.notEqual(applyUnderdogPredictFee(100), -102);

// +150 (p=0.40) → 0.41728 → +140
assert.equal(applyUnderdogPredictFee(150), 140);

// −110 (p≈0.5238) → −118
assert.equal(applyUnderdogPredictFee(-110), -118);

// Purdue-style long shot: raw ~+525 / 6.25. Flat $0.02 was +456; 0.072 curve is +489.
// Kevin's $56.16 print on ~6,292 contracts implies ~+496 on $1,000 + fee outlay.
{
  const feeTrue = applyUnderdogPredictFee(525);
  assert.equal(feeTrue, 489);
  assert.notEqual(feeTrue, 456, 'flat $0.02/contract haircut is gone');
  assert.ok(feeTrue >= 485 && feeTrue <= 510, `0.072 curve on +525 should be ~+489, got ${feeTrue}`);
}

// Giants-style ~+266 raw: flat $0.02 was +241; curve is milder (+248).
{
  const feeTrue = applyUnderdogPredictFee(266);
  assert.equal(feeTrue, 248);
  assert.ok(feeTrue > 241, `Giants-style fee-true ${feeTrue} should be milder than old +241`);
  assert.ok(feeTrue < 266);
}

// Purdue slip dollars: N≈6292, p≈0.1589. Curve (~$60.55) is nearer $56.16 than flat $126.
{
  const n = 6292.26;
  const p = 0.1589;
  const curve = n * underdogPredictFeePerContract(p);
  const flat = n * UNDERDOG_PREDICT_FEE_PER_CONTRACT;
  assert.ok(Math.abs(curve - 56.16) < Math.abs(flat - 56.16), `curve ${curve} vs flat ${flat} vs ticket $56.16`);
  assert.ok(curve > 50 && curve < 65, `Purdue curve fee ${curve}`);
}

const shared = fs.readFileSync(path.join(__dirname, 'odds-shared.js'), 'utf8');
assert.equal(applyUnderdogPredictFee(1.12), applyUnderdogPredictFee(-833));
assert.equal(applyUnderdogPredictFee(2.87), applyUnderdogPredictFee(187));
assert.equal(applyUnderdogPredictFee(2), applyUnderdogPredictFee(100));
assert.equal(applyUnderdogPredictFee(87.28), null);
assert.equal(applyUnderdogPredictFee(1), null);
assert.notEqual(applyUnderdogPredictFee(1.12), 8628);
assert.notEqual(applyUnderdogPredictFee(2), -5387, 'decimal 2.00 is even money, not American +2 → −5387');

assert.match(shared, /applyUnderdogPredictFee/);
assert.match(shared, /underdog_predict/);
assert.match(shared, /UDX|sticker/);
assert.doesNotMatch(shared, /adjustFn = applyUnderdogPredictFee/);
assert.equal(applyUnderdogPredictFee(331), 308, 'legacy UDX-on-sticker is +308; Promo must not use this');

// Promo Underdog is prediction-only. +252 sticker must not become +244.
{
  const feeSrc = fs.readFileSync(path.join(__dirname, 'underdog-predict-fee.js'), 'utf8');
  assert.doesNotMatch(feeSrc, /UNDERDOG_PREDICT_CASH_FEE_RATE/);
  assert.doesNotMatch(feeSrc, /underdogPredictCashAmerican/);
  assert.equal(underdogCashOfferAmerican('underdog_predict', 252, true, 245), 245);
  assert.equal(underdogCashOfferAmerican('underdog_predict', 252, false, '+245'), 245);
  assert.equal(underdogCashOfferAmerican('underdog_predict', 252, true, null), null);
  assert.equal(underdogCashOfferAmerican('underdog_predict', 252, false, null), null);
  assert.equal(underdogCashOfferAmerican('draftkings', 240, true, null), 240);
  const missing = applyUnderdogCashLegPrices([
    { bookKey: 'underdog_predict', dk: 252 },
    { bookKey: 'draftkings', dk: 240 },
  ], true);
  assert.equal(missing.find((l) => l.bookKey === 'underdog_predict'), undefined);
  assert.equal(missing.find((l) => l.bookKey === 'draftkings').dk, 240);
  assert.equal(applyUnderdogCashLegPrices([{ bookKey: 'underdog_predict', dk: 252 }], false).length, 0);
  const phone = applyUnderdogCashLegPrices([
    { bookKey: 'underdog_predict', dk: 252, predictionAmerican: 245 },
    { bookKey: 'underdog_predict', dk: 252, predictionAmerican: '+245' },
  ], false);
  assert.equal(phone[0].dk, 245);
  assert.equal(phone[1].dk, 245);
  assert.notEqual(phone[0].dk, 252);
  assert.notEqual(phone[0].dk, 244);
  const stamped = stampUnderdogPredictionLegs([
    { bookKey: 'underdog_predict', dk: 252, name: 'New York Giants ML', game: 'New York Giants @ Los Angeles Rams' },
    { bookKey: 'underdog_predict', dk: -256, name: 'Los Angeles Rams ML', game: 'New York Giants @ Los Angeles Rams' },
    { bookKey: 'draftkings', dk: 240, name: 'New York Giants ML', game: 'New York Giants @ Los Angeles Rams' },
  ], {
    moneylines: [{
      away: 'New York Giants',
      home: 'Los Angeles Rams',
      bookOdds: { underdog_predict: { ml_away_prediction: 245, ml_away_probability: 0.27 } },
    }],
  });
  assert.equal(stamped[0].predictionAmerican, 245);
  assert.equal(stamped[0].contractProbability, 0.27);
  assert.equal(stamped[1].predictionAmerican, undefined);
  assert.equal(stamped[2].predictionAmerican, undefined);
  const priced = applyUnderdogCashLegPrices(stamped, true);
  assert.equal(priced.find((l) => l.bookKey === 'underdog_predict' && /Giants/.test(l.name)).dk, 245);
  assert.equal(priced.find((l) => /Rams/.test(l.name)), undefined);
  assert.equal(priced.find((l) => l.bookKey === 'draftkings').dk, 240);
}
const esm = fs.readFileSync(path.join(__dirname, '../src/underdogPredictFee.js'), 'utf8');
assert.match(esm, /UNDERDOG_PREDICT_UDX_FEE_RATE = 0\.072/);
assert.match(esm, /underdogPredictFeePerContract/);
assert.match(esm, /p \+ underdogPredictFeePerContract/);
assert.doesNotMatch(esm, /p \+ UNDERDOG_PREDICT_FEE_PER_CONTRACT/);
assert.doesNotMatch(esm, /UNDERDOG_PREDICT_CASH_FEE_RATE/);
assert.doesNotMatch(esm, /underdogPredictCashAmerican/);

console.log('underdog-predict-fee.test.js ok');
