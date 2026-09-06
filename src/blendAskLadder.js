// Walk a prediction-market ask ladder to a $1,000 FACE payout and return the
// stake-weighted (VWAP) effective American price.
//
// Payout definition (face, not stake, not profit)
// -----------------------------------------------
// Depth levels already store size as DOLLAR STAKE:
//   Kalshi / Polymarket / Novig: size = price × contracts  (see lib/book-depth.js)
//   ProphetX: quantity is shown as "$ currently available" = stake dollars
// Each $1-payout contract (Kalshi/Poly face) costs `impliedProb` dollars.
// Face proceeds if the contract wins:
//   payout = stake / impliedProb = stake × decimalOdds
// That matches promoLockExplainer.hedgeContractsFromStake (contracts = hedge$ × decimal).
// We do NOT use profit (stake × (decimal − 1)). Target is $1,000 collected if you win.
//
// Never invents levels. Empty / invalid books → null (caller keeps top-of-book).

export const TARGET_PAYOUT_USD = 1000;
const COMPLETE_EPS = 0.5;

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

export function formatPayoutDollars(n) {
  if (!isFinite(n) || n <= 0) return null;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function formatBlendedPayoutFlag(blend) {
  if (!blend || blend.american == null) return "";
  if (blend.complete) return "blended to $1,000 payout";
  const filled = formatPayoutDollars(blend.payoutFilled);
  if (!filled) return "blended · $0 of $1,000 payout available";
  return `blended · ${filled} of $1,000 payout available`;
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
    // Face at this level = stake / price. Partial fill keeps the same price.
    const levelPayout = lvl.size / lvl.p;
    if (!(levelPayout > 0)) continue;
    const takePayout = Math.min(levelPayout, remaining);
    const takeStake = takePayout * lvl.p;
    payoutFilled += takePayout;
    stakeFilled += takeStake;
    levelsUsed += 1;
  }

  if (!(payoutFilled > 0) || !(stakeFilled > 0)) return null;
  const impliedProb = stakeFilled / payoutFilled;
  const american = impliedProbToAmerican(impliedProb);
  if (american == null) return null;
  const complete = payoutFilled + COMPLETE_EPS >= target;
  const blend = {
    american,
    impliedProb,
    stakeFilled,
    payoutFilled: complete ? Math.min(payoutFilled, target) : payoutFilled,
    targetPayout: target,
    complete,
    levelsUsed,
  };
  blend.flag = formatBlendedPayoutFlag(blend);
  return blend;
}
