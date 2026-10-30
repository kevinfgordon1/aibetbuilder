'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./love23-weekly');

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);

test("Kevin's example: -10k, -5k, 0, +10k, -10k, -10k", () => {
  const { rows, carry, rebates } = W.settleWeeks([-10000, -5000, 0, 10000, -10000, -10000]);
  assert.deepEqual(rows.map((r) => r.owed), [5000, 2500, 0, 0, 10000, 5000]);
  assert.deepEqual(rows.map((r) => r.credited), [0, 0, 0, 10000, 0, 0]);
  assert.deepEqual(rows.map((r) => r.carryAfter), [0, 0, 0, 10000, 0, 0]);
  assert.equal(carry, 0);
  assert.equal(rebates, 12500);
});

test('partial carry, weekly cap and configurable cap', () => {
  const r = W.settleWeek(-15000, 10000);           // 10k at full, 5k at 50%
  assert.equal(r.owed, 12500);
  assert.equal(r.carryAfter, 0);
  assert.equal(W.settleWeek(-25000, 0).owed, 20000);       // 10k discounted ($5k off), 15k full
  assert.equal(W.settleWeek(-25000, 0, { weeklyLossCap: 1e9 }).owed, 12500);
  assert.equal(W.settleWeek(-4000, 6000).owed, 4000);       // all from carry
  assert.equal(W.settleWeek(-4000, 6000).carryAfter, 2000);
});

test('confirmed defaults: $10k cap, $5k weekly stop, Tuesday weeks', () => {
  assert.equal(W.DEFAULT_WEEKLY.weeklyLossCap, 10000);
  assert.equal(W.DEFAULT_WEEKLY.creditLimit, 5000);
  assert.equal(W.DEFAULT_WEEKLY.weekStartDow, 2);
  // default stop: 30 straight losers can't lose more than credit (+ one bet of overshoot)
  const r = W.simulateCampaign({ weeks: 1, betsPerWeek: 30, bet: { p: 0, win: 500, risk: 500, lock: 0 }, sims: 10 });
  assert.equal(r.avgBetsPerWeek, 10);
  assert.equal(r.rebatePerWeek, 2500);
});

test('Tuesday weeks', () => {
  assert.equal(W.weekStartOf('2026-10-30'), '2026-10-27'); // Fri -> Tue
  assert.equal(W.weekStartOf('2026-11-02'), '2026-10-27'); // Mon -> prior Tue
  assert.equal(W.weekStartOf('2026-11-03'), '2026-11-03');
  close(W.weekFractionLeft(Date.parse('2026-10-30T16:00:00Z')), 4 / 7, 1e-9); // Fri..Mon
});

test('DP valuation agrees with Monte Carlo for even-money hedged bets', () => {
  const cfg = { weeksLeft: 6, betsPerWeek: 64, futureDriftPct: 0, futureSdMult: 1, creditLimit: 0 };
  const ctx = W.buildContext({ state: {}, cfg, nowMs: Date.parse('2026-10-27T15:00:00Z') }); // Tuesday: full week ahead
  const mc = W.simulateCampaign({ weeks: 6, betsPerWeek: 64, bet: { p: 0.5, win: 500, risk: 500, lock: 0 }, cfg, sims: 6000, seed: 3 });
  close(ctx.base, mc.expectedRebate, 0.06 * mc.expectedRebate);
});

test('carry lowers expected rebates; near the weekly cap more variance hurts', () => {
  const nowMs = Date.parse('2026-10-30T16:00:00Z');
  const bet = { p: 0.5, win: 500, risk: 500 };
  const ctx = (state) => W.buildContext({ state, cfg: {}, nowMs });
  assert.ok(ctx({ carry: 8000 }).base < ctx({ carry: 0 }).base);
  assert.ok(ctx({ carry: 20000 }).base < ctx({ carry: 8000 }).base);
  // Fair coin flip adds variance: worth something at a flat week...
  assert.ok(W.marginalRebate(ctx({}), bet) > 0);
  // ...but just under the $10k cap the payoff is concave, so it costs.
  assert.ok(W.marginalRebate(ctx({ weekNet: -9000 }), bet) < 0);
  // Far past the cap and with the rest of the week unable to reach back: ~0.
  close(W.marginalRebate(ctx({ weekNet: -40000 }), bet), 0, 1e-6);
});

test('skewed love23 legs (long shots) earn more rebate per bet than even money', () => {
  const cfg = { creditLimit: null };
  const even = W.simulateCampaign({ weeks: 6, betsPerWeek: 20, bet: { p: 0.5, win: 500, risk: 500, lock: 0 }, cfg, sims: 4000 });
  const dog = W.simulateCampaign({ weeks: 6, betsPerWeek: 20, bet: { p: 0.25, win: 1500, risk: 500, lock: 0 }, cfg, sims: 4000 });
  assert.ok(dog.rebatePerWeek > even.rebatePerWeek);
});

test('credit-limit stop caps the weekly loss', () => {
  const r = W.simulateCampaign({ weeks: 1, betsPerWeek: 40, bet: { p: 0.1, win: 4500, risk: 500, lock: 0 }, cfg: { creditLimit: 5000 }, sims: 2000 });
  assert.ok(r.rebatePerWeek <= 2500 + 1e-9);
});

test('plan table: more volume buys more rebate, priced by the n-th best lock', () => {
  const picks = Array.from({ length: 40 }, (_, i) => ({ p: 0.5, win: 480, risk: 500, lock: 5 - i }));
  const t = W.planTable({ picks, volumes: [10, 40, 80], cfg: { weeksLeft: 4 }, sims: 1500 });
  assert.equal(t.length, 2); // only 40 picks available
  assert.ok(t[1].rebatePerWeek > t[0].rebatePerWeek);
  assert.ok(t[1].lockPerWeek < t[0].lockPerWeek);
  close(t[0].avgLock, 0.5, 1e-9);
});
