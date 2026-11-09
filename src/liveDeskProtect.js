// Adverse Protect for the Live Trading Desk.
//
// Armed rests are watched against the market mid (YES best bid/ask average).
// If the resting outcome price is more than X cents through that mid, it is
// a stale gift — cancel it. Then re-rest better (buy lower / sell higher) at
// the new outcome mid ± Y cents, snapped with the same tick-in-his-favor rule
// as Desk V1. A move away from the rest (no longer through mid) is parked.
// Protect does not chase.

import {
  MAX_SIZE_DOLLARS,
  snapFavorableFromMicro,
  sizeToContracts,
  formatAmerican,
  americanFromMicro,
  americanFromProb,
  formatCentsFromMicro,
  normalizeAction,
  normalizeOutcome,
} from "./liveDeskPrice.js";

export const DEFAULT_PROTECT_X_CENTS = 2;
export const DEFAULT_PROTECT_Y_CENTS = 0.5;
export const MAX_PROTECTS_PER_LINEAGE = 8;
export const PROTECT_COOLDOWN_MS = 1000;
export const PROTECT_STALE_SWEEP_MS = 15000;

// Through-mid of 0 would cancel on any touch of the mid. A tenth of a cent
// is the smallest cushion the desk accepts.
export const PROTECT_X_MIN_CENTS = 0.1;
// Re-rest of 0 stays at the new mid, then the tick snaps in the trader's favor.
export const PROTECT_Y_MIN_CENTS = 0;
export const PROTECT_MAX_CENTS = 25;
// Tenth-of-a-cent grid, matching parseProtectCents. An HTML number input's
// step is counted from min (the step base), not from zero. step 0.5 with
// min 0.1 rejects the default 2¢ through-mid: the nearest legal values are
// 1.6 and 2.1, and the browser never fires the confirm submit.
export const PROTECT_CENTS_STEP = 0.1;

const MICRO = 1_000_000;

export function centsToMicro(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10_000);
}

export function parseProtectCents(raw, fallback, { min = 0, max = PROTECT_MAX_CENTS } = {}) {
  if (raw == null || raw === "") {
    if (fallback == null || !Number.isFinite(Number(fallback))) {
      return { ok: false, error: "Enter Bet Protect cents." };
    }
    return { ok: true, cents: Number(fallback) };
  }
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return { ok: false, error: "Bet Protect cents must be a number." };
  const cents = Math.round(n * 10) / 10;
  if (cents < min || cents > max) {
    return { ok: false, error: "Bet Protect cents must be between " + min + " and " + max + "." };
  }
  return { ok: true, cents };
}

const NUMBER_INPUT_PLACES = 10;
const NUMBER_INPUT_SCALE = 10n ** BigInt(NUMBER_INPUT_PLACES);

// Decimal string → scaled integer. Binary floats such as 0.1 stringify to a
// short decimal ("0.1") before scaling, which is how Chrome parses the min
// and step attributes.
function scaledDecimal(raw) {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    raw = String(raw);
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const neg = s.startsWith("-");
  const body = s.replace(/^[+-]/, "");
  const [whole, frac = ""] = body.split(".");
  if (frac.length > NUMBER_INPUT_PLACES) return null;
  const digits = (frac + "0".repeat(NUMBER_INPUT_PLACES)).slice(0, NUMBER_INPUT_PLACES);
  let scaled = BigInt(whole || "0") * NUMBER_INPUT_SCALE + BigInt(digits || "0");
  if (neg) scaled = -scaled;
  return scaled;
}

function unscaledDecimal(scaled) {
  const neg = scaled < 0n;
  const v = neg ? -scaled : scaled;
  const whole = v / NUMBER_INPUT_SCALE;
  const frac = (v % NUMBER_INPUT_SCALE).toString().padStart(NUMBER_INPUT_PLACES, "0").replace(/0+$/, "");
  const text = frac ? whole.toString() + "." + frac : whole.toString();
  return neg ? -Number(text) : Number(text);
}

