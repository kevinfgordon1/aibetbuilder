// Underdog Predict / UDX exchange fee.
//
// Public UDX schedule (maker = taker) fits
//   fee per $1-face contract ≈ rate × p × (1 − p)
// with rate = 0.072:
//   10 contracts @ $0.50 → $0.18  (0.072 × 0.50 × 0.50 × 10)
//   10 contracts @ $0.20 → $0.12  (0.072 × 0.20 × 0.80 × 10 = 0.1152, tickets round)
//
// The fee is added to cost (cost + fee outlay), same shape as Kalshi/Polymarket
// taker fees: p_eff = p + rate·p·(1−p) = p·(1 + rate·(1−p)).
// Buy at implied p, pay p_eff, receive $1.
//
// Live tickets may round slightly differently (a Purdue ML print of ~6,292
// contracts at p≈0.1589 showed $56.16 vs ~$60.55 on this closed form). We
// calibrate to the published UDX examples, not a one-off slip constant.
//
// Keep in lockstep with lib/underdog-predict-fee.js (Odds API / applyBookAdjustments).

export const UNDERDOG_PREDICT_UDX_FEE_RATE = 0.072;

/** @deprecated Flat $0.02/contract is no longer the live formula. */
export const UNDERDOG_PREDICT_FEE_PER_CONTRACT = 0.02;

function clampUnitInterval(p) {
  const n = typeof p === "number" ? p : Number(p);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function impliedPriceFromAmerican(n) {
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

function americanFromImpliedPrice(p) {
  if (p <= 0 || p >= 1) return null;
  const decimalOdds = 1 / p;
  if (decimalOdds <= 1) return null;
  if (decimalOdds >= 2) return Math.round((decimalOdds - 1) * 100);
  return -Math.round(100 / (decimalOdds - 1));
}

export function underdogPredictFeePerContract(p) {
  const x = clampUnitInterval(p);
  if (x <= 0 || x >= 1) return 0;
  return UNDERDOG_PREDICT_UDX_FEE_RATE * x * (1 - x);
}

export function applyUnderdogPredictFee(rawAmericanOdds) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  const n = typeof rawAmericanOdds === "number" ? rawAmericanOdds : Number(rawAmericanOdds);
  if (!Number.isFinite(n) || n === 0) return rawAmericanOdds;
  const p = impliedPriceFromAmerican(n);
  if (p <= 0 || p >= 1) return rawAmericanOdds;
  // Fee is added to cost — p_eff = p + rate·p·(1−p).
  const effPrice = p + underdogPredictFeePerContract(p);
  const american = americanFromImpliedPrice(effPrice);
  return american == null ? rawAmericanOdds : american;
}
