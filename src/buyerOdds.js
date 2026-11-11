import { fallbackMakerRate, kalshiTakerRate } from './kalshiFees.js';
// What the BUYER of a Combo Lock sees, after all fees, next to what the seller keeps.
//
// Mirrors the combo-worker quote math (combo-worker/engine.js fillView):
//   fill_american is the seller's exchange price NET of their Kalshi maker fee k, which is per
//   series (Kalshi GET /series fee_type × fee_multiplier, see makerRateFromSeries):
//     quadratic → 0 · quadratic_with_maker_fees → 0.0175×M · quadratic_with_combo_maker_fees → 0.035×M
//   Unknown / not loaded → conservative 0.035 (same as the worker's fallback).
//   1. sEff = implied prob of fill_american
//   2. sNom solves sNom − k·sNom·(1−sNom) = sEff   (nominal exchange YES price)
//   3. no_bid = floor to the 0.001 grid (KALSHI_SUBCENT=1 in production; penny grid otherwise),
//      never past the target; YES quoted = 1 − no_bid
//   4. buyer pays YES + 0.07·YES·(1−YES) per contract (Kalshi taker fee, venueTakerFee.js)
// Polymarket US combos: no maker rebate. Maker fee is $0 before 2026-11-14T05:00:00Z and
// 0.03×C×p×(1−p) after (polyComboMakerFee.js). The quoted YES is the gross price that still
// nets sEff. The buyer pays the combo taker curve P·[0.095(1−P) + 0.06(1−P)^4].
// Single-market Polymarket maker fees stay $0. Per-contract estimate.
import { VENUE_TAKER_FEE_RATE, effectiveTakerPrice, polyComboTakerFeePerContract } from "./venueTakerFee.js";
import { allInFromExchange } from "./comboCredits.js";
import { isPolyComboSlug, polyComboMakerRate, polyComboPriceForNet } from "./polyComboMakerFee.js";

export const FALLBACK_MAKER_RATE = 0.035;

export function makerRateFromSeries(feeType, multiplier) {
  const m = Number(multiplier);
  const mult = Number.isFinite(m) && m >= 0 ? m : 1;
  switch (String(feeType || "")) {
    case "quadratic": return 0;
    case "quadratic_with_maker_fees": return 0.0175 * mult;
    case "quadratic_with_combo_maker_fees": return 0.035 * mult;
    default: return FALLBACK_MAKER_RATE;
  }
}

/** "KXMVECROSSCATEGORY0-S2026…-D44B…" → "KXMVECROSSCATEGORY0". caoc-/crossd- are Polymarket combos. */
export const isPolyComboTicker = (ticker) => isPolyComboSlug(ticker);
export function seriesOfTicker(ticker) {
  if (isPolyComboTicker(ticker)) return null;
  const t = String(ticker || "").trim().toUpperCase();
  return t ? t.split("-")[0] || null : null;
}

