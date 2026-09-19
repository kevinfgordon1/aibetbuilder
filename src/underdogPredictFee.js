// Underdog Predict: $0.02 per contract (2% of $1 face / max payout).
// Unlike ProphetX (2% of net winnings only), this is a flat face-value fee
// added to the contract cost. Buy at implied p, pay p + 0.02, receive $1.
// Keep in lockstep with lib/underdog-predict-fee.js (Odds API / applyBookAdjustments).

export const UNDERDOG_PREDICT_FEE_PER_CONTRACT = 0.02;

export function applyUnderdogPredictFee(rawAmericanOdds) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  const n = typeof rawAmericanOdds === "number" ? rawAmericanOdds : Number(rawAmericanOdds);
  if (!Number.isFinite(n) || n === 0) return rawAmericanOdds;
  let p;
  if (n > 0) p = 100 / (n + 100);
  else p = Math.abs(n) / (Math.abs(n) + 100);
  if (p <= 0 || p >= 1) return rawAmericanOdds;
  const effPrice = p + UNDERDOG_PREDICT_FEE_PER_CONTRACT;
  if (effPrice <= 0 || effPrice >= 1) return rawAmericanOdds;
  const decimalOdds = 1 / effPrice;
  if (decimalOdds <= 1) return rawAmericanOdds;
  if (decimalOdds >= 2) return Math.round((decimalOdds - 1) * 100);
  return -Math.round(100 / (decimalOdds - 1));
}
