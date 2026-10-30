'use strict';

// love23 promo ledger: running net since the last settlement, settlements due,
// rolled-forward profit, hedge P&L. Pure functions.
//
// Inputs
//   daily:   [{ date: 'YYYY-MM-DD', winLoss: number }]  love23 settled net per day
//            (persisted from /v1/players/settled into love23_daily, because the
//            API only returns the current week)
//   entries: love23_ledger rows: { kind: 'hedge'|'adjust'|'rebate_paid', pnl, stake, result, created_at, ... }
//   promoStart: 'YYYY-MM-DD' (days before are ignored)
//
// Settlement rule: each time the running net since the last settlement reaches
// -trigger, one settlement pays rebateRate * trigger and the baseline moves down
// by trigger (anything past the trigger carries over). Profits roll forward.
// Days are processed in date order; intraday order is unknown, so a day that
// dipped past the trigger and recovered is not detected (open question).

const R = require('./love23-rebate');

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

function settledDailyFromApi(payload) {
  // /v1/players/settled?mode=0 -> [{ date: 'MM/DD/YYYY', winLossAmount, orders: [...] }]
  const out = [];
  for (const d of Array.isArray(payload) ? payload : []) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d && d.date || ''));
    if (!m) continue;
    const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    out.push({ date: iso, winLoss: num(d.winLossAmount), orders: Array.isArray(d.orders) ? d.orders.length : 0 });
  }
  return out;
}

function computeLedger({ daily = [], entries = [], promoStart = null, cfg } = {}) {
  const c = R.withDefaults(cfg);
  const days = daily
    .filter((d) => d && d.date && (!promoStart || d.date >= promoStart))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const adjust = entries.filter((e) => e.kind === 'adjust').reduce((s, e) => s + num(e.pnl), 0);
  let cumulative = adjust; // opening position (e.g. net before this tool tracked it)
  let baseline = 0;
  let settlements = 0;
  const path = [];
  const step = () => {
    while (cumulative - baseline <= -c.trigger) { settlements += 1; baseline -= c.trigger; }
  };
  step();
  for (const d of days) {
    cumulative += num(d.winLoss);
    step();
    path.push({ date: d.date, winLoss: num(d.winLoss), cumulative, N: cumulative - baseline, settlements });
  }
  const N = cumulative - baseline;
  const hedges = entries.filter((e) => e.kind === 'hedge');
  const hedgePnl = hedges.reduce((s, e) => s + (e.result && e.result !== 'open' ? num(e.pnl) : 0), 0);
  const hedgeOpenStake = hedges.filter((e) => !e.result || e.result === 'open').reduce((s, e) => s + num(e.stake), 0);
  const rebatesPaid = entries.filter((e) => e.kind === 'rebate_paid').reduce((s, e) => s + num(e.pnl), 0);
  const rebatesEarned = settlements * c.rebateRate * c.trigger;
  return {
    love23Net: cumulative,
    N,
    rolledForwardProfit: Math.max(0, N),
    lossTowardTrigger: Math.max(0, -N),
    progress: Math.min(1, Math.max(0, -N) / c.trigger),
    distanceToTrigger: R.distanceToTrigger(N, c.trigger),
    settlements,
    rebatesEarned,
    rebatesPaid,
    rebatesOwed: rebatesEarned - rebatesPaid,
    // If the promo pays a partial rebate at the end of the period (unconfirmed):
    partialIfClosedNow: Math.max(0, -N) * c.rebateRate,
    hedgePnl,
    hedgeOpenStake,
    combinedNet: cumulative + hedgePnl + rebatesEarned,
    path,
  };
}

module.exports = { computeLedger, settledDailyFromApi };
