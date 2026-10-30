'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeLedger, settledDailyFromApi } = require('./love23-ledger');

test('settled API days -> ISO dates', () => {
  const d = settledDailyFromApi([{ date: '10/26/2026', winLossAmount: -120.5, orders: [1, 2] }, { date: 'bad' }]);
  assert.deepEqual(d, [{ date: '2026-10-26', winLoss: -120.5, orders: 2 }]);
});

test('settles each -10k, carries the excess, rolls profit forward', () => {
  const daily = [
    { date: '2026-11-01', winLoss: 3000 },   // up 3k (rolled forward)
    { date: '2026-11-02', winLoss: -8000 },  // N -5k
    { date: '2026-11-03', winLoss: -6500 },  // N -11.5k -> settle, N -1.5k
    { date: '2026-11-04', winLoss: 2000 },   // N +0.5k
  ];
  const l = computeLedger({ daily, entries: [] });
  assert.equal(l.settlements, 1);
  assert.equal(l.rebatesEarned, 5000);
  assert.equal(l.love23Net, -9500);
  assert.equal(l.N, 500);
  assert.equal(l.rolledForwardProfit, 500);
  assert.equal(l.lossTowardTrigger, 0);
  assert.equal(l.distanceToTrigger, 10500);
});

test('promo start, adjustments, rebates paid and hedge P&L', () => {
  const daily = [{ date: '2026-10-20', winLoss: -9999 }, { date: '2026-11-02', winLoss: -4000 }];
  const entries = [
    { kind: 'adjust', pnl: -2000 },
    { kind: 'hedge', stake: 500, pnl: 480, result: 'won' },
    { kind: 'hedge', stake: 300, pnl: 0, result: 'open' },
    { kind: 'rebate_paid', pnl: 0 },
  ];
  const l = computeLedger({ daily, entries, promoStart: '2026-11-01' });
  assert.equal(l.N, -6000);
  assert.equal(l.progress, 0.6);
  assert.equal(l.hedgePnl, 480);
  assert.equal(l.hedgeOpenStake, 300);
  assert.equal(l.partialIfClosedNow, 3000);
});
