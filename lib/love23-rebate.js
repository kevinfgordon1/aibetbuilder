'use strict';

// love23 loss-rebate math. Pure functions, no I/O. American odds in and out.
//
// Promo (client terms, clarified Oct 30 2026): weekly Tuesday-to-Tuesday
// settlement; a losing week costs only 50% of the loss (discount capped at
// $10k of loss per week, configurable); winning weeks are kept in full and the
// profit carries forward, absorbing later losses at full value. See
// lib/love23-weekly.js for the rules and the valuation.
//   - $500 max bet. Football has no commission. The love23 profile note
//     (6% straight / 10% 2-team / 14% 3+ on risk) is applied only to the
//     sports in config.commission (MLB by default).
//
// Hedges are prediction-market only (Kalshi, Polymarket, Novig, ProphetX) at
// fee-adjusted prices (odds_cache already bakes in each venue's own fee).
// A fully hedged bet's love23 leg still moves the weekly love23 P&L, and only
// love23 losses are discounted, so each bet carries a rebate value: the
// change in expected weekly rebates (this week and the rest of the promo)
// from adding the bet to the plan.

const SQRT2 = Math.SQRT2;
const W = require('./love23-weekly');

function americanToDecimal(a) {
  const n = Number(a);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) < 100) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function decimalToAmerican(d) {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 1) return null;
  return n >= 2 ? Math.round((n - 1) * 100) : -Math.round(100 / (n - 1));
}

function impliedProb(a) {
  const d = americanToDecimal(a);
  return d ? 1 / d : null;
}

function probToAmerican(p) {
  const n = Number(p);
  if (!(n > 0 && n < 1)) return null;
  return decimalToAmerican(1 / n);
}

/** Multiplicative no-vig for a 2-way market. Returns [pA, pB] or null. */
function noVig(aAmerican, bAmerican) {
  const pa = impliedProb(aAmerican);
  const pb = impliedProb(bAmerican);
  if (pa == null || pb == null) return null;
  const s = pa + pb;
  if (!(s > 0)) return null;
  return [pa / s, pb / s];
}

/** Profit if a stake at this American price wins (depth is measured as potential profit). */
function profitAtAmerican(stake, american) {
  const a = Number(american);
  const s = Number(stake);
  if (!Number.isFinite(a) || a === 0 || !(s > 0)) return 0;
  return a < 0 ? (s * 100) / Math.abs(a) : (s * a) / 100;
}

// erfc with ~1.2e-7 relative accuracy everywhere (Numerical Recipes erfcc).
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

function logErfcPos(z) {
  // log(erfc(z)) for z >= 0 without underflow.
  const t = 1 / (1 + 0.5 * z);
  return Math.log(t) + (-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277)))))))));
}

/** log Phi(z) (standard normal CDF), stable in the far left tail. */
function logPhi(z) {
  if (z > 0) return Math.log(1 - 0.5 * erfc(z / SQRT2));
  return Math.log(0.5) + logErfcPos(-z / SQRT2);
}

function phi(z) { return Math.exp(logPhi(z)); }

const DEFAULT_CONFIG = Object.freeze({
  ...W.DEFAULT_WEEKLY,
  // Commission on risk by sport key. Football: none (client terms).
  commission: Object.freeze({ baseball_mlb: 0.06 }),
  // Edge guard: Pinnacle vs prediction-market fair must agree within this many
  // probability points, else the more conservative fair is used and the pick is flagged.
  confirmPts: 0.015,
  // Odds API Pinnacle can trail love23 by minutes; treat odds_cache older than this as stale.
  staleMs: 6 * 60 * 1000,
  minHedgeDepthOk: true,
});

function withDefaults(cfg) {
  const c = { ...DEFAULT_CONFIG, ...(cfg || {}) };
  c.commission = { ...DEFAULT_CONFIG.commission, ...((cfg && cfg.commission) || {}) };
  return c;
}

/** Commission rate on risk for this sport and number of legs. */
function commissionRate(sportKey, legs, cfg) {
  const c = withDefaults(cfg);
  const base = Number(c.commission[sportKey] || 0);
  if (!(base > 0)) return 0;
  if (legs >= 3) return 0.14;
  if (legs === 2) return 0.10;
  return base;
}

/**
 * Value one love23 straight bet.
 * sel:   { american, sportKey }                  love23 price for the side we bet
 * fairP: fair probability the love23 side wins (no-vig)
 * hedge: { venue, american } best opposing prediction-market price after fees, or null
 * state: { N } running love23 net since the last settlement (positive = rolled-forward profit)
 */
function evaluateBet({ sel, fairP, hedge, state = {}, cfg, stake: stakeIn } = {}) {
  const c = withDefaults(cfg);
  const stake = Math.min(Number(stakeIn || c.maxBet), c.maxBet);
  const dL = americanToDecimal(sel && sel.american);
  if (!dL || !(fairP > 0 && fairP < 1) || !(stake > 0)) return null;
  const comm = commissionRate(sel.sportKey, 1, c);
  const risk = stake * (1 + comm); // what love23 debits when the bet loses
  const win = stake * (dL - 1);
  const p = fairP;
  // love23 leg alone vs fair
  const l23Ev = p * win - (1 - p) * risk;
  const l23EvPct = l23Ev / risk;
  const l23Var = p * (1 - p) * (win + risk) ** 2;

  // Rebate value: marginal expected weekly rebate (this week + the rest of the
  // promo) from adding this bet to the plan. state.ctx is built once per
  // request by love23-weekly.buildContext; built here when absent (tests).
  const ctx = state.ctx || W.buildContext({ state, cfg: c, nowMs: state.nowMs });
  const rebateValue = W.marginalRebate(ctx, { p, win, risk });

  const out = {
    stake,
    risk,
    commission: comm,
    l23American: Number(sel.american),
    fairP,
    fairAmerican: probToAmerican(fairP),
    l23Ev,
    l23EvPct,
    l23Var,
    rebateValue,
    totalUnhedged: l23Ev + rebateValue,
    hedge: null,
  };

  const dH = hedge ? americanToDecimal(hedge.american) : null;
  if (dH) {
    // Equalize: hedge pays the same whichever side wins.
    const hedgeStake = (win + risk) / dH;
    const pnlIfL23Wins = win - hedgeStake;
    const pnlIfL23Loses = -risk + hedgeStake * (dH - 1);
    const hedgeEv = (1 - p) * hedgeStake * (dH - 1) - p * hedgeStake;
    const neededProfit = hedgeStake * (dH - 1);
    const depthProfit = hedge.depthProfit != null ? Number(hedge.depthProfit) : null;
    out.hedge = {
      venue: hedge.venue,
      american: Number(hedge.american),
      hedgeStake,
      stakeRatio: hedgeStake / stake,
      neededProfit,
      depthProfit,
      depthOk: depthProfit == null ? null : depthProfit >= neededProfit,
      hedgeEv,
      lockedPnl: (pnlIfL23Wins + pnlIfL23Loses) / 2, // equal by construction; average kills float noise
      pnlIfL23Wins,
      pnlIfL23Loses,
    };
    out.totalHedged = out.hedge.lockedPnl + rebateValue;
  }
  return out;
}

module.exports = {
  DEFAULT_CONFIG,
  withDefaults,
  americanToDecimal,
  decimalToAmerican,
  impliedProb,
  probToAmerican,
  noVig,
  profitAtAmerican,
  phi,
  logPhi,
  commissionRate,
  evaluateBet,
};
