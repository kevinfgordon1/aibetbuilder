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
// Underdog's phone price already includes its fee. It is not in this map.

import { impliedProbToAmerican } from "./blendAskLadder.js";

export const VENUE_TAKER_FEE_RATE = Object.freeze({
  polymarket: 0.07,
  kalshi: 0.07,
});

export const TAKER_FEE_LEGEND = "Poly/Kalshi prices include taker fee";

export function takerFeeRate(bookKey) {
  const rate = VENUE_TAKER_FEE_RATE[String(bookKey || "").toLowerCase()];
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
