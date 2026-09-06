// Walk a prediction-market ask ladder for Promo true-odds / Profit Boost.
//
// Two walk modes
// --------------
// 1-leg Profit Boost / Free Bet / No Sweat:
//   Compute the exact hedge STAKE $ for a perfect lock from the quoted opp,
//   then VWAP-walk the book until that hedge $ is filled. Not the multi-leg
//   payout target. Example: $100 stake, +200 boosted 100% → $400 win;
//   opp −200 needs $333.33.
// Multi-leg (numLegs ≥ 2):
//   VWAP-walk until PROFIT (win excluding the original stake) reaches
//   TARGET_PAYOUT_USD ($500). "Payout" in UI copy is this profit, not
//   face/total return (stake + win).
//
// Size on depth levels is DOLLAR STAKE (price × contracts). See lib/book-depth.js.
// Profit = stake × (decimalOdds − 1):
//   american > 0: stake × (american / 100)
//   american < 0: stake × (100 / |american|)
// Never invents levels. Sportsbooks are left untouched.
// True odds / true win prob / EV use the blended VWAP American, not the thin top.

export const TARGET_PAYOUT_USD = 500;
export const PM_BLEND_VENUES = new Set(["kalshi", "polymarket", "novig", "prophetx"]);
export const LOW_LIQUIDITY_LABEL = "Low liquidity";
const COMPLETE_EPS = 0.5;

export function isPmBlendVenue(bookKey) {
  return PM_BLEND_VENUES.has(String(bookKey || "").toLowerCase());
}

export function americanToImpliedProb(american) {
  const n = typeof american === "number" ? american : Number(american);
  if (!isFinite(n) || n === 0) return null;
  if (n < 0) return Math.abs(n) / (Math.abs(n) + 100);
  return 100 / (n + 100);
}