function floorDiv(a, b) {
  const q = a / b;
  if (a % b !== 0n && (a < 0n) !== (b < 0n)) return q - 1n;
  return q;
}

/**
 * HTML number-input constraint check. Step base is min when min is set,
 * otherwise 0. A value is step-aligned when (value - stepBase) is an
 * integral multiple of step. validationMessage matches Chrome's wording
 * for range and step mismatch.
 */
export function browserNumberInputValidity(raw, { min, max, step } = {}) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, empty: true, validationMessage: "" };
  }
  const value = scaledDecimal(raw);
  if (value == null) {
    return { ok: false, reason: "badInput", validationMessage: "Please enter a number." };
  }
  const minS = min == null || min === "" ? null : scaledDecimal(min);
  const maxS = max == null || max === "" ? null : scaledDecimal(max);
  if ((min != null && min !== "" && minS == null) || (max != null && max !== "" && maxS == null)) {
    return { ok: false, reason: "badInput", validationMessage: "Please enter a number." };
  }
  if (minS != null && value < minS) {
    return {
      ok: false,
      reason: "rangeUnderflow",
      validationMessage: "Value must be greater than or equal to " + unscaledDecimal(minS) + ".",
    };
  }
  if (maxS != null && value > maxS) {
    return {
      ok: false,
      reason: "rangeOverflow",
      validationMessage: "Value must be less than or equal to " + unscaledDecimal(maxS) + ".",
    };
  }
  if (step == null || step === "" || step === "any") return { ok: true, validationMessage: "" };
  const stepS = scaledDecimal(step);
  if (stepS == null || stepS <= 0n) {
    return { ok: false, reason: "badInput", validationMessage: "Please enter a number." };
  }
  const base = minS != null ? minS : 0n;
  const delta = value - base;
  if (delta % stepS === 0n) return { ok: true, validationMessage: "" };
  const q = floorDiv(delta, stepS);
  const lower = base + q * stepS;
  const upper = lower + stepS;
  const nearest = [];
  if ((minS == null || lower >= minS) && (maxS == null || lower <= maxS)) nearest.push(unscaledDecimal(lower));
  if ((minS == null || upper >= minS) && (maxS == null || upper <= maxS)) nearest.push(unscaledDecimal(upper));
  let validationMessage = "Please enter a valid value.";
  if (nearest.length === 2) {
    validationMessage = "Please enter a valid value. The two nearest valid values are " + nearest[0] + " and " + nearest[1] + ".";
  } else if (nearest.length === 1) {
    validationMessage = "Please enter a valid value. The nearest valid value is " + nearest[0] + ".";
  }
  return { ok: false, reason: "stepMismatch", nearest, validationMessage };
}

export function protectCentsInputBounds(kind) {
  return {
    min: kind === "y" ? PROTECT_Y_MIN_CENTS : PROTECT_X_MIN_CENTS,
    max: PROTECT_MAX_CENTS,
    step: PROTECT_CENTS_STEP,
  };
}

function protectFlagOff(flag) {
  if (flag === false || flag === 0) return true;
  if (typeof flag === "string") {
    const s = flag.trim().toLowerCase();
    return s === "0" || s === "false" || s === "off" || s === "no";
  }
  return false;
}

export function protectOverCapNote(cap = MAX_SIZE_DOLLARS) {
  return "Over the $" + cap + " Bet Protect cap, so this order rests unprotected.";
}

/**
 * Bet Protect is ON by default for desk rests. A request that omits the flag
 * (or sends true) is armed; only an explicit off (false / 0 / "false" / "off")
 * rests unprotected. When the order risk is over the $MAX_SIZE_DOLLARS Protect
 * cap, the order still rests but unprotected, with overCap + note set so the
 * desk can say so. defaulted marks an arm that came from the default rather
 * than an explicit protect:true. Protect uses the same $MAX_SIZE_DOLLARS desk
 * cap, so that branch is a guard rather than a normal path.
 */
