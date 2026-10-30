'use strict';

// love23 loss-rebate math. Pure functions, no I/O. American odds in and out.
//
// Promo (client terms, Oct 30 2026):
//   - 50% of net losses back, settled each time the running net since the last
//     settlement reaches -$10,000 ($5,000 cash per settlement).
//   - Profits roll forward: being up just pushes the next trigger further away.
//   - $500 max bet. Football has no commission. The love23 profile note
//     (6% straight / 10% 2-team / 14% 3+ on risk) is applied only to the
//     sports in config.commission (MLB by default).
//
// Hedges are prediction-market only (Kalshi, Polymarket, Novig, ProphetX) at
// fee-adjusted prices (odds_cache already bakes in each venue's own fee).
//
// Rebate value model. Settlements happen when the love23 running net hits a
// new -$10k level, so the count of settlements is driven by the running MINIMUM
// of the account path, not its final value. Over the remaining campaign we
// treat the account as a Brownian motion with total drift M and variance V
// (sum over the bets still to come). P(min <= -a) has a closed form
// (reflection principle with drift). A bet's rebate value is the change in
// expected settlements when its mean and variance are added to the campaign.
// With horizonBets = 0 the bet is valued exactly as a single jump.

const SQRT2 = Math.SQRT2;

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

/**
 * P(min over [0,1] of X <= b) for X_t = M t + sqrt(V) W_t, b < 0.
 * = Phi((b - M)/s) + exp(2 M b / V) Phi((b + M)/s)
 */
function probMinBelow(b, M, V) {
  if (!(b < 0)) return 1;
  if (!(V > 0)) return M <= b ? 1 : 0;
  const s = Math.sqrt(V);
  const p1 = phi((b - M) / s);
  const logP2 = (2 * M * b) / V + logPhi((b + M) / s);
  const p2 = logP2 > 0 ? 1 : Math.exp(logP2);
  return Math.min(1, p1 + p2);
}

const DEFAULT_CONFIG = Object.freeze({
  rebateRate: 0.5,
  trigger: 10000,
  maxBet: 500,
  // Bets the client will still place this campaign (period). 0 = value each
  // bet alone, as if it were the last one before the promo ends.
  horizonBets: 100,
  // Expected love23 result per future bet as a fraction of stake (vig drag).
  futureDriftPct: -0.02,
  // Future per-bet standard deviation as a multiple of maxBet (~1 for even odds).
  futureSdMult: 1,
  // Commission on risk by sport key. Football: none (client terms).
  commission: Object.freeze({ baseball_mlb: 0.06 }),
  // Max settlements counted in the sum (keeps the series finite).
  maxSettlements: 20,
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

/** Distance (dollars of further love23 loss) to the next settlement given running net N since the last settlement. */
function distanceToTrigger(N, trigger = DEFAULT_CONFIG.trigger) {
  return trigger + Number(N || 0);
}

/** Expected settlements over the rest of the campaign (Brownian running-min model). */
function expectedSettlements({ N = 0, M = 0, V = 0, trigger = DEFAULT_CONFIG.trigger, maxSettlements = DEFAULT_CONFIG.maxSettlements } = {}) {
  const a = distanceToTrigger(N, trigger);
  if (a <= 0) return Math.floor(-N / trigger); // already past a trigger (should have settled)
  let sum = 0;
  for (let k = 0; k < maxSettlements; k += 1) {
    const p = probMinBelow(-(a + k * trigger), M, V);
    sum += p;
    if (p < 1e-9) break;
  }
  return sum;
}

/** Settlements caused by one jump from N to N + x (exact, single bet, nothing after). */
function settlementsAfterJump(N, x, trigger = DEFAULT_CONFIG.trigger) {
  const after = Number(N) + Number(x);
  if (after > -trigger) return 0;
  return Math.floor(-after / trigger);
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

  // Rebate value of adding this bet to the campaign
  const N = Number(state.N || 0);
  const rate = c.rebateRate;
  const perSettlement = rate * c.trigger;
  let rebateValue;
  if (!(c.horizonBets > 0)) {
    const kWin = settlementsAfterJump(N, win, c.trigger);
    const kLose = settlementsAfterJump(N, -risk, c.trigger);
    rebateValue = perSettlement * (p * kWin + (1 - p) * kLose);
  } else {
    const M = c.horizonBets * c.futureDriftPct * c.maxBet;
    const V = c.horizonBets * (c.futureSdMult * c.maxBet) ** 2;
    const base = expectedSettlements({ N, M, V, trigger: c.trigger, maxSettlements: c.maxSettlements });
    const withBet = expectedSettlements({ N, M: M + l23Ev, V: V + l23Var, trigger: c.trigger, maxSettlements: c.maxSettlements });
    rebateValue = perSettlement * (withBet - base);
  }

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
  probMinBelow,
  phi,
  logPhi,
  expectedSettlements,
  settlementsAfterJump,
  distanceToTrigger,
  commissionRate,
  evaluateBet,
};
