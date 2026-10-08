// Novig venue helpers for the Live Trading Desk.
// Markets are UUIDs (not Polymarket slugs). Moneyline = marketType MONEY.
// Qty is 1¢-payout contracts: risk$ = qty × outcomeProb × $0.01.

import {
  DEFAULT_SIZE_DOLLARS,
  MAX_SIZE_DOLLARS,
  parseAmerican,
  impliedProbFromAmerican,
  americanFromProb,
  formatAmerican,
} from "./liveDeskPrice.js";

export { DEFAULT_SIZE_DOLLARS, MAX_SIZE_DOLLARS };

/** Novig price grid mid band step (docs). Extremes use 0.001. */
export const NOVIG_TICK = 0.005;
export const NOVIG_CONTRACT_PAYOUT = 0.01; // $0.01 per winning contract
export const NOVIG_VENUE = "novig";
export const NOVIG_MARKET_TYPES = Object.freeze([
  Object.freeze({ id: "moneyline", label: "Moneyline", marketType: "MONEY" }),
  Object.freeze({ id: "spread", label: "Spread", marketType: "SPREAD" }),
  Object.freeze({ id: "total", label: "Total", marketType: "TOTAL" }),
]);

export function isNovigMarketId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || "").trim());
}

export function protectSlugForNovig(marketId) {
  return "novig:" + String(marketId || "").trim().toLowerCase();
}

export function marketIdFromProtectSlug(slug) {
  const s = String(slug || "").trim();
  const m = /^novig:([0-9a-f-]{36})$/i.exec(s);
  return m ? m[1] : "";
}

/** Snap probability down onto Novig's three-band grid (buy never pays more). */
export function snapNovigBuyPrice(prob) {
  const p = Number(prob);
  if (!(p > 0 && p < 1)) return null;
  let milli = Math.floor(p * 1000 + 1e-9);
  if (milli < 1) milli = 1;
  if (milli > 999) milli = 999;
  if (milli > 50 && milli < 950) {
    milli = milli - (milli % 5);
    if (milli < 55) milli = 50;
  }
  return milli / 1000;
}

export function sizeToNovigQty({ dollars, outcomeProb, action } = {}) {
  const d = typeof dollars === "number" ? dollars : Number(String(dollars == null ? "" : dollars).trim());
  if (!Number.isFinite(d) || d <= 0) return { ok: false, error: "Enter a dollar size." };
  if (d > MAX_SIZE_DOLLARS + 1e-9) {
    return { ok: false, error: "Size cap is $" + MAX_SIZE_DOLLARS + " on this desk." };
  }
  const act = String(action || "buy").toLowerCase() === "sell" ? "sell" : "buy";
  let p = Number(outcomeProb);
  if (!(p > 0 && p < 1)) return { ok: false, error: "Price is not tradable." };
  // Sell outcome A at P ≡ buy opposite at 1−P; risk on sell is (1−P) of payout.
  const riskP = act === "sell" ? (1 - p) : p;
  const perContract = riskP * NOVIG_CONTRACT_PAYOUT;
  if (!(perContract > 0)) return { ok: false, error: "Price is not tradable." };
  const qty = Math.floor(d / perContract + 1e-9);
  if (!(qty >= 1)) {
    return { ok: false, error: "That size is below one Novig contract at this price." };
  }
  const riskDollars = qty * perContract;
  return {
    ok: true,
    qty,
    contracts: qty,
    riskDollars,
    riskLabel: "$" + riskDollars.toFixed(2),
  };
}

/**
 * Quote a Novig rest. Buy outcome → order on that outcomeId at snapped P.
 * Sell outcome → order on the opposite outcomeId at 1−P (Novig only has bids).
 */
