'use strict';

// Underdog Predict / UDX exchange fee.
//
// Public UDX schedule (maker = taker) fits
//   fee per $1-face contract ≈ rate × p × (1 − p)
// with rate = 0.072:
//   10 contracts @ $0.50 → $0.18  (0.072 × 0.50 × 0.50 × 10)
//   10 contracts @ $0.20 → $0.12  (0.072 × 0.20 × 0.80 × 10 = 0.1152, tickets round)
//
// The fee is added to cost (cost + fee outlay), same shape as Kalshi/Polymarket
// taker fees in odds-shared.js: p_eff = p + rate·p·(1−p) = p·(1 + rate·(1−p)).
// Buy at implied p, pay p_eff, receive $1.
//
// Live tickets may round slightly differently (a Purdue ML print of ~6,292
// contracts at p≈0.1589 showed $56.16 vs ~$60.55 on this closed form). We
// calibrate to the published UDX examples, not a one-off slip constant.
//
// Legacy UDX curve. Do not use it for Promo: it adds 0.072 on the sticker's
// own implied price and double-counts (Browns sticker +331 → +308).
// Promo cash uses UNDERDOG_PREDICT_CASH_FEE_RATE below. New Odds Board and
// applyBookAdjustments stay on the gross sticker.

const UNDERDOG_PREDICT_UDX_FEE_RATE = 0.072;

/** @deprecated Flat $0.02/contract is no longer the live formula. */
const UNDERDOG_PREDICT_FEE_PER_CONTRACT = 0.02;

function clampUnitInterval(p) {
  const n = typeof p === 'number' ? p : Number(p);
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

function decimalToAmerican(d) {
  if (!Number.isFinite(d) || d <= 1) return null;
  if (d >= 2) return Math.round((d - 1) * 100);
  return -Math.round(100 / (d - 1));
}

const TYPICAL_BETSTAMP_DECIMAL_MAX = 20;

function coerceUnderdogFeeInputToAmerican(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0 && n < 1) {
    if (n < 0.05) return null;
    return n >= 0.5 ? -Math.round((100 * n) / (1 - n)) : Math.round((100 * (1 - n)) / n);
  }
  if (n === 1) return null;
  if (n > 1 && n < TYPICAL_BETSTAMP_DECIMAL_MAX) return decimalToAmerican(n);
  if (n >= TYPICAL_BETSTAMP_DECIMAL_MAX && n < 100) return null;
  return n;
}

function underdogPredictFeePerContract(p) {
  const x = clampUnitInterval(p);
  if (x <= 0 || x >= 1) return 0;
  return UNDERDOG_PREDICT_UDX_FEE_RATE * x * (1 - x);
}

function applyUnderdogPredictFee(rawAmericanOdds) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  const n = coerceUnderdogFeeInputToAmerican(rawAmericanOdds);
  if (n == null) return Number.isFinite(Number(rawAmericanOdds)) ? null : rawAmericanOdds;
  const p = impliedPriceFromAmerican(n);
  if (p <= 0 || p >= 1) return rawAmericanOdds;
  // Fee is added to cost — p_eff = p + rate·p·(1−p).
  const effPrice = p + underdogPredictFeePerContract(p);
  const american = americanFromImpliedPrice(effPrice);
  return american == null ? rawAmericanOdds : american;
}

// ── Promo cash price (fee-inclusive phone odds) ──────────────────────────
//
// Betstamp book 196 and Underdog's lobby both print the GROSS sticker. For
// Giants ML that sticker is American +252 / decimal 3.52, the same number
// Kalshi shows after its own taker fee (θ = 0.07 on contract probability
// p ≈ 0.27 → $352.36 on $100, 3.52x). It is not 1/p (1/0.27 ≈ 3.70).
//
// Underdog Predict's cash slip is fee-inclusive on that same p:
//   fee = r × C × p × (1 − p)
//   stake = C × p + fee
//   C = stake / (p × (1 + r × (1 − p)))
// Giants $100, p = 0.27, r = 0.1015 → C = 344.82, fee = $6.90,
// multiplier 3.4482 ≈ 3.45x ≈ +245.
//
// The published UDM $0.01/contract + 0.07×p×(1−p) schedule does not fit
// that slip (~340 contracts, ~$8.10). r is one named constant so it can move
// when a later slip says so. Pass `probability` when the feed has Underdog's
// probability / raw_probability; otherwise recover p by inverting the Kalshi
// θ already inside the sticker.
//
// Free bets keep the gross sticker. This helper is the cash / +EV price only.

