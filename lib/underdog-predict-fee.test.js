'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  UNDERDOG_PREDICT_FEE_PER_CONTRACT,
  applyUnderdogPredictFee,
} = require('./underdog-predict-fee');

assert.equal(UNDERDOG_PREDICT_FEE_PER_CONTRACT, 0.02);
assert.equal(applyUnderdogPredictFee(null), null);
assert.equal(applyUnderdogPredictFee(undefined), undefined);

// +100 (p=0.50) + $0.02 face → 0.52 → −108. Not ProphetX 2%-of-winnings (−102).
assert.equal(applyUnderdogPredictFee(100), -108);
assert.notEqual(applyUnderdogPredictFee(100), -102);

// +150 (p=0.40) → 0.42 → +138
assert.equal(applyUnderdogPredictFee(150), 138);

// −110 (p≈0.5238) → 0.5438 → −119
assert.equal(applyUnderdogPredictFee(-110), -119);

const shared = fs.readFileSync(path.join(__dirname, 'odds-shared.js'), 'utf8');
assert.match(shared, /applyUnderdogPredictFee/);
assert.match(shared, /underdog_predict/);
const esm = fs.readFileSync(path.join(__dirname, '../src/underdogPredictFee.js'), 'utf8');
assert.match(esm, /UNDERDOG_PREDICT_FEE_PER_CONTRACT = 0\.02/);
assert.match(esm, /p \+ UNDERDOG_PREDICT_FEE_PER_CONTRACT/);

console.log('underdog-predict-fee.test.js ok');