export function quoteNovigRest({ american, outcome, action, dollars, longOutcomeId, shortOutcomeId } = {}) {
  const asked = parseAmerican(american);
  const side = String(outcome || "").toLowerCase() === "short" ? "short" : "long";
  const act = String(action || "buy").toLowerCase() === "sell" ? "sell" : "buy";
  if (asked == null) {
    return { ok: false, error: "Enter American odds like −150 or +130." };
  }
  const fair = impliedProbFromAmerican(asked);
  if (fair == null) return { ok: false, error: "Those American odds do not convert to a price." };
  const snappedOutcome = snapNovigBuyPrice(fair);
  if (snappedOutcome == null) return { ok: false, error: "Could not snap that price to Novig's grid." };
  // For sell, we bid the opposite at complement
  let orderProb;
  let orderOutcomeId;
  if (act === "buy") {
    orderProb = snappedOutcome;
    orderOutcomeId = side === "short" ? shortOutcomeId : longOutcomeId;
  } else {
    orderProb = snapNovigBuyPrice(1 - snappedOutcome);
    orderOutcomeId = side === "short" ? longOutcomeId : shortOutcomeId;
  }
  if (!orderOutcomeId || orderProb == null) {
    return { ok: false, error: "Missing Novig outcome for that side." };
  }
  const sized = sizeToNovigQty({ dollars, outcomeProb: snappedOutcome, action: act });
  if (!sized.ok) return sized;
  const snappedAmerican = americanFromProb(snappedOutcome);
  return {
    ok: true,
    outcome: side,
    action: act,
    askedAmerican: asked,
    snappedAmerican,
    snappedAmericanLabel: formatAmerican(snappedAmerican),
    outcomeProb: snappedOutcome,
    orderProb,
    orderPrice: orderProb.toFixed(3),
    orderOutcomeId,
    qty: sized.qty,
    contracts: sized.qty,
    riskDollars: sized.riskDollars,
    riskLabel: sized.riskLabel,
    tif: "GTC",
    postOnly: true,
  };
}

export function buildNovigOrder(quote, { tif = "GTC", postOnly = true } = {}) {
  const body = {
    outcomeId: quote.orderOutcomeId,
    price: quote.orderPrice,
    qty: quote.qty,
    tif: postOnly ? "PO" : (tif || "GTC"),
  };
  return body;
}

export function bestAskFromNovigBook(book, outcomeId, otherOutcomeId) {
  const orders = (book && book.orders) || {};
  const otherBids = orders[otherOutcomeId] || [];
  if (!otherBids.length) return null;
  const bid = Number(otherBids[0].price);
  if (!(bid > 0 && bid < 1)) return null;
  return {
    ask: Math.round((1 - bid) * 1000) / 1000,
    size: Number(otherBids[0].qty) || 0,
    bidOnOther: bid,
  };
}

export function readNovigMarket(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Market not found on Novig." };
  const outcomes = Array.isArray(raw.outcomes) ? raw.outcomes : [];
  if (outcomes.length < 2) return { ok: false, error: "Novig market is missing outcomes." };
  // Prefer home/away by name order unstable — caller should label from event.
  const a = outcomes[0];
  const b = outcomes[1];
  return {
    ok: true,
    marketId: String(raw.marketId || ""),
    eventId: String(raw.eventId || ""),
    marketType: String(raw.marketType || ""),
    status: String(raw.status || ""),
    description: String(raw.description || ""),
    strike: raw.strike,
    fee: raw.fee || null,
    tradable: String(raw.status || "").toUpperCase() === "OPEN",
    longOutcomeId: String(a.outcomeId || ""),
    shortOutcomeId: String(b.outcomeId || ""),
    longName: String(a.name || "Side A"),
    shortName: String(b.name || "Side B"),
    tick: NOVIG_TICK,
    minQty: 1,
    slug: protectSlugForNovig(raw.marketId),
    venue: NOVIG_VENUE,
  };
}

export function classifyNovigGameEvent(event) {
  if (!event || typeof event !== "object") return null;
  const league = String(event.league || "").toUpperCase();
  if (league !== "NFL") return null;
  return {
    id: String(event.eventId || ""),
    label: String(event.description || event.eventId || "NFL game"),
    startsTs: Number(event.startsTs) || 0,
    status: String(event.status || ""),
    league: "nfl",
    venue: NOVIG_VENUE,
  };
}

export function deskErrorFromNovig(err, fallback) {
  if (!err) return fallback || "Novig request failed.";
  if (err.publicMessage) return err.publicMessage;
  if (typeof err.message === "string" && err.message) {
    return err.message.replace(/^Novig [A-Z]+ \S+ \d+\s*/, "") || fallback || err.message;
  }
  return fallback || "Novig request failed.";
}
