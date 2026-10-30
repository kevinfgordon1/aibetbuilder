'use strict';

// love23 weekly loss-rebate rules and valuation. Pure functions, no I/O.
//
// Rules (client terms, Oct 30 2026):
//   * Settlement is weekly, Tuesday to Tuesday (cfg.weekStartDow, 2 = Tuesday).
//   * Losing week: after any carry is used up, the client pays only
//     rebateRate (50%) of the loss. The discount is capped: at most
//     weeklyLossCap ($10k) of loss is discounted per week ($5k off); loss past
//     the cap is paid in full. Cap is configurable (unconfirmed).
//   * Winning week: the client keeps 100%, and the profit carries forward.
//   * Carry absorbs later losses at full value until it is used up; then
//     losses are back to 50%.
//
// Economically the client's result for a week is  net + rebate,  where
//   rebate = rebateRate * min(cap, max(0, loss - carry)).
// Over many weeks the summed "loss past carry" equals the depth of the running
// minimum of cumulative weekly love23 P&L (a reflected walk), so a win is
// effectively taxed later by the rebate it cancels. That is why the rebate is
// an option on weekly variance, and why its value per week falls once a
// profit cushion is built.

const DEFAULT_WEEKLY = Object.freeze({
  rebateRate: 0.5,
  weeklyLossCap: 10000,  // loss discounted per week (=$5k off at 50%)
  weekStartDow: 2,       // 0 Sun .. 6 Sat; Tuesday per client
  weeksLeft: 8,          // weeks left in the promo, including this one
  betsPerWeek: 30,       // planned love23 bets per week at maxBet
  maxBet: 500,
  futureDriftPct: -0.02, // expected love23 result per planned bet (fraction of stake)
  futureSdMult: 1,       // per-bet SD as a multiple of maxBet (~1 for even odds)
  creditLimit: null,     // weekly loss stop (love23 credit); null = none
});

function num(x, d = 0) { const n = Number(x); return Number.isFinite(n) ? n : d; }

function settleWeek(net, carry = 0, cfg = {}) {
  const c = { ...DEFAULT_WEEKLY, ...cfg };
  const n = num(net);
  const C = Math.max(0, num(carry));
  if (n >= 0) {
    return { net: n, carryBefore: C, absorbed: 0, rebatable: 0, rebate: 0, owed: 0, credited: n, carryAfter: C + n, clientResult: n };
  }
  const loss = -n;
  const absorbed = Math.min(C, loss);
  const past = loss - absorbed;
  const rebatable = Math.min(past, c.weeklyLossCap);
  const rebate = c.rebateRate * rebatable;
  return {
    net: n,
    carryBefore: C,
    absorbed,
    rebatable,
    rebate,
    owed: loss - rebate, // what the client is charged for the week (carry first, then cash)
    credited: 0,
    carryAfter: C - absorbed,
    clientResult: n + rebate,
  };
}

function settleWeeks(nets, { carry = 0, cfg } = {}) {
  let C = carry;
  const rows = [];
  for (const n of nets) {
    const r = settleWeek(n, C, cfg);
    rows.push(r);
    C = r.carryAfter;
  }
  return { rows, carry: C, rebates: rows.reduce((s, r) => s + r.rebate, 0), owed: rows.reduce((s, r) => s + r.owed, 0) };
}

// ---- dates ---------------------------------------------------------------

function isoAddDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Week start (YYYY-MM-DD) for a calendar date (YYYY-MM-DD). */
function weekStartOf(iso, dow = DEFAULT_WEEKLY.weekStartDow) {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return isoAddDays(iso, -((d - dow + 7) % 7));
}

/** Calendar date in America/New_York for an epoch ms. */
function etDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Fraction of the current week still ahead (by ET calendar day, incl. today). */
function weekFractionLeft(nowMs, dow = DEFAULT_WEEKLY.weekStartDow) {
  const today = etDate(nowMs);
  const start = weekStartOf(today, dow);
  const elapsed = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000);
  return Math.max(1, 7 - elapsed) / 7;
}

// ---- valuation -------------------------------------------------------------

// Standard-normal quadrature on a fixed grid (z in [-6, 6]); accurate to well
// under a dollar for these piecewise-linear payoffs.
const Z = [];
const WZ = [];
(() => {
  const step = 0.125;
  let tot = 0;
  for (let z = -6; z <= 6 + 1e-9; z += step) { const w = Math.exp(-0.5 * z * z); Z.push(z); WZ.push(w); tot += w; }
  for (let i = 0; i < WZ.length; i += 1) WZ[i] /= tot;
})();

