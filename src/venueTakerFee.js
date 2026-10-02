// Taker fee for the New Odds Board. One coefficient per venue.
//
// Fee per $1 contract is rate × P × (1−P). The number on the board is the
// cost to take: P + rate·P·(1−P), converted to American odds.
//
// Kalshi's published taker fee uses this 0.07 rate and rounds the order
// fee up to the next cent (orderTakerFeeDollars). The cell has no order
// size, so it shows the per-contract rate.
//
// Polymarket US: a 250-contract aggressor fill at 0.355 was charged $3.98,
// which is 0.0695×P×(1−P) rounded up to the cent. Makers received small
// rebates. The board uses the 0.07 schedule for both venues.
//
// Novig: live (in-game) straight trades only. Taker fee = c × P × (1−P) per
// contract, added to the cost (help.novig: "added on top of the trade price").
// c is the market's own fee.coefficient (0.03; 0.06 for NCAAF live spreads and
// totals). Pregame Novig takes are fee-free, so pregame stays raw. Novig's
// book shows pre-fee prices; the order slip's Payout uses P + fee. The rate is
// per quote (novigLiveFeeRate), not a static venue rate, so it is not in the map.
//
// Underdog's phone price already includes its fee. It is not in this map.

import { impliedProbToAmerican } from "./blendAskLadder.js";

export const VENUE_TAKER_FEE_RATE = Object.freeze({
  polymarket: 0.07,
  kalshi: 0.07,
});

export const TAKER_FEE_LEGEND = "Poly/Kalshi prices include taker fee · Novig LIVE prices include live fee";

export const NOVIG_LIVE_FEE_COEFFICIENT = 0.03;
export const NOVIG_LIVE_FEE_COEFFICIENT_NCAAF_LINES = 0.06;

// Default when a Novig quote carries no fee_coefficient (older relay build).
export function novigDefaultFeeCoefficient(quote) {
  const league = String((quote && quote.league) || "").toUpperCase();
  const type = String((quote && quote.bet_type) || "moneyline").toLowerCase();
  if (league === "NCAAF" && (type === "spread" || type === "total")) return NOVIG_LIVE_FEE_COEFFICIENT_NCAAF_LINES;
  return NOVIG_LIVE_FEE_COEFFICIENT;
}

// Fee coefficient for one Novig relay quote, or null when no fee applies.
// Only a quote Novig itself reports as in-game (is_live === true) is charged.
export function novigLiveFeeRate(quote) {
  if (!quote || quote.is_live !== true) return null;
  const c = Number(quote.fee_coefficient);
  if (quote.fee_coefficient != null && quote.fee_coefficient !== "" && Number.isFinite(c)) return c > 0 ? c : null;
  return novigDefaultFeeCoefficient(quote);
}

// takerFeeRate("kalshi") is the static venue rate. Novig has no static rate:
// pass { live: true, coefficient } for a live Novig take; anything else is null.
export function takerFeeRate(bookKey, opts) {
  const key = String(bookKey || "").toLowerCase();
  if (key === "novig") {
    if (!opts || opts.live !== true) return null;
    const c = Number(opts.coefficient);
    return Number.isFinite(c) && c > 0 ? c : NOVIG_LIVE_FEE_COEFFICIENT;
  }
  const rate = VENUE_TAKER_FEE_RATE[key];
  return rate == null ? null : rate;
}

export function takerFeePerContract(price, rate) {
  const p = Number(price);
  const r = Number(rate);
  if (!(p > 0 && p < 1) || !(r > 0)) return 0;
  return r * p * (1 - p);
}

// Whole-order taker fee, rounded up to the next cent. Kalshi invoices this way.
export function orderTakerFeeDollars(contracts, price, rate) {
  const c = Number(contracts);
  const raw = c * takerFeePerContract(price, rate);
  if (!(raw > 0)) return 0;
  return Math.ceil(raw * 100 - 1e-9) / 100;
}

export function effectiveTakerPrice(price, rate) {
  const p = Number(price);
  if (!(p > 0 && p < 1)) return null;
  const eff = p + takerFeePerContract(p, rate);
  if (!(eff > 0 && eff < 1)) return null;
  return eff;
}

// american is the fee-inclusive price. rawAmerican is the ask before the fee.
export function feeInclusiveAmerican(price, rate) {
  const p = Number(price);
  const rawAmerican = impliedProbToAmerican(p);
  const effective = effectiveTakerPrice(p, rate);
  const american = effective == null ? null : impliedProbToAmerican(effective);
  return { american, rawAmerican, effectivePrice: effective };
}

// Board price for a Novig relay quote. odds is the 0–1 pre-fee ask. A live
// quote is painted at P + c·P·(1−P) (rawAmerican keeps the ask); a pregame
// quote stays raw (rawAmerican null).
export function novigQuotePrice(quote) {
  let p = Number(quote && quote.odds);
  const given = Number(quote && quote.american);
  const hasGiven = quote && quote.american != null && Number.isFinite(given) && given !== 0;
  if (!(p > 0 && p < 1) && hasGiven) p = given > 0 ? 100 / (given + 100) : Math.abs(given) / (Math.abs(given) + 100);
  if (!(p > 0 && p < 1)) return { american: null, rawAmerican: null, effectivePrice: null };
  const raw = hasGiven ? Math.round(given) : impliedProbToAmerican(p);
  const rate = novigLiveFeeRate(quote);
  if (rate == null) return { american: raw, rawAmerican: null, effectivePrice: p };
  const priced = feeInclusiveAmerican(p, rate);
  return { american: priced.american, rawAmerican: raw, effectivePrice: priced.effectivePrice };
}
