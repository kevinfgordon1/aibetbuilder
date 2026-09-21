'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  UNDERDOG_PREDICT_UDX_FEE_RATE,
  UNDERDOG_PREDICT_FEE_PER_CONTRACT,
  UNDERDOG_PREDICT_CASH_FEE_RATE,
  UNDERDOG_STICKER_KALSHI_FEE_RATE,
  underdogPredictFeePerContract,
  applyUnderdogPredictFee,
  underdogPredictCashQuote,
  underdogPredictCashAmerican,
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
assert.equal(applyUnderdogPredictFee(331), 308, 'legacy UDX-on-sticker is +308; Promo cash must not use this');

// Giants cash slip: p=0.27, r=0.1015, stake $100 → 344.82 contracts, $6.90 fee, 3.45x / +245.
// Betstamp sticker +252 / 3.52 is the Kalshi-gross (θ=0.07) and inverts to +244 (±1).
{
  assert.equal(UNDERDOG_PREDICT_CASH_FEE_RATE, 0.1015);
  assert.equal(UNDERDOG_STICKER_KALSHI_FEE_RATE, 0.07);
  const slip = underdogPredictCashQuote({ probability: 0.27, stake: 100 });
  assert.ok(Math.abs(slip.contracts - 344.82) < 0.02, `contracts ${slip.contracts}`);
  assert.ok(Math.abs(slip.fee - 6.90) < 0.02, `fee ${slip.fee}`);
  assert.ok(Math.abs(slip.decimal - 3.45) < 0.01, `decimal ${slip.decimal}`);
  assert.equal(slip.american, 245);
  assert.equal(underdogPredictCashAmerican(252, { probability: 0.27 }), 245);
  assert.equal(underdogPredictCashAmerican(3.52, { probability: 0.27 }), 245);
  const fromSticker = underdogPredictCashAmerican(252);
  assert.equal(fromSticker, underdogPredictCashAmerican(3.52));
  assert.ok(Math.abs(fromSticker - 245) <= 1, `sticker cash american ${fromSticker}`);
  assert.equal(fromSticker, 244);
  assert.notEqual(fromSticker, applyUnderdogPredictFee(252), 'do not stack legacy UDX on the sticker');
  assert.equal(underdogPredictCashAmerican(331), 321);
  assert.notEqual(underdogPredictCashAmerican(331), 308);
  const priced = applyUnderdogCashLegPrices([
    { bookKey: 'underdog_predict', dk: 252 },
    { bookKey: 'draftkings', dk: 240 },
  ], true);
  assert.equal(priced[0].dk, 244);
  assert.equal(priced[1].dk, 240);
  assert.equal(applyUnderdogCashLegPrices([{ bookKey: 'underdog_predict', dk: 252 }], false)[0].dk, 252);
  assert.equal(underdogPredictCashAmerican(252, { probability: 27 }), 245);
  const phone = applyUnderdogCashLegPrices([
    { bookKey: 'underdog_predict', dk: 252, predictionAmerican: 245 },
    { bookKey: 'underdog_predict', dk: 252, predictionAmerican: '+245' },
  ], true);
  assert.equal(phone[0].dk, 245);
  assert.equal(phone[1].dk, 245);
  assert.notEqual(phone[0].dk, underdogPredictCashAmerican(245));
  assert.equal(applyUnderdogCashLegPrices([{ bookKey: 'underdog_predict', dk: 252, predictionAmerican: 245 }], false)[0].dk, 252);
  const stamped = stampUnderdogPredictionLegs([
    { bookKey: 'underdog_predict', dk: 252, name: 'New York Giants ML', game: 'New York Giants @ Los Angeles Rams' },
    { bookKey: 'draftkings', dk: 240, name: 'New York Giants ML', game: 'New York Giants @ Los Angeles Rams' },
  ], {
    moneylines: [{
      away: 'New York Giants',
      home: 'Los Angeles Rams',
      bookOdds: { underdog_predict: { ml_away_prediction: 245, ml_away_probability: 0.27, ml_home_prediction: -313 } },
    }],
  });
  assert.equal(stamped[0].predictionAmerican, 245);
  assert.equal(stamped[0].contractProbability, 0.27);
  assert.equal(stamped[1].predictionAmerican, undefined);
  assert.equal(applyUnderdogCashLegPrices(stamped, true)[0].dk, 245);
  assert.equal(applyUnderdogCashLegPrices(stamped, true)[1].dk, 240);
}
const esm = fs.readFileSync(path.join(__dirname, '../src/underdogPredictFee.js'), 'utf8');
assert.match(esm, /UNDERDOG_PREDICT_UDX_FEE_RATE = 0\.072/);
assert.match(esm, /underdogPredictFeePerContract/);
assert.match(esm, /p \+ underdogPredictFeePerContract/);
assert.doesNotMatch(esm, /p \+ UNDERDOG_PREDICT_FEE_PER_CONTRACT/);

console.log('underdog-predict-fee.test.js ok');