export function impliedProbToAmerican(p) {
  if (p == null || !isFinite(p) || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return -Math.round((100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

export function americanToDecimal(american) {
  const n = typeof american === "number" ? american : Number(american);
  if (!isFinite(n) || n === 0) return null;
  if (n > 0) return 1 + n / 100;
  return 1 + 100 / Math.abs(n);
}

// Profit excluding stake per $1 staked. Face/total return is this + 1.
export function americanToProfitMultiple(american) {
  const d = americanToDecimal(american);
  if (d == null || d <= 1) return null;
  return d - 1;
}

export function stakeToProfit(stake, american) {
  const s = Number(stake);
  const m = americanToProfitMultiple(american);
  if (!(s > 0) || m == null) return null;
  return s * m;
}

export function formatPayoutDollars(n) {
  if (!isFinite(n) || n <= 0) return null;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function formatHedgeDollars(n) {
  if (!isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 0.005) return `$${rounded.toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
}

export function payoutTargetLabel(target = TARGET_PAYOUT_USD) {
  return formatPayoutDollars(target) || `$${TARGET_PAYOUT_USD}`;
}

export function formatBlendedPayoutFlag(blend) {
  if (!blend || blend.american == null) return "";
  const target = payoutTargetLabel(blend.targetPayout ?? TARGET_PAYOUT_USD);
  if (blend.complete) return `blended to ${target} payout`;
  const filled = formatPayoutDollars(blend.payoutFilled);
  if (!filled) return `blended · $0 of ${target} payout available`;
  return `blended · ${filled} of ${target} payout available`;
}

export function formatBlendedHedgeFlag(blend) {
  if (!blend || blend.american == null) return "";
  const target = formatHedgeDollars(blend.targetStake);
  if (blend.complete) return target ? `blended to ${target} hedge` : "blended to hedge";
  const filled = formatHedgeDollars(blend.stakeFilled);
  if (!target) return "blended · hedge short";
  if (!filled) return `blended · $0 of ${target} hedge available`;
  return `blended · ${filled} of ${target} hedge available`;
}

function normalizeLevels(levels) {
  const clean = [];
  for (const raw of levels || []) {
    const american = typeof raw?.american === "number" ? raw.american : Number(raw?.american);
    const size = typeof raw?.size === "number" ? raw.size : parseFloat(raw?.size);
    if (!isFinite(american) || american === 0 || !isFinite(size) || size <= 0) continue;
    const p = americanToImpliedProb(american);
    if (p == null || p <= 0 || p >= 1) continue;
    clean.push({ american, size, p });
  }
  clean.sort((a, b) => b.american - a.american);
  return clean;
}

function finishBlend({ stakeFilled, payoutFilled, levelsUsed, complete, targetPayout, targetStake, mode }) {
  if (!(payoutFilled > 0) || !(stakeFilled > 0)) return null;
  // Payout-mode `payoutFilled` is profit (excl. stake). Hedge-mode keeps face
  // (stake / impliedProb) so VWAP is still stake / face either way.
  const face = mode === "payout" ? stakeFilled + payoutFilled : payoutFilled;
  if (!(face > 0)) return null;
  const impliedProb = stakeFilled / face;
  const american = impliedProbToAmerican(impliedProb);
  if (american == null) return null;
  const blend = {
    american,
    impliedProb,
    stakeFilled,
    payoutFilled,
    targetPayout: targetPayout ?? null,
    targetStake: targetStake ?? null,
    complete,
    levelsUsed,
    mode: mode || "payout",
    lowLiquidity: !complete,
  };
  blend.flag = blend.mode === "hedge" ? formatBlendedHedgeFlag(blend) : formatBlendedPayoutFlag(blend);
  return blend;
}

export function blendAskLadderToPayout(levels, { targetPayout = TARGET_PAYOUT_USD } = {}) {
  const target = Number(targetPayout);
  if (!isFinite(target) || target <= 0) return null;
  const ladder = normalizeLevels(levels);
  if (!ladder.length) return null;

  let payoutFilled = 0;
  let stakeFilled = 0;
  let levelsUsed = 0;

  for (const lvl of ladder) {
    const remaining = target - payoutFilled;
    if (remaining <= 1e-9) break;
    // profit = stake × (1 − p) / p  (= stake × (decimalOdds − 1))
    const profitPerStake = (1 - lvl.p) / lvl.p;
    if (!(profitPerStake > 0)) continue;
    const levelProfit = lvl.size * profitPerStake;
    const takeProfit = Math.min(levelProfit, remaining);
    const takeStake = takeProfit / profitPerStake;
    payoutFilled += takeProfit;
    stakeFilled += takeStake;
    levelsUsed += 1;
  }

  const complete = payoutFilled + COMPLETE_EPS >= target;
  return finishBlend({
    stakeFilled,
    payoutFilled: complete ? Math.min(payoutFilled, target) : payoutFilled,
    levelsUsed,
    complete,
    targetPayout: target,
    mode: "payout",
  });
}

// Walk until cumulative STAKE (hedge $) is filled. Size on each level is already stake $.
export function blendAskLadderToStake(levels, { targetStake } = {}) {
  const target = Number(targetStake);
  if (!isFinite(target) || target <= 0) return null;
  const ladder = normalizeLevels(levels);
  if (!ladder.length) return null;

  let payoutFilled = 0;
  let stakeFilled = 0;
  let levelsUsed = 0;

  for (const lvl of ladder) {
    const remaining = target - stakeFilled;
    if (remaining <= 1e-9) break;
    if (!(lvl.size > 0)) continue;
    const takeStake = Math.min(lvl.size, remaining);
    const takePayout = takeStake / lvl.p;
    stakeFilled += takeStake;
    payoutFilled += takePayout;
    levelsUsed += 1;
  }

  const complete = stakeFilled + COMPLETE_EPS >= target;
  return finishBlend({
    stakeFilled: complete ? Math.min(stakeFilled, target) : stakeFilled,
    payoutFilled,
    levelsUsed,
    complete,
    targetStake: target,
    mode: "hedge",
  });
}

export function boostedProfitFromLeg(leg, stake, boostPct) {
  const S = Number(stake);
  const pct = Number(boostPct);
  const d = americanToDecimal(leg && leg.dk);
  if (!(S > 0) || !isFinite(pct) || d == null || d <= 1) return null;
  return (d - 1) * S * (1 + pct / 100);
}

// H = (boostedProfit + stake) / d_h   — same as calcBoostLock.
export function requiredBoostHedgeStake(stake, boostedProfit, oppAmerican) {
  const S = Number(stake);
  const profit = Number(boostedProfit);
  const d_h = americanToDecimal(oppAmerican);
  if (!(S > 0) || !(profit > 0) || d_h == null || d_h <= 1) return null;
  return (profit + S) / d_h;
}

// H = (d_fb − 1) × FB / d_h   — same as calcFreeBetConversion.
export function requiredFreeBetHedgeStake(fbAmerican, oppAmerican, freeBetAmount) {
  const fb = Number(freeBetAmount);
  const d_fb = americanToDecimal(fbAmerican);
  const d_h = americanToDecimal(oppAmerican);
  if (!(fb > 0) || d_fb == null || d_fb <= 1 || d_h == null || d_h <= 1) return null;
  return (d_fb - 1) * fb / d_h;
}

// H = (winProfit + stake − creditValue) / d_h   — same as calcNoSweatLock.
export function requiredNoSweatHedgeStake(stake, winProfit, creditValue, oppAmerican) {
  const S = Number(stake);
  const profit = Number(winProfit);
  const V = Number(creditValue);
  const d_h = americanToDecimal(oppAmerican);
  if (!isFinite(S) || !isFinite(profit) || !isFinite(V) || d_h == null || d_h <= 1) return null;
  const H = (profit + S - V) / d_h;
  return H > 0 ? H : null;
}

export function resolvePmBookLevels(leg, levels) {
  if (!isPmBlendVenue(leg && leg.bestOppBook)) return [];
  const ladder = normalizeLevels(levels);
  if (ladder.length) return ladder;
  const quoted = leg.bestOppQuoted != null ? leg.bestOppQuoted : leg.bestOpp;
  const size = typeof leg.bestOppSize === "number" ? leg.bestOppSize : parseFloat(leg.bestOppSize);
  if (!isFinite(quoted) || quoted === 0 || !isFinite(size) || size <= 0) return [];
  return normalizeLevels([{ american: quoted, size }]);
}

function requiredHedgeForLeg(leg, ctx) {
  const quoted = leg.bestOppQuoted != null ? leg.bestOppQuoted : leg.bestOpp;
  const type = ctx && ctx.promoType;
  const stake = ctx && ctx.stake;
  if (type === "freebet") {
    return requiredFreeBetHedgeStake(leg.dk, quoted, stake);
  }
  if (type === "nosweat") {
    const winProfit = ctx.winProfit != null ? ctx.winProfit : boostedProfitFromLeg(leg, stake, 0);
    const creditValue = ctx.creditValue != null
      ? ctx.creditValue
      : Number(stake) * (Number(ctx.refundPct ?? 100) / 100) * (Number(ctx.creditConversionPct ?? 70) / 100);
    return requiredNoSweatHedgeStake(stake, winProfit, creditValue, quoted);
  }
  const boostedProfit = ctx.boostedProfit != null
    ? ctx.boostedProfit
    : boostedProfitFromLeg(leg, stake, ctx.boostPct);
  return requiredBoostHedgeStake(stake, boostedProfit, quoted);
}

// Blended VWAP when the book was walked; otherwise the quoted bestOpp.
export function trueOppAmerican(leg) {
  const blended = leg && leg.pmBlend && leg.pmBlend.american;
  if (blended != null && isFinite(Number(blended)) && Number(blended) !== 0) return Number(blended);
  const n = Number(leg && leg.bestOpp);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export function applyPmBlendToLeg(leg, levels, ctx = {}) {
  if (!leg || !isPmBlendVenue(leg.bestOppBook)) {
    return { ...leg, lowLiquidity: false, pmBlend: null };
  }
  const quoted = leg.bestOppQuoted != null ? leg.bestOppQuoted : leg.bestOpp;
  const book = resolvePmBookLevels(leg, levels);
  if (!book.length) {
    return { ...leg, bestOppQuoted: quoted, lowLiquidity: false, pmBlend: null };
  }

  const nLegs = ctx.numLegs != null ? Number(ctx.numLegs) : 0;
  const singleLeg = nLegs === 1;
  let blend = null;
  if (singleLeg && (ctx.promoType === "boost" || ctx.promoType === "freebet" || ctx.promoType === "nosweat")) {
    const H = requiredHedgeForLeg({ ...leg, bestOpp: quoted, bestOppQuoted: quoted }, ctx);
    if (H > 0) blend = blendAskLadderToStake(book, { targetStake: H });
  }
  if (!blend) blend = blendAskLadderToPayout(book);

  if (!blend || blend.american == null) {
    return { ...leg, bestOppQuoted: quoted, lowLiquidity: false, pmBlend: null };
  }
  return {
    ...leg,
    bestOppQuoted: quoted,
    bestOpp: blend.american,
    lowLiquidity: !!blend.lowLiquidity,
    pmBlend: blend,
  };
}

export function applyPmBlendToLegs(legs, laddersByKey, ctx = {}) {
  const blends = {};
  const displayLegs = (legs || []).map((leg) => {
    const key = [
      leg && leg.bestOppBook,
      leg && leg.sport,
      leg && leg.game,
      (leg && (leg.bestOppName || leg.name)) || "",
      leg && leg.market,
    ].join("|");
    const levels = laddersByKey && laddersByKey[key];
    const next = applyPmBlendToLeg(leg, levels, {
      ...ctx,
      numLegs: ctx.numLegs != null ? ctx.numLegs : (legs || []).length,
    });
    if (next.pmBlend) blends[key] = next.pmBlend;
    return next;
  });
  return { displayLegs, blends };
}

export function pickHasLowLiquidity(legs) {
  return (legs || []).some((l) => l && l.lowLiquidity);
}

// Full hedge/payout fill ranks ahead of a short book; EV is the tie-breaker.
export function preferCompletePmHedge(parlays) {
  return [...(parlays || [])].sort((a, b) => {
    const aFull = !pickHasLowLiquidity(a && a.legs);
    const bFull = !pickHasLowLiquidity(b && b.legs);
    if (aFull !== bFull) return aFull ? -1 : 1;
    return (Number(b && b.ev) || 0) - (Number(a && a.ev) || 0);
  });
}
