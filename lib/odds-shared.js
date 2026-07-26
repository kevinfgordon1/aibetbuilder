// Shared helpers for the odds-fetch serverless functions (fetch-odds, fetch-futures).
// Lives OUTSIDE /api so Vercel never exposes it as an HTTP endpoint; both functions
// `require('../lib/odds-shared')`.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─────────────────────────────────────────────────────────────────────────
// Prediction-market taker-fee adjustment (Kalshi + Polymarket)
//
// Both venues charge a taker fee of  θ · C · p · (1−p)  per fill, where p is the
// contract price in dollars (0–1) and C the number of contracts. Crucially the
// fee is paid UP FRONT — added to your cost — not netted out of the payout. So
// for $1 of payout the effective cost per contract is:
//     p_eff = p · (1 + θ·(1−p))
// and the effective decimal odds are 1 / p_eff. This reproduces the venue's own
// "stake → to-win" math exactly (verified against Polymarket US: a 37¢ ask shows
// +170 raw but pays +162 after the $3.05 taker fee on a ~$100 / 262-contract order).
//
// The raw price has no fee baked in, so we bake it in here.
// θ: Kalshi 0.07, Polymarket US regulated exchange 0.05 (uniform taker).
// ─────────────────────────────────────────────────────────────────────────
const KALSHI_FEE_COEFF = 0.07;
const POLYMARKET_FEE_COEFF = 0.05;

function applyTakerFee(rawAmericanOdds, theta) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  // Implied price (probability) of the quoted odds.
  let p;
  if (rawAmericanOdds > 0) {
    p = 100 / (rawAmericanOdds + 100);
  } else {
    p = Math.abs(rawAmericanOdds) / (Math.abs(rawAmericanOdds) + 100);
  }
  if (p <= 0 || p >= 1) return rawAmericanOdds;
  // Taker fee is added to cost → effective price, then convert back to odds.
  const effPrice = p * (1 + theta * (1 - p));
  const decimalOdds = 1 / effPrice;
  if (decimalOdds <= 1) return rawAmericanOdds;
  if (decimalOdds >= 2) return Math.round((decimalOdds - 1) * 100);
  return -Math.round(100 / (decimalOdds - 1));
}

function applyKalshiFee(rawAmericanOdds) {
  return applyTakerFee(rawAmericanOdds, KALSHI_FEE_COEFF);
}

// ─────────────────────────────────────────────────────────────────────────
// ProphetX commission adjustment — ProphetX takes 2% on net winnings only.
// ─────────────────────────────────────────────────────────────────────────
const PROPHETX_COMMISSION_RATE = 0.02; // 2%

function applyProphetXCommission(rawAmericanOdds) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  // Convert American to decimal
  let rawDecimal;
  if (rawAmericanOdds > 0) {
    rawDecimal = 1 + rawAmericanOdds / 100;
  } else {
    rawDecimal = 1 + 100 / Math.abs(rawAmericanOdds);
  }
  // Apply commission to winnings only (decimal - 1 = profit per $1 staked)
  const effectiveDecimal = 1 + (rawDecimal - 1) * (1 - PROPHETX_COMMISSION_RATE);
  if (effectiveDecimal <= 1) return rawAmericanOdds;
  // Convert back to American
  let adjustedAmerican;
  if (effectiveDecimal >= 2) {
    adjustedAmerican = Math.round((effectiveDecimal - 1) * 100);
  } else {
    adjustedAmerican = -Math.round(100 / (effectiveDecimal - 1));
  }
  return adjustedAmerican;
}

function applyPolymarketFee(rawAmericanOdds) {
  return applyTakerFee(rawAmericanOdds, POLYMARKET_FEE_COEFF);
}

// ─────────────────────────────────────────────────────────────────────────
// Apply per-book fee/commission adjustments to a sport's raw data.
// Handles: kalshi (fee schedule) + prophetx (2% commission) + polymarket (taker fee).
// ─────────────────────────────────────────────────────────────────────────
function applyBookAdjustments(sportData) {
  if (!Array.isArray(sportData)) return sportData;
  return sportData.map(game => {
    if (!game.bookmakers) return game;
    return {
      ...game,
      bookmakers: game.bookmakers.map(bookmaker => {
        let adjustFn = null;
        if (bookmaker.key === 'kalshi') {
          adjustFn = applyKalshiFee;
        } else if (bookmaker.key === 'prophetx') {
          adjustFn = applyProphetXCommission;
        } else if (bookmaker.key === 'polymarket') {
          adjustFn = applyPolymarketFee;
        } else {
          return bookmaker;
        }
        return {
          ...bookmaker,
          markets: (bookmaker.markets || []).map(market => ({
            ...market,
            outcomes: (market.outcomes || []).map(outcome => ({
              ...outcome,
              price: adjustFn(outcome.price),
            })),
          })),
        };
      }),
    };
  });
}

module.exports = { supabase, applyBookAdjustments };
