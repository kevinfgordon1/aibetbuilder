'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./love23-rebate');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test('american / decimal / implied conversions', () => {
  close(R.americanToDecimal(150), 2.5);
  close(R.americanToDecimal(-200), 1.5);
  assert.equal(R.decimalToAmerican(2.5), 150);
  assert.equal(R.decimalToAmerican(1.5), -200);
  assert.equal(R.americanToDecimal(50), null);
  assert.equal(R.probToAmerican(0.5), 100);
  const nv = R.noVig(-110, -110);
  close(nv[0], 0.5);
});

test('normal CDF and running-min probability', () => {
  close(R.phi(0), 0.5, 1e-6);
  close(R.phi(-1.96), 0.025, 1e-4);
  // zero drift: reflection principle P(min <= -a) = 2 Phi(-a / s)
  close(R.probMinBelow(-1, 0, 1), 2 * R.phi(-1), 1e-9);
  // strong downward drift: near certain
  assert.ok(R.probMinBelow(-10000, -50000, 1e6) > 0.999);
  // upward drift makes it less likely than zero drift
  assert.ok(R.probMinBelow(-5000, 5000, 25e6) < R.probMinBelow(-5000, 0, 25e6));
  assert.ok(Number.isFinite(R.logPhi(-60)));
});

test('settlementsAfterJump is exact for a single bet', () => {
  assert.equal(R.settlementsAfterJump(-9800, -500), 1);
  assert.equal(R.settlementsAfterJump(-9400, -500), 0);
  assert.equal(R.settlementsAfterJump(2000, -500), 0);
  assert.equal(R.settlementsAfterJump(-19800, -500), 2);
});

test('horizon 0: rebate only when this loss crosses the trigger', () => {
  const sel = { american: 100, sportKey: 'americanfootball_nfl' };
  const far = R.evaluateBet({ sel, fairP: 0.5, hedge: null, state: { N: -1000 }, cfg: { horizonBets: 0 } });
  assert.equal(far.rebateValue, 0);
  const near = R.evaluateBet({ sel, fairP: 0.5, hedge: null, state: { N: -9800 }, cfg: { horizonBets: 0 } });
  close(near.rebateValue, 0.5 * 5000); // loses half the time -> one $5k settlement
});

test('rolled-forward profit lowers rebate value; nearer the trigger raises it', () => {
  const sel = { american: 100, sportKey: 'americanfootball_nfl' };
  const up = R.evaluateBet({ sel, fairP: 0.5, state: { N: 8000 } });
  const flat = R.evaluateBet({ sel, fairP: 0.5, state: { N: 0 } });
  const down = R.evaluateBet({ sel, fairP: 0.5, state: { N: -8000 } });
  assert.ok(up.rebateValue < flat.rebateValue);
  assert.ok(flat.rebateValue < down.rebateValue);
});

test('hedge lock equalizes both outcomes and uses $500 max', () => {
  const sel = { american: 113, sportKey: 'americanfootball_nfl' };
  const r = R.evaluateBet({ sel, fairP: 0.47, hedge: { venue: 'kalshi', american: -120, depthProfit: 1000 }, cfg: { maxBet: 500 }, stake: 900 });
  assert.equal(r.stake, 500);
  close(r.hedge.pnlIfL23Wins, r.hedge.pnlIfL23Loses, 1e-9);
  close(r.hedge.hedgeStake, (565 + 500) / R.americanToDecimal(-120), 1e-9);
  assert.equal(r.hedge.depthOk, true);
  close(r.totalHedged, r.hedge.lockedPnl + r.rebateValue, 1e-9);
});

test('football has no commission; MLB defaults to 6% on risk', () => {
  assert.equal(R.commissionRate('americanfootball_nfl', 1), 0);
  assert.equal(R.commissionRate('baseball_mlb', 1), 0.06);
  assert.equal(R.commissionRate('baseball_mlb', 2), 0.10);
  assert.equal(R.commissionRate('baseball_mlb', 3), 0.14);
  const r = R.evaluateBet({ sel: { american: 100, sportKey: 'baseball_mlb' }, fairP: 0.5, cfg: { horizonBets: 0 } });
  close(r.risk, 530);
  close(r.l23Ev, 0.5 * 500 - 0.5 * 530);
  const off = R.evaluateBet({ sel: { american: 100, sportKey: 'baseball_mlb' }, fairP: 0.5, cfg: { horizonBets: 0, commission: { baseball_mlb: 0 } } });
  close(off.risk, 500);
});