export function readProtectRequest(body, { riskDollars } = {}) {
  const raw = body || {};
  const flag = raw.protect;
  if (protectFlagOff(flag)) return { ok: true, on: false };
  const risk = Number(riskDollars);
  if (Number.isFinite(risk) && risk > MAX_SIZE_DOLLARS + 1e-6) {
    return { ok: true, on: false, overCap: true, note: protectOverCapNote() };
  }
  const xBounds = protectCentsInputBounds("x");
  const yBounds = protectCentsInputBounds("y");
  const x = parseProtectCents(raw.protectXCents != null ? raw.protectXCents : raw.xCents, DEFAULT_PROTECT_X_CENTS, { min: xBounds.min, max: xBounds.max });
  if (!x.ok) return { ok: false, on: true, error: "Through-mid (X): " + x.error };
  const y = parseProtectCents(raw.protectYCents != null ? raw.protectYCents : raw.yCents, DEFAULT_PROTECT_Y_CENTS, { min: yBounds.min, max: yBounds.max });
  if (!y.ok) return { ok: false, on: true, error: "Re-rest (Y): " + y.error };
  const defaulted = flag == null || flag === "";
  return { ok: true, on: true, defaulted, xCents: x.cents, yCents: y.cents };
}

function amountValue(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    const n = Number(v.value);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** YES mid from a Polymarket US BBO payload. Both sides required. */
export function yesMidFromBbo(payload) {
  const data = payload && (payload.marketData || payload.market_data || payload);
  if (!data || typeof data !== "object") return null;
  const bid = amountValue(data.bestBid != null ? data.bestBid : data.best_bid);
  const ask = amountValue(data.bestAsk != null ? data.bestAsk : data.best_ask);
  if (!(bid > 0 && bid < 1 && ask > 0 && ask < 1)) return null;
  if (ask + 1e-9 < bid) return null;
  const mid = (bid + ask) / 2;
  if (!(mid > 0 && mid < 1)) return null;
  return mid;
}

function feedAtMs(payload, data) {
  const raw = (data && (data.timestamp || data.exchangeTime || data.updatedAt || data.transactTime))
    || (payload && (payload.timestamp || payload.exchangeTime || payload.updatedAt));
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Outcome bid/ask/mid from a YES BBO. Short prices are the complement:
 * a short bid is one minus the YES ask. Both YES sides are required.
 * A crossed book or a feed timestamp older than PROTECT_FEED_STALE_MS
 * is not a signal.
 */
export function outcomeBookFromBbo(payload, outcome, nowMs) {
  const data = payload && (payload.marketData || payload.market_data || payload);
  if (!data || typeof data !== "object") return { ok: false, reason: "unpriced", stale: false };
  const yesBid = amountValue(data.bestBid != null ? data.bestBid : data.best_bid);
  const yesAsk = amountValue(data.bestAsk != null ? data.bestAsk : data.best_ask);
  if (!(yesBid > 0 && yesBid < 1 && yesAsk > 0 && yesAsk < 1) || yesAsk + 1e-9 < yesBid) {
    return { ok: false, reason: "unpriced", stale: false };
  }
  const side = normalizeOutcome(outcome);
  if (!side) return { ok: false, reason: "unpriced", stale: false };
  const bid = side === "short" ? 1 - yesAsk : yesBid;
  const ask = side === "short" ? 1 - yesBid : yesAsk;
  const mid = (bid + ask) / 2;
  const feedAt = feedAtMs(payload, data);
  const now = Number(nowMs);
  const feedAgeMs = feedAt != null && Number.isFinite(now) ? now - feedAt : null;
  const stale = feedAgeMs != null && feedAgeMs > PROTECT_FEED_STALE_MS;
  const toMicro = (p) => Math.round(p * MICRO);
  return {
    ok: !stale,
    stale,
    reason: stale ? "stale-feed" : "ok",
    bidMicro: toMicro(bid),
    askMicro: toMicro(ask),
    midMicro: toMicro(mid),
    feedAt: feedAt == null ? null : new Date(feedAt).toISOString(),
    feedAgeMs,
  };
}

function levelPrice(level) {
  if (!level || typeof level !== "object") return null;
  return amountValue(level.px != null ? level.px : level.price);
}

function levelQty(level) {
  if (!level || typeof level !== "object") return null;
  const n = Number(level.qty != null ? level.qty : level.quantity);
  return Number.isFinite(n) ? n : null;
}

function ownQtyAt(orders, yesPrice) {
  let sum = 0;
  for (const order of orders || []) {
    const px = Number(order && order.yesPrice);
    const qty = Number(order && order.leaves);
    if (!Number.isFinite(px) || !Number.isFinite(qty) || !(qty > 0)) continue;
    if (Math.abs(px - yesPrice) <= 5e-5) sum += qty;
  }
  return sum;
}

/**
 * Remaining size on one of our open orders. leavesQuantity is the official
 * remainder. quantity is the original size and is used only when the
 * payload did not include a remainder. Zero leaves stays zero.
 */
export function ownLeaves(order) {
  if (!order || typeof order !== "object") return 0;
  const leaves = Number(order.leavesQuantity);
  if (Number.isFinite(leaves) && leaves >= 0) return leaves;
  const qty = Number(order.quantity);
  return Number.isFinite(qty) && qty >= 0 ? qty : 0;
}

/**
 * One finite price in (0, 1) per level, quantities summed, best price first.
 * A book is not trusted in the order the gateway happened to send.
 * Non-finite prices, prices outside (0, 1), and negative quantities are dropped.
 */
export function normalizeBookLevels(levels, { better = "higher" } = {}) {
  const byMicro = new Map();
  for (const level of levels || []) {
    const price = levelPrice(level);
    const qty = levelQty(level);
    if (!(price > 0 && price < 1) || qty == null || qty < 0) continue;
    const micro = Math.round(price * MICRO);
    if (!(micro > 0 && micro < MICRO)) continue;
    byMicro.set(micro, (byMicro.get(micro) || 0) + qty);
  }
  const rows = [];
  for (const [micro, qty] of byMicro) rows.push({ price: micro / MICRO, qty });
  rows.sort((a, b) => (better === "lower" ? a.price - b.price : b.price - a.price));
  return rows;
}

/**
 * Best price on one side of an aggregated book after removing our own
 * leaves at each level. Documented REST books combine every order at a
 * price and do not label which quantity is ours, so this only works when
 * our orders are inside that aggregate. If our price is missing, the next
 * level is not fully explained by us, or the visible book ends on our
 * size, the result is not a signal.
 */
export function outsideTouch(levels, ownOrdersAtPrice, ourPrice, { better = "higher" } = {}) {
  const ours = Number(ourPrice);
  const rows = normalizeBookLevels(levels, { better });
  if (!(ours > 0 && ours < 1)) return { ok: false, reason: "unpriced" };
  const idx = rows.findIndex((row) => Math.abs(row.price - ours) <= 5e-5);
  if (idx < 0) {
    const ahead = rows.find((row) => (better === "higher" ? row.price > ours + 5e-5 : row.price < ours - 5e-5));
    if (ahead) return { ok: true, price: ahead.price, reason: "ahead" };
    return { ok: false, reason: "absent" };
  }
  const own = ownQtyAt(ownOrdersAtPrice, rows[idx].price);
  const outside = rows[idx].qty - own;
  if (outside < -1e-4) return { ok: false, reason: "inconsistent" };
  if (outside > 1e-4) return { ok: true, price: rows[idx].price, reason: "shared" };
  for (let i = idx + 1; i < rows.length; i += 1) {
    const nextOwn = ownQtyAt(ownOrdersAtPrice, rows[i].price);
    const nextOutside = rows[i].qty - nextOwn;
    if (nextOutside < -1e-4) return { ok: false, reason: "inconsistent" };
    if (nextOutside > 1e-4) return { ok: true, price: rows[i].price, reason: "outside" };
  }
  return { ok: false, reason: "truncated" };
}

/**
 * Cancel only when aggregate depth, after subtracting every one of our
 * remaining orders at the price, shows a worse level more than X¢ through
 * our price. A raw BBO that includes this order cannot do that.
 *
 * feedAgeMs is now minus marketData.transactTime when the payload has one.
 * Two public reads of the same book kept that field still, so it is the last
 * book change, not the time we fetched the snapshot. A quiet book therefore
 * has an old transactTime and a fresh receipt. receivedAgeMs is how long ago
 * this process finished a successful read. That is the freshness clock.
 * An old transactTime does not block a decision when the receipt is fresh.
 * A missing receipt is not a successful read. This does not invent an
 * exchange event time.
 *
 * Others still resting at our price, a level smaller than our leaves, a book
 * that ends on our size, a crossed book, or our price simply missing are not
 * signals. Own-size subtraction cannot see someone else's order that shares
 * the price, and a book that never contains our size never fires.
 */
export function evaluateBookProtect({
  outcome,
  action,
  yesPrice,
  bids,
  offers,
  ownBids,
  ownOffers,
  xCents,
  feedAgeMs,
  receivedAgeMs,
} = {}) {
  const received = receivedAgeMs == null || receivedAgeMs === "" ? null : Number(receivedAgeMs);
  const lastChange = feedAgeMs == null || feedAgeMs === "" ? null : Number(feedAgeMs);
  if (received != null && Number.isFinite(received)) {
    if (received > PROTECT_FEED_STALE_MS || received < 0) {
      return { fire: false, reason: "stale-receipt", refKind: "unsolved", lastChangeMs: Number.isFinite(lastChange) ? lastChange : null };
    }
  } else if (lastChange == null || !Number.isFinite(lastChange)) {
    return { fire: false, reason: "age-unknown", refKind: "unsolved" };
  } else if (lastChange > PROTECT_FEED_STALE_MS || lastChange < -PROTECT_FEED_STALE_MS) {
    return { fire: false, reason: "stale-feed", refKind: "unsolved" };
  }
  const yes = Number(yesPrice);
  const xMicro = centsToMicro(xCents);
  const act = normalizeAction(action);
  const side = normalizeOutcome(outcome);
  if (!(yes > 0 && yes < 1) || !act || !side || xMicro == null) {
    return { fire: false, reason: "unpriced", refKind: "unsolved" };
  }
  const bidRows = normalizeBookLevels(bids, { better: "higher" });
  const askRows = normalizeBookLevels(offers, { better: "lower" });
  const bestBid = bidRows.length ? bidRows[0].price : null;
  const bestAsk = askRows.length ? askRows[0].price : null;
  if (bestBid != null && bestAsk != null && bestBid + 1e-9 >= bestAsk) {
    return { fire: false, reason: "crossed", refKind: "unsolved" };
  }
  const bookSide = side === "short" ? (act === "buy" ? "sell" : "buy") : act;
  const levels = bookSide === "sell" ? offers : bids;
  const own = bookSide === "sell" ? ownOffers : ownBids;
  const touch = outsideTouch(levels, own, yes, { better: bookSide === "sell" ? "lower" : "higher" });
  if (!touch.ok) return { fire: false, reason: touch.reason, refKind: "unsolved", sawOwn: touch.sawOwn };
  const gap = bookSide === "sell" ? touch.price - yes : yes - touch.price;
  const gapMicro = Math.round(gap * MICRO);
  const reference = bookSide === "sell"
    ? (side === "short" ? 1 - touch.price : touch.price)
    : (side === "short" ? 1 - touch.price : touch.price);
  if (gapMicro < 0) return { fire: false, reason: "ran-away", gapMicro, refKind: touch.reason, referenceMicro: Math.round(reference * MICRO) };
  if (gapMicro <= xMicro) return { fire: false, reason: "inside", gapMicro, refKind: touch.reason, referenceMicro: Math.round(reference * MICRO) };
  return { fire: true, reason: "through", gapMicro, refKind: touch.reason, referenceMicro: Math.round(reference * MICRO) };
}

export function outcomeMidMicro(yesMid, outcome) {
  const yes = Number(yesMid);
  if (!(yes > 0 && yes < 1)) return null;
  const yesMicro = Math.round(yes * MICRO);
  if (!(yesMicro > 0 && yesMicro < MICRO)) return null;
  const side = normalizeOutcome(outcome);
  if (side === "short") return MICRO - yesMicro;
  if (side === "long") return yesMicro;
  return null;
}

/**
 * A buy is stale when it is more than X¢ above the live outcome bid.
 * A sell is stale when it is more than X¢ below the live outcome ask.
 * Mid is only the reference when that side of the book is missing, so older
 * callers keep the previous rule. Exactly X¢ does not fire. A price on the
 * safe side of the reference does not fire and is not chased.
 * Being merely near the opposite touch is not enough: a quiet market can
 * fill a rest that is still within X of the live bid or ask.
 */
export const PROTECT_FEED_STALE_MS = 8000;
export const PROTECT_TRADE_FRESH_MS = 15000;

/**
 * A public book stats block carries one last trade (lastTradePx, lastTradeSetTime).
 * It is not a tape and has no order id. Fire only when that print is recent and
 * more than X¢ through our price. A print at one of our own prices is our fill
 * or our level, not an adverse trade.
 */
export function evaluateTradeProtect({
  outcome,
  action,
  yesPrice,
  tradeYes,
  tradeAtMs,
  nowMs,
  xCents,
  ownYesPrices,
} = {}) {
  const yes = Number(yesPrice);
  const px = Number(tradeYes);
  const act = normalizeAction(action);
  const side = normalizeOutcome(outcome);
  const xMicro = centsToMicro(xCents);
  if (!(yes > 0 && yes < 1) || !(px > 0 && px < 1) || !act || !side || xMicro == null) {
    return { fire: false, reason: "no-trade" };
  }
  const at = Number(tradeAtMs);
  const now = Number(nowMs);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return { fire: false, reason: "trade-time-unknown" };
  const age = now - at;
  if (age < 0 || age > PROTECT_TRADE_FRESH_MS) return { fire: false, reason: "trade-old" };
  for (const own of ownYesPrices || []) {
    if (Math.abs(Number(own) - px) <= 5e-5) return { fire: false, reason: "own-fill" };
  }
  const tradeOutcome = side === "short" ? 1 - px : px;
  const ourOutcome = side === "short" ? 1 - yes : yes;
  const gapMicro = Math.round((act === "buy" ? ourOutcome - tradeOutcome : tradeOutcome - ourOutcome) * MICRO);
  const referenceMicro = Math.round(tradeOutcome * MICRO);
  if (gapMicro <= xMicro) return { fire: false, reason: "inside", gapMicro, referenceMicro };
  return { fire: true, reason: "trade-through", gapMicro, referenceMicro };
}

export function filledBeforeTriggerLabel({ trigger, gapCents, xCents } = {}) {
  if (String(trigger || "") !== "inside") return "";
  const gap = Number(gapCents);
  const x = Number(xCents);
  if (!Number.isFinite(gap) || !Number.isFinite(x) || gap > x) return "";
  return "Filled before Protect trigger";
}

function bookMicro(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n < MICRO ? n : null;
}

export function evaluateProtect({
  action,
  restingOutcomeMicro,
  midOutcomeMicro,
  bidMicro,
  askMicro,
  xCents,
  feedAgeMs,
} = {}) {
  const act = normalizeAction(action);
  const rest = Math.round(Number(restingOutcomeMicro));
  const xMicro = centsToMicro(xCents);
  const age = Number(feedAgeMs);
  if (Number.isFinite(age) && age > PROTECT_FEED_STALE_MS) {
    return { fire: false, reason: "stale-feed", gapMicro: null, refKind: "stale", referenceMicro: null };
  }
  const mid = bookMicro(midOutcomeMicro);
  // Raw best bid/ask is not an early signal. While this order is the touch,
  // the public price cannot print beyond it. Callers that have aggregate
  // depth use evaluateBookProtect instead.
  const reference = mid;
  const refKind = "mid";
  if (!act || !Number.isFinite(rest) || reference == null || xMicro == null) {
    return { fire: false, reason: "unpriced", gapMicro: null, refKind, referenceMicro: reference };
  }
  const gapMicro = act === "buy" ? rest - reference : reference - rest;
  const base = { gapMicro, refKind, referenceMicro: reference, midMicro: mid };
  if (gapMicro < 0) return { fire: false, reason: "ran-away", ...base };
  if (gapMicro <= xMicro) return { fire: false, reason: "inside", ...base };
  return { fire: true, reason: "through", ...base };
}

/**
 * New rest at outcome mid ∓ Y¢, then the Desk V1 tick snap.
 * Buy must land strictly lower than the cancelled rest. Sell strictly higher.
 */
export function improveFromMid({
  outcome,
  action,
  midOutcomeMicro,
  bidMicro,
  askMicro,
  yCents,
  tick,
  restingOutcomeMicro,
  xCents,
} = {}) {
  const act = normalizeAction(action);
  const side = normalizeOutcome(outcome);
  const mid = Math.round(Number(midOutcomeMicro));
  const yMicro = centsToMicro(yCents);
  const resting = Math.round(Number(restingOutcomeMicro));
  const bid = bookMicro(bidMicro);
  const ask = bookMicro(askMicro);
  const ref = act === "buy" ? (bid != null ? bid : mid) : (ask != null ? ask : mid);
  if (!act || !side || !Number.isFinite(ref) || yMicro == null) {
    return { ok: false, error: "Cannot price a re-rest.", code: "no-improve" };
  }
  const target = act === "buy" ? ref - yMicro : ref + yMicro;
  const snap = snapFavorableFromMicro({ fairMicro: target, outcome: side, action: act, tick });
  if (!snap.ok) return { ...snap, code: "no-improve" };
  const better = Number.isFinite(resting)
    ? (act === "buy" ? snap.outcomeMicro < resting : snap.outcomeMicro > resting)
    : true;
  if (!better) {
    return { ok: false, error: "Cannot re-rest better than the current price.", code: "no-improve", snap };
  }
  if (xCents != null) {
    const still = evaluateProtect({
      action: act,
      restingOutcomeMicro: snap.outcomeMicro,
      midOutcomeMicro: Number.isFinite(mid) ? mid : ref,
      bidMicro: act === "buy" ? bid : null,
      askMicro: act === "sell" ? ask : null,
      xCents,
    });
    if (still.fire) {
      return { ok: false, error: "Re-rest would still be through the live book.", code: "no-improve", snap };
    }
  }
  return { ok: true, ...snap, targetMicro: target };
}

export function protectContracts({ leaves, outcomeMicro, action, minQty, capDollars = MAX_SIZE_DOLLARS } = {}) {
  const n = Number(leaves);
  if (!(n > 0)) return { ok: false, error: "No size left on the resting order." };
  const dollars = Math.min(MAX_SIZE_DOLLARS, Number(capDollars));
  if (!(dollars > 0)) return { ok: false, error: "Re-rest would exceed the $" + MAX_SIZE_DOLLARS + " cap." };
  const cap = sizeToContracts({
    dollars,
    outcomeMicro,
    action,
    minQty,
  });
  if (!cap.ok) return cap;
  const step = Number(minQty) > 0 ? Number(minQty) : 1;
  const steps = Math.floor(Math.min(n, cap.contracts) / step + 1e-9);
  let contracts = Number((steps * step).toFixed(8));
  if (!(contracts > 0)) {
    return { ok: false, error: "Size is below the market minimum after the $" + MAX_SIZE_DOLLARS + " cap." };
  }
  if (step >= 1) contracts = Math.round(contracts);
  const micro = Math.round(Number(outcomeMicro));
  const act = normalizeAction(action);
  const riskMicro = act === "sell" ? (MICRO - micro) : micro;
  const riskDollars = (contracts * riskMicro) / MICRO;
  if (!(riskDollars <= dollars + 1e-6)) {
    return { ok: false, error: "Re-rest would exceed the $" + MAX_SIZE_DOLLARS + " cap." };
  }
  return { ok: true, contracts, riskDollars, riskLabel: "$" + riskDollars.toFixed(2) };
}

export function formatProtectTelegram({
  title,
  action,
  outcomeName,
  oldAmerican,
  newAmerican,
  oldCents,
  newCents,
  contracts,
  cancelledOnly,
  reason,
} = {}) {
  const side = normalizeAction(action) === "sell" ? "Sell" : "Buy";
  const who = outcomeName ? side + " " + outcomeName : side;
  const head = "Bet Protect · " + (title || "Polymarket US");
  const size = contracts != null && contracts !== "" ? String(contracts) + " contracts" : "";
  const oldPx = [oldAmerican, oldCents ? "(" + oldCents + ")" : ""].filter(Boolean).join(" ");
  if (cancelledOnly) {
    const why = reason === "capped"
      ? "Bet Protect cap"
      : (reason === "retry" ? "re-rest will retry" : (reason === "no-improve" ? "could not re-rest better" : "no re-rest"));
    return [head, (who + " " + oldPx).trim(), "Cancelled · " + why, size].filter(Boolean).join("\n");
  }
  const next = [newAmerican, newCents ? "(" + newCents + ")" : ""].filter(Boolean).join(" ");
  return [
    head,
    (who + " " + oldPx + " → " + next).trim(),
    "Cancelled → re-rested",
    size,
  ].filter(Boolean).join("\n");
}

export function protectBadge(row) {
  if (!row) return null;
  const status = String(row.status || "");
  if (status !== "armed" && status !== "pending_rereset" && status !== "sweeping") return null;
  return {
    on: true,
    xCents: Number(row.x_cents),
    yCents: Number(row.y_cents),
    count: Number(row.protect_count) || 0,
    status,
  };
}

export function americanLabelFromMicro(micro) {
  if (micro == null) return "";
  return formatAmerican(americanFromMicro(micro)) || "";
}

export function centsLabelFromMicro(micro) {
  if (micro == null) return "";
  return formatCentsFromMicro(micro);
}

/** Price of the first rest in this lineage. Later re-rests must copy it, not the price they replace. */
export function originalSubmittedMicro(row) {
  if (!row) return null;
  const stored = Number(row.submitted_outcome_micro);
  if (stored > 0 && stored < MICRO) return Math.round(stored);
  if ((Number(row.protect_count) || 0) === 0) {
    const current = Number(row.outcome_micro);
    if (current > 0 && current < MICRO) return Math.round(current);
  }
  return null;
}

function fillAmericanFromCost(position) {
  const net = Math.abs(Number(position && position.net));
  const cost = Number(position && position.cost);
  if (!(net > 0) || !(cost > 0)) return "";
  const prob = cost / net;
  if (!(prob > 0 && prob < 1)) return "";
  return formatAmerican(americanFromProb(prob)) || "";
}

/**
 * Open position that came from a Protect re-rest.
 * Main number is the fill (cost / contracts). The parenthetical is the first
 * submitted American, never an intermediate re-rest. No note if Protect never moved it.
 */
export function protectFillForPosition(position, rows) {
  if (!position || !position.slug) return null;
  const side = position.side === "short" ? "short" : "long";
  const matches = (rows || []).filter((row) => {
    if (!row || String(row.market_slug || "") !== String(position.slug)) return false;
    if (String(row.outcome || "") !== side) return false;
    if (normalizeAction(row.action) !== "buy") return false;
    return (Number(row.protect_count) || 0) > 0;
  });
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const byCount = (Number(b.protect_count) || 0) - (Number(a.protect_count) || 0);
    if (byCount) return byCount;
    return (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0);
  });
  const row = matches[0];
  const submittedMicro = originalSubmittedMicro(row);
  const submittedAmerican = americanLabelFromMicro(submittedMicro);
  if (!submittedAmerican) return null;
  const fillAmerican = fillAmericanFromCost(position) || americanLabelFromMicro(row.outcome_micro);
  if (!fillAmerican) return null;
  const team = position.team || row.outcome_name || (side === "short" ? "No" : "Yes");
  return team + " " + fillAmerican + " (submitted " + submittedAmerican + " · improved by Bet Protect)";
}
