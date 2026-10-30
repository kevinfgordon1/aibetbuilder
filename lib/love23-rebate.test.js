'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./love23-rebate');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const NOW = Date.parse('2026-10-30T16:00:00Z');

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

test('normal CDF helpers', () => {
  close(R.phi(0), 0.5, 1e-6);
  close(R.phi(-1.96), 0.025, 1e-4);
  assert.ok(Number.isFinite(R.logPhi(-60)));
});

test('rebate value: last week of the promo, single bet, no other plan', () => {
  const sel = { american: 100, sportKey: 'americanfootball_nfl' };
  const cfg = { weeksLeft: 1, betsPerWeek: 0 };
  // Lose -> 500 loss, 50% back -> 250 with prob 0.5.
  close(R.evaluateBet({ sel, fairP: 0.5, state: { nowMs: NOW }, cfg }).rebateValue, 125, 1e-6);
  // Carry covers it -> nothing.
  close(R.evaluateBet({ sel, fairP: 0.5, state: { nowMs: NOW, carry: 2000 }, cfg }).rebateValue, 0, 1e-6);
  // Week already past the cap -> nothing.
  close(R.evaluateBet({ sel, fairP: 0.5, state: { nowMs: NOW, weekNet: -12000 }, cfg }).rebateValue, 0, 1e-6);
});

test('hedge lock equalizes both outcomes and uses $500 max', () => {
  const sel = { american: 113, sportKey: 'americanfootball_nfl' };
  const r = R.evaluateBet({ sel, fairP: 0.47, hedge: { venue: 'kalshi', american: -120, depthProfit: 1000 }, cfg: { maxBet: 500 }, stake: 900, state: { nowMs: NOW } });
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
  const r = R.evaluateBet({ sel: { american: 100, sportKey: 'baseball_mlb' }, fairP: 0.5, state: { nowMs: NOW } });
  close(r.risk, 530);
  close(r.l23Ev, 0.5 * 500 - 0.5 * 530);
  const off = R.evaluateBet({ sel: { american: 100, sportKey: 'baseball_mlb' }, fairP: 0.5, cfg: { commission: { baseball_mlb: 0 } }, state: { nowMs: NOW } });
  close(off.risk, 500);
});
