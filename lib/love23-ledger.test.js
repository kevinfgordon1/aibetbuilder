'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeLedger, settledDailyFromApi } = require('./love23-ledger');

test('settled API days -> ISO dates', () => {
  const d = settledDailyFromApi([{ date: '10/26/2026', winLossAmount: -120.5, orders: [1, 2] }, { date: 'bad' }]);
  assert.deepEqual(d, [{ date: '2026-10-26', winLoss: -120.5, orders: 2 }]);
});

// Weeks start Tuesday. Kevin's example: -10k, -5k, 0, +10k, -10k, -10k.
test("Kevin's six-week example through the weekly ledger", () => {
  const starts = ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08'];
  const nets = [-10000, -5000, 0, 10000, -10000, -10000];
  const daily = [];
  starts.forEach((s, i) => { daily.push({ date: s, winLoss: nets[i] / 2 }, { date: s.replace(/\d\d$/, (d) => String(Number(d) + 6).padStart(2, '0')), winLoss: nets[i] / 2 }); });
  const l = computeLedger({ daily, promoStart: '2026-11-03', nowMs: Date.parse('2026-12-16T17:00:00Z') });
  const closed = l.weeks.filter((w) => w.closed);
  assert.deepEqual(closed.map((w) => w.start), starts);
  assert.deepEqual(closed.map((w) => w.net), nets);
  assert.deepEqual(closed.map((w) => w.owed), [5000, 2500, 0, 0, 10000, 5000]);
  assert.deepEqual(closed.map((w) => w.carryAfter), [0, 0, 0, 10000, 0, 0]);
  assert.equal(l.rebatesEarned, 12500);
  assert.equal(l.carry, 0);
  assert.equal(l.current.start, '2026-12-15');
});

test('week boundaries are Tuesday; Monday belongs to the prior week', () => {
  const daily = [{ date: '2026-11-02', winLoss: -1000 }, { date: '2026-11-03', winLoss: -2000 }];
  const l = computeLedger({ daily, nowMs: Date.parse('2026-11-04T17:00:00Z') });
  const [a, b] = l.weeks;
  assert.equal(a.start, '2026-10-27');
  assert.equal(a.net, -1000);
  assert.equal(b.start, '2026-11-03');
  assert.equal(l.weekNet, -2000);
  assert.equal(l.current.ifEndedNow.owed, 1000);
});

test('opening carry, adjustments, open bets projection, hedges, recorded cash', () => {
  const entries = [
    { kind: 'carry', pnl: 3000, created_at: '2026-11-01T12:00:00Z' },
    { kind: 'adjust', pnl: -500, created_at: '2026-11-04T15:00:00Z' },
    { kind: 'hedge', stake: 500, pnl: 480, result: 'won', created_at: '2026-11-04T15:00:00Z', settled_at: '2026-11-05T03:00:00Z' },
    { kind: 'hedge', stake: 300, pnl: 0, result: 'open', created_at: '2026-11-04T15:00:00Z' },
  ];
  const daily = [{ date: '2026-11-04', winLoss: -4500 }];
  const l = computeLedger({ daily, entries, nowMs: Date.parse('2026-11-06T17:00:00Z'), atRisk: 2000 });
  assert.equal(l.carry, 3000);
  assert.equal(l.weekNet, -5000);
  // 3k absorbed at full, 2k at 50% -> owe 4k, carry 0
  assert.equal(l.current.ifEndedNow.owed, 4000);
  assert.equal(l.current.ifEndedNow.carryAfter, 0);
  assert.equal(l.current.ifOpenBetsLose.owed, 5000);
  assert.equal(l.hedgePnl, 480);
  assert.equal(l.hedgeOpenStake, 300);
});