// Module cache filled by loadSeriesFees (one fetch per series per page load).
export const SERIES_FEE_TTL_MS = 15 * 60 * 1000;
const seriesRates = new Map();
const fallbackWarnedAt = new Map();
export function setSeriesFee(series, feeType, multiplier, observedAt = Date.now()) {
  if (series) seriesRates.set(String(series).toUpperCase(), { rate: makerRateFromSeries(feeType, multiplier), takerRate:kalshiTakerRate(series,{fee_multiplier:multiplier}), at: Math.min(Date.now(), Number(observedAt) || Date.now()) });
}
export function makerRateForTicker(ticker) {
  // Not a Kalshi series. The Polymarket combo maker schedule is polyComboMakerRate, not this cache.
  if (isPolyComboTicker(ticker)) return 0;
  const s = seriesOfTicker(ticker);
  const hit = seriesRates.get(s);
  if (hit && Date.now()-hit.at < SERIES_FEE_TTL_MS) return hit.rate;
  const lastWarn=fallbackWarnedAt.get(s);
  if (lastWarn == null || Date.now()-lastWarn >= SERIES_FEE_TTL_MS) {
    console.warn(`Kalshi fee fallback ${s || ticker}: missing/expired series terms`);
    fallbackWarnedAt.set(s,Date.now());
  }
  return fallbackMakerRate(s);
}
// Same terms for the live odds board, without borrowing a different series' multiplier.
export function cachedSeriesTakerRate(ticker) {
  const hit=seriesRates.get(seriesOfTicker(ticker));
  return hit && Date.now()-hit.at < SERIES_FEE_TTL_MS ? hit.takerRate : null;
}
/** Fetch fee terms for every series behind these combo tickers (same-origin /api/kalshi-series-fee). */
const seriesLoadInFlight = new Map();
const seriesLastAttempt = new Map();
export async function loadSeriesFees(tickers, fetchImpl = (typeof fetch === "function" ? fetch : null)) {
  const want = [...new Set((tickers || []).map(seriesOfTicker).filter(s => s &&
    (!seriesRates.has(s) || Date.now()-seriesRates.get(s).at >= SERIES_FEE_TTL_MS)))].sort();
  if (!want.length || !fetchImpl) return false;
  const key=want.join(',');
  if (seriesLoadInFlight.has(key)) return seriesLoadInFlight.get(key);
  const due=want.filter(s=>!seriesLastAttempt.has(s) || Date.now()-seriesLastAttempt.get(s)>=60000);
  if (!due.length) return false;
  due.forEach(s=>seriesLastAttempt.set(s,Date.now()));
  const request=(async()=>{
    try {
      const response=await fetchImpl(`/api/kalshi-series-fee?series=${encodeURIComponent(due.join(','))}`, {signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const json=await response.json();
      let updated=false;
      for (const [series,terms] of Object.entries((json && json.series) || {})) {
        if (!['quadratic','quadratic_with_maker_fees','quadratic_with_combo_maker_fees'].includes(terms.fee_type)) continue;
        setSeriesFee(series,terms.fee_type,terms.fee_multiplier,terms.fetched_at);
        updated=true;
      }
      return updated;
    } catch (error) {
      console.warn(`Kalshi series fees refresh failed; using bounded fallback: ${error.message}`);
      return false;
    } finally { seriesLoadInFlight.delete(key); }
  })();
  seriesLoadInFlight.set(key,request);
  return request;
}
function makerRateOf(opts) {
  if (opts && opts.makerRate != null && Number.isFinite(Number(opts.makerRate))) return Number(opts.makerRate);
  return makerRateForTicker(opts && opts.ticker);
}

const num = (v) => (v == null || v === "" ? NaN : Number(v));
const impliedProb = (a) => (a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100));
export const americanFromProb = (p) => (!(p > 0 && p < 1) ? null : p < 0.5 ? Math.round((100 * (1 - p)) / p) : -Math.round((100 * p) / (1 - p)));
const fmt = (a) => (a == null ? "—" : a > 0 ? `+${a}` : `${a}`);
const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
const floor3 = (x) => Math.floor(x * 1000 + 1e-9) / 1000;

export function venueKey(venue) {
  return String(venue || "").toLowerCase().includes("poly") ? "polymarket" : "kalshi";
}

function nominalProbFromEff(sEff, k) {
  if (!(k > 0)) return sEff;
  const b = 1 - k;
  return (-b + Math.sqrt(b * b + 4 * k * sEff)) / (2 * k);
}

/** YES price the worker posts for a lock at fill_american (Kalshi grid). */
export function quotedYesPrice(fillAmerican, opts = {}) {
  const { venue = "kalshi", subcent = true } = opts;
  const a = num(fillAmerican);
  if (!Number.isFinite(a) || a === 0 || (a > -100 && a < 100)) return null;
  const sEff = impliedProb(a);
  if (venueKey(venue) === "polymarket") {
    // An explicit single-market ticker is not the combo maker schedule.
    if (opts.ticker && !isPolyComboSlug(opts.ticker)) return sEff;
    const rate = polyComboMakerRate(opts.at);
    if (!(rate > 0)) return sEff;
    const gross = polyComboPriceForNet(sEff, rate);
    if (!(gross > 0 && gross < 1)) return null;
    const tick = 0.0001;
    const yes = Math.round(Math.ceil(gross / tick - 1e-12) * tick * 10000) / 10000;
    return yes > 0 && yes < 1 ? yes : null;
  }
  const target = 1 - nominalProbFromEff(sEff, makerRateOf(opts));
  let no = subcent ? floor3(target) : floor2(target);
  if (subcent && no > target + 1e-12) no = Math.round((no - 0.001) * 1000) / 1000;
  if (subcent && no > 0.99) no = 0.99;
  const yes = Math.round((1 - no) * 1000) / 1000;
  return yes > 0 && yes < 1 ? yes : null;
}

/** Buyer's odds after their taker fee, from a YES price (0–1). */
export function buyerSeesFromYes(yes, venue = "kalshi") {
  const y = Number(yes);
  let eff;
  if (venueKey(venue) === "polymarket") {
    eff = y > 0 && y < 1 ? y + polyComboTakerFeePerContract(y) : null;
    if (!(eff > 0 && eff < 1)) eff = null;
  } else {
    eff = effectiveTakerPrice(y, VENUE_TAKER_FEE_RATE.kalshi);
  }
  const american = eff == null ? null : americanFromProb(eff);
  return american == null ? null : { american, text: fmt(american), yes: Number(yes), allInPrice: eff };
}

/** What a maker who sold at this YES price keeps, net of their maker fee (same basis as fill_american / "You keep"). */
export function makerKeepsFromYes(yes, opts = {}) {
  const y = Number(yes);
  if (!(y > 0 && y < 1)) return null;
  const poly = venueKey(opts.venue) === "polymarket";
  const k = poly
    ? (opts.ticker && !isPolyComboSlug(opts.ticker) ? 0 : polyComboMakerRate(opts.at))
    : makerRateOf(opts);
  const american = americanFromProb(y - k * y * (1 - y));
  return american == null ? null : { american, text: fmt(american) };
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

/** Seller sale price: all-in after the 1% Combo Locks fee when fees are on, else the exchange price. */
export function sellerKeeps(fillAmerican, { feeRate = 0 } = {}) {
  const a = num(fillAmerican);
  if (!Number.isFinite(a) || a === 0) return null;
  const keep = feeRate > 0 ? allInFromExchange(a, feeRate) : a;
  return keep == null ? null : { american: keep, text: fmt(keep) };
}

export const youKeepLabel = (k) => (k ? `Your sale price ${k.text}` : "");
export const buyerSeesLabel = (b) => (b ? `Buyer sees ${b.text} after fees` : "");
export const BUYER_SEES_TITLE =
  "The odds a bettor buying this parlay actually gets: our quoted price plus their taker fee (Kalshi 0.07 × price × (1 − price); Polymarket combos price × [0.095(1 − price) + 0.06(1 − price)^4]). Lower than your sale price because the buyer pays a fee on top.";