function weekStep(C, W, c) {
  let w = W;
  if (c.creditLimit != null && c.creditLimit > 0) w = Math.max(w, -(c.creditLimit + C)); // stop betting at the credit limit
  if (w >= 0) return { rebate: 0, carry: C + w };
  const loss = -w;
  const absorbed = Math.min(C, loss);
  return { rebate: c.rebateRate * Math.min(loss - absorbed, c.weeklyLossCap), carry: C - absorbed };
}

/**
 * Expected rebates from future whole weeks as a function of the carry going in.
 * Each future week's love23 P&L ~ Normal(mu, sd). Returns V(C).
 */
function futureValueFn({ weeks, mu, sd, cfg }) {
  const c = { ...DEFAULT_WEEKLY, ...cfg };
  if (!(weeks > 0)) return () => 0;
  const cMax = Math.max(4 * c.weeklyLossCap, Math.abs(mu) * weeks + 6 * sd * Math.sqrt(weeks), 1000);
  const G = 241;
  const dx = cMax / (G - 1);
  let V = new Float64Array(G); // V_0 = 0
  const interp = (arr, C) => {
    if (C <= 0) return arr[0];
    const x = C / dx;
    if (x >= G - 1) return arr[G - 1];
    const i = Math.floor(x);
    const f = x - i;
    return arr[i] * (1 - f) + arr[i + 1] * f;
  };
  for (let k = 0; k < weeks; k += 1) {
    const next = new Float64Array(G);
    for (let j = 0; j < G; j += 1) {
      const C = j * dx;
      let acc = 0;
      for (let i = 0; i < Z.length; i += 1) {
        const s = weekStep(C, mu + sd * Z[i], c);
        acc += WZ[i] * (s.rebate + interp(V, s.carry));
      }
      next[j] = acc;
    }
    V = next;
  }
  const out = (C) => interp(V, Math.max(0, C));
  out.grid = { dx, G, cMax };
  return out;
}

/** Expected rebate this week + future weeks, given carry, this week's realized net and the rest of this week's plan. */
function weekValue({ carry, realized, restMu, restSd, next, cfg }) {
  const c = { ...DEFAULT_WEEKLY, ...cfg };
  if (!(restSd > 0)) {
    const s = weekStep(carry, realized + restMu, c);
    return s.rebate + next(s.carry);
  }
  let acc = 0;
  for (let i = 0; i < Z.length; i += 1) {
    const s = weekStep(carry, realized + restMu + restSd * Z[i], c);
    acc += WZ[i] * (s.rebate + next(s.carry));
  }
  return acc;
}

/**
 * Valuation context built once per request.
 * state: { carry, weekNet }  carry entering this week, love23 net so far this week
 */
function buildContext({ state = {}, cfg, nowMs = Date.now() } = {}) {
  const c = { ...DEFAULT_WEEKLY, ...cfg };
  const frac = weekFractionLeft(nowMs, c.weekStartDow);
  const betsLeftThisWeek = state.betsLeftThisWeek != null ? Math.max(0, num(state.betsLeftThisWeek)) : Math.round(c.betsPerWeek * frac);
  const perBetMu = c.futureDriftPct * c.maxBet;
  const perBetSd = c.futureSdMult * c.maxBet;
  const restMu = betsLeftThisWeek * perBetMu;
  const restSd = Math.sqrt(betsLeftThisWeek) * perBetSd;
  const weekMu = c.betsPerWeek * perBetMu;
  const weekSd = Math.sqrt(c.betsPerWeek) * perBetSd;
  const futureWeeks = Math.max(0, Math.round(c.weeksLeft) - 1);
  const next = futureValueFn({ weeks: futureWeeks, mu: weekMu, sd: weekSd, cfg: c });
  const carry = Math.max(0, num(state.carry));
  const realized = num(state.weekNet);
  const base = weekValue({ carry, realized, restMu, restSd, next, cfg: c });
  return { c, carry, realized, restMu, restSd, next, base, betsLeftThisWeek, futureWeeks, weekMu, weekSd, fracLeft: frac };
}

/** Marginal expected rebate from adding one bet (win `win` w.p. p, else lose `risk`) to this week's plan. */
function marginalRebate(ctx, { p, win, risk }) {
  if (!ctx || ctx.none) return 0;
  const vw = weekValue({ carry: ctx.carry, realized: ctx.realized + win, restMu: ctx.restMu, restSd: ctx.restSd, next: ctx.next, cfg: ctx.c });
  const vl = weekValue({ carry: ctx.carry, realized: ctx.realized - risk, restMu: ctx.restMu, restSd: ctx.restSd, next: ctx.next, cfg: ctx.c });
  return p * vw + (1 - p) * vl - ctx.base;
}

