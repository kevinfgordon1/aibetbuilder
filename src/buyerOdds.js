// What the BUYER of a Combo Lock sees, after all fees, next to what the seller keeps.
//
// Mirrors the combo-worker quote math (combo-worker/engine.js fillView):
//   fill_american is the seller's exchange price NET of their Kalshi maker fee (KFEE 0.0175).
//   1. sEff = implied prob of fill_american
//   2. sNom solves sNom − KFEE·sNom·(1−sNom) = sEff   (nominal exchange YES price)
//   3. no_bid = floor to the 0.001 grid (KALSHI_SUBCENT=1 in production; penny grid otherwise),
//      never past the target; YES quoted = 1 − no_bid
//   4. buyer pays YES + 0.07·YES·(1−YES) per contract (Kalshi taker fee, venueTakerFee.js)
// Polymarket: makers pay no fee (small rebates), so the quoted YES is sEff; the buyer pays the
// same 0.07·P·(1−P) taker schedule. Per-contract estimate, before Kalshi rounds the order fee
// up to the cent, so a $1 order can land a few cents either way.
import { VENUE_TAKER_FEE_RATE, effectiveTakerPrice } from "./venueTakerFee.js";
import { allInFromExchange } from "./comboCredits.js";

export const KALSHI_MAKER_FEE = 0.0175;

const num = (v) => (v == null || v === "" ? NaN : Number(v));
const impliedProb = (a) => (a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100));
export const americanFromProb = (p) => (!(p > 0 && p < 1) ? null : p < 0.5 ? Math.round((100 * (1 - p)) / p) : -Math.round((100 * p) / (1 - p)));
const fmt = (a) => (a == null ? "—" : a > 0 ? `+${a}` : `${a}`);
const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
const floor3 = (x) => Math.floor(x * 1000 + 1e-9) / 1000;

export function venueKey(venue) {
  return String(venue || "").toLowerCase().includes("poly") ? "polymarket" : "kalshi";
}

function nominalProbFromEff(sEff, k = KALSHI_MAKER_FEE) {
  const b = 1 - k;
  return (-b + Math.sqrt(b * b + 4 * k * sEff)) / (2 * k);
}

/** YES price the worker posts for a lock at fill_american (Kalshi grid). */
export function quotedYesPrice(fillAmerican, { venue = "kalshi", subcent = true } = {}) {
  const a = num(fillAmerican);
  if (!Number.isFinite(a) || a === 0 || (a > -100 && a < 100)) return null;
  const sEff = impliedProb(a);
  if (venueKey(venue) === "polymarket") return sEff;
  const target = 1 - nominalProbFromEff(sEff);
  let no = subcent ? floor3(target) : floor2(target);
  if (subcent && no > target + 1e-12) no = Math.round((no - 0.001) * 1000) / 1000;
  if (subcent && no > 0.99) no = 0.99;
  const yes = Math.round((1 - no) * 1000) / 1000;
  return yes > 0 && yes < 1 ? yes : null;
}

/** Buyer's odds after their taker fee, from a YES price (0–1). */
export function buyerSeesFromYes(yes, venue = "kalshi") {
  const rate = VENUE_TAKER_FEE_RATE[venueKey(venue)];
  const eff = effectiveTakerPrice(yes, rate);
  const american = eff == null ? null : americanFromProb(eff);
  return american == null ? null : { american, text: fmt(american), yes: Number(yes), allInPrice: eff };
}

/** Buyer's odds after all fees for a lock / quote at fill_american. */
export function buyerSeesAfterFees(fillAmerican, opts = {}) {
  const yes = quotedYesPrice(fillAmerican, opts);
  return yes == null ? null : buyerSeesFromYes(yes, opts.venue);
}

/** Buyer's odds after fees from the NO price we bid (quote history rows). */
export function buyerSeesFromNoPrice(noPrice, venue = "kalshi") {
  const n = num(noPrice);
  if (!(n > 0 && n < 1)) return null;
  return buyerSeesFromYes(Math.round((1 - n) * 10000) / 10000, venue);
}

/** What the seller keeps: all-in after the 1% Combo Locks fee when fees are on, else the exchange price. */
export function sellerKeeps(fillAmerican, { feeRate = 0 } = {}) {
  const a = num(fillAmerican);
  if (!Number.isFinite(a) || a === 0) return null;
  const keep = feeRate > 0 ? allInFromExchange(a, feeRate) : a;
  return keep == null ? null : { american: keep, text: fmt(keep) };
}

export const youKeepLabel = (k) => (k ? `You keep ${k.text}` : "");
export const buyerSeesLabel = (b) => (b ? `Buyer sees ${b.text} after fees` : "");
export const BUYER_SEES_TITLE =
  "The odds a bettor buying this parlay on Kalshi/Polymarket actually gets: our quoted price plus their 7% taker fee (0.07 × price × (1 − price) per contract). Lower than what you keep because both sides pay fees.";