const UNDERDOG_PREDICT_CASH_FEE_RATE = 0.1015;
const UNDERDOG_STICKER_KALSHI_FEE_RATE = 0.07;
const UNDERDOG_PREDICT_BOOK_KEY = 'underdog_predict';

function contractProbabilityFromKalshiSticker(stickerAmerican, theta = UNDERDOG_STICKER_KALSHI_FEE_RATE) {
  const pEff = impliedPriceFromAmerican(stickerAmerican);
  const t = Number(theta);
  if (!(pEff > 0 && pEff < 1) || !(t > 0)) return null;
  const disc = (1 + t) * (1 + t) - 4 * t * pEff;
  if (disc < 0) return null;
  const p = ((1 + t) - Math.sqrt(disc)) / (2 * t);
  if (!(p > 0 && p < 1)) return null;
  return p;
}

function underdogPredictCashQuote({ probability, stickerAmerican, stake = 100, rate = UNDERDOG_PREDICT_CASH_FEE_RATE } = {}) {
  let p = Number(probability);
  if (!(p > 0 && p < 1)) {
    const sticker = coerceUnderdogFeeInputToAmerican(stickerAmerican);
    p = sticker == null ? NaN : contractProbabilityFromKalshiSticker(sticker);
  }
  if (!(p > 0 && p < 1)) return null;
  const s = Number(stake);
  const r = Number(rate);
  if (!(s > 0) || !(r >= 0)) return null;
  const effPrice = p * (1 + r * (1 - p));
  if (!(effPrice > 0 && effPrice < 1)) return null;
  const contracts = s / effPrice;
  const fee = r * contracts * p * (1 - p);
  const decimal = contracts / s;
  const american = decimalToAmerican(decimal);
  if (american == null) return null;
  return { probability: p, stake: s, rate: r, contracts, fee, decimal, american };
}

function underdogPredictCashAmerican(raw, opts = {}) {
  if (raw === null || raw === undefined) return raw;
  const sticker = coerceUnderdogFeeInputToAmerican(raw);
  if (sticker == null) return Number.isFinite(Number(raw)) ? null : raw;
  const quote = underdogPredictCashQuote({
    probability: opts.probability,
    stickerAmerican: sticker,
    stake: opts.stake,
    rate: opts.rate,
  });
  if (!quote || quote.american == null) return sticker;
  return quote.american;
}

function underdogCashOfferAmerican(bookKey, american, enabled) {
  if (!enabled || bookKey !== UNDERDOG_PREDICT_BOOK_KEY || american == null) return american;
  const next = underdogPredictCashAmerican(american);
  return next == null ? american : next;
}

function applyUnderdogCashLegPrices(legs, enabled) {
  if (!enabled) return legs || [];
  return (legs || []).map((leg) => {
    if (!leg || leg.bookKey !== UNDERDOG_PREDICT_BOOK_KEY || leg.dk == null) return leg;
    const dk = underdogPredictCashAmerican(leg.dk, { probability: leg.contractProbability });
    if (dk == null || dk === leg.dk) return leg;
    return { ...leg, dk };
  });
}

module.exports = {
  UNDERDOG_PREDICT_UDX_FEE_RATE,
  UNDERDOG_PREDICT_FEE_PER_CONTRACT,
  UNDERDOG_PREDICT_CASH_FEE_RATE,
  UNDERDOG_STICKER_KALSHI_FEE_RATE,
  TYPICAL_BETSTAMP_DECIMAL_MAX,
  underdogPredictFeePerContract,
  coerceUnderdogFeeInputToAmerican,
  applyUnderdogPredictFee,
  contractProbabilityFromKalshiSticker,
  underdogPredictCashQuote,
  underdogPredictCashAmerican,
  underdogCashOfferAmerican,
  applyUnderdogCashLegPrices,
};