/** P(this week ends net negative past carry) and projected settlement under the plan. */
function weekOutlook(ctx) {
  let pNeg = 0; let eRebate = 0; let eOwed = 0;
  const sd = ctx.restSd;
  const pts = sd > 0 ? Z.map((z, i) => [ctx.realized + ctx.restMu + sd * z, WZ[i]]) : [[ctx.realized + ctx.restMu, 1]];
  for (const [W, w] of pts) {
    const s = settleWeek(ctx.c.creditLimit ? Math.max(W, -(ctx.c.creditLimit + ctx.carry)) : W, ctx.carry, ctx.c);
    if (s.rebatable > 0) pNeg += w;
    eRebate += w * s.rebate;
    eOwed += w * s.owed;
  }
  return { pPastCarry: pNeg, expectedRebateThisWeek: eRebate, expectedOwedThisWeek: eOwed, expectedRebateTotal: ctx.base };
}

// ---- Monte Carlo campaign (strategy check, exact per-bet outcomes) ----------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulate a promo: `weeks` weeks of `betsPerWeek` hedged love23 bets.
 * bet: { p, win, risk, lock }  love23 leg (fair win prob, profit if it wins,
 * loss if it loses) and the locked P&L of the leg + its PM hedge.
 * Bets stop for the week once the love23 loss reaches creditLimit + carry.
 * Returns expected totals and per-week averages.
 */
function simulateCampaign({ weeks = 8, betsPerWeek = 60, bet, carry0 = 0, cfg, sims = 20000, seed = 7 } = {}) {
  const c = { ...DEFAULT_WEEKLY, ...cfg };
  const r = rng(seed);
  let sumReb = 0; let sumLock = 0; let sumL23 = 0; let negWeeks = 0; let sumBets = 0;
  let sumSq = 0;
  for (let s = 0; s < sims; s += 1) {
    let C = carry0; let reb = 0; let lock = 0; let l23 = 0;
    for (let w = 0; w < weeks; w += 1) {
      let W = 0;
      for (let b = 0; b < betsPerWeek; b += 1) {
        if (c.creditLimit != null && W - bet.risk < -(c.creditLimit + C)) break;
        W += r() < bet.p ? bet.win : -bet.risk;
        lock += bet.lock;
        sumBets += 1;
      }
      const st = settleWeek(W, C, c);
      if (st.rebatable > 0) negWeeks += 1;
      reb += st.rebate;
      l23 += W;
      C = st.carryAfter;
    }
    sumReb += reb; sumLock += lock; sumL23 += l23;
    sumSq += (reb + lock) ** 2;
  }
  const meanTotal = (sumReb + sumLock) / sims;
  return {
    weeks,
    betsPerWeek,
    expectedRebate: sumReb / sims,
    expectedLock: sumLock / sims,
    expectedTotal: meanTotal,
    perWeek: meanTotal / weeks,
    rebatePerWeek: sumReb / sims / weeks,
    sdTotal: Math.sqrt(Math.max(0, sumSq / sims - meanTotal ** 2)),
    pWeekPastCarry: negWeeks / (sims * weeks),
    avgBetsPerWeek: sumBets / (sims * weeks),
    expectedLove23Net: sumL23 / sims,
  };
}

/**
 * Weekly plan table for N = volumes: uses the best N hedged picks available
 * now (avg locked P&L, avg love23 win prob and payout) as the bet each week,
 * simulated over the rest of the promo from the current carry.
 * picks: [{ p, win, risk, lock }] sorted best first.
 */
function planTable({ picks, volumes = [10, 20, 30, 40, 60], cfg, carry = 0, sims = 3000, seed = 17 } = {}) {
  const c = { ...DEFAULT_WEEKLY, ...cfg };
  const out = [];
  for (const n of volumes) {
    const top = (picks || []).slice(0, n);
    if (top.length < n) break;
    const avg = (k) => top.reduce((s, x) => s + x[k], 0) / n;
    const bet = { p: avg('p'), win: avg('win'), risk: avg('risk'), lock: avg('lock') };
    const r = simulateCampaign({ weeks: Math.max(1, Math.round(c.weeksLeft)), betsPerWeek: n, bet, carry0: carry, cfg: c, sims, seed });
    out.push({ betsPerWeek: n, avgLock: bet.lock, rebatePerWeek: r.rebatePerWeek, lockPerWeek: r.expectedLock / r.weeks, evPerWeek: r.perWeek, sdPromo: r.sdTotal, pWeekPastCarry: r.pWeekPastCarry });
  }
  return out;
}

module.exports = {
  DEFAULT_WEEKLY,
  planTable,
  settleWeek,
  settleWeeks,
  weekStartOf,
  isoAddDays,
  etDate,
  weekFractionLeft,
  futureValueFn,
  weekValue,
  buildContext,
  marginalRebate,
  weekOutlook,
  simulateCampaign,
  _weekStep: weekStep,
};
