// Open-order tags on the Live Trading Desk (Polymarket US).
// "Taker gets": what a taker receives by filling this order, after the
// Polymarket US taker fee 0.05 × P × (1 − P), the same coefficient as
// lib/odds-shared.js (effective = p × (1 + 0.05 × (1 − p))).
//   Buy X at p  → taker buys the other side at 1 − p.
//   Sell X at p → taker buys X at p.
// "Best"/"Behind": compare that taker price to the best taker price on the
// same side of the live book (best ask on the taker's outcome), also after fees.
import { americanFromProb, formatAmerican } from "./liveDeskPrice.js";
import { effectiveTakerPrice } from "./venueTakerFee.js";

const EPS = 1e-9;
export const DESK_TAKER_FEE_RATE = 0.05;
const RATE = DESK_TAKER_FEE_RATE;

function am(p) {
  return p > 0 && p < 1 ? formatAmerican(americanFromProb(p)) : "";
}

// Outcome-side bid/ask from the YES book.
export function outcomeBook(outcome, yesBid, yesAsk) {
  const b = Number(yesBid);
  const a = Number(yesAsk);
  const bid = b > 0 && b < 1 ? b : null;
  const ask = a > 0 && a < 1 ? a : null;
  if (outcome === "short") return { bid: ask == null ? null : 1 - ask, ask: bid == null ? null : 1 - bid };
  return { bid, ask };
}

export function takerSidePrice(action, price) {
  const p = Number(price);
  if (!(p > 0 && p < 1)) return null;
  return action === "sell" ? p : 1 - p;
}

export function orderTags({ action, outcome, price, yesBid, yesAsk, tick, takerName } = {}) {
  const raw = takerSidePrice(action, price);
  if (raw == null) return null;
  const eff = effectiveTakerPrice(raw, RATE);
  const out = {
    takerName: takerName || "",
    takerRaw: raw,
    takerEff: eff,
    takerAmerican: am(eff),
    takerRawAmerican: am(raw),
    status: "unknown",
  };
  const ob = outcomeBook(outcome, yesBid, yesAsk);
  // Best taker price on the taker's outcome = best ask there.
  const mRaw = action === "sell" ? ob.ask : (ob.bid == null ? null : 1 - ob.bid);
  if (mRaw == null) return out;
  const mEff = effectiveTakerPrice(mRaw, RATE);
  out.marketRaw = mRaw;
  out.marketEff = mEff;
  out.marketAmerican = am(mEff);
  out.marketRawAmerican = am(mRaw);
  const t = Number(tick) > 0 ? Number(tick) : 0.01;
  if (raw < mRaw - EPS) out.status = "best";
  else if (Math.abs(raw - mRaw) <= EPS) out.status = "tied";
  else {
    out.status = "behind";
    out.behindCents = Math.round((raw - mRaw) * 10000) / 100;
    // Price to rest at to be the best by one tick, on your own side.
    const target = action === "sell" ? ob.ask - t : ob.bid + t;
    if (target > 0 && target < 1) {
      out.toBeBestPrice = target;
      out.toBeBestAmerican = am(target);
      out.toBeBestCents = Math.round(target * 10000) / 100;
    }
  }
  return out;
}

export function orderTagLine(tags, action) {
  if (!tags) return "";
  const who = tags.takerName ? tags.takerName + " " : "";
  let s = "Taker gets " + who + tags.takerRawAmerican + " before fees / " + tags.takerAmerican + " after";
  const mkt = () => "market " + tags.marketAmerican + " after fees (" + tags.marketRawAmerican + " before)";
  if (tags.status === "best") s += " · Best price: " + mkt();
  else if (tags.status === "tied") s += " · Best price, tied at top: " + mkt();
  else if (tags.status === "behind") {
    s += " · Behind best by " + tags.behindCents + "¢: " + mkt();
    if (tags.toBeBestAmerican) s += "; " + (action === "sell" ? "sell at " : "bid ") + tags.toBeBestCents + "¢ (" + tags.toBeBestAmerican + ") to be best";
  } else s += " · live book unavailable";
  return s;
}
