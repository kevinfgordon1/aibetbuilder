// Live Trading Desk price math for Polymarket US.
//
// Kevin types American odds. Polymarket US rests a YES (long) price in
// probability dollars, on the market's orderPriceMinTickSize (often 0.001,
// sometimes 0.005 / half-cent). The book price is always the long side.
// Buying the short team at X sends YES price 1−X.
//
// Tick rule (never worse than the American he typed):
//   Convert American → fair probability of the outcome he is trading.
//   Buy  → floor that probability to the tick (pays less).
//   Sell → ceil that probability to the tick (receives more).
//   Short orders then complement onto the YES price, moving only in the
//   direction that keeps the outcome price favorable, and still on the tick.
//
// Team identity comes from marketSides[].long. outcomes[] order is ignored.
//
// Dollar size is max loss if the order fills and settles against him:
//   buy  → contracts × outcome price
//   sell → contracts × (1 − outcome price)
// Hard cap is MAX_SIZE_DOLLARS (V1 trial).

export const DEFAULT_TICK = 0.001;
export const PRICE_MIN = 0.01;
export const PRICE_MAX = 0.99;
export const DEFAULT_SIZE_DOLLARS = 25;
export const MAX_SIZE_DOLLARS = 100;
export const MAX_CONTRACTS = 10000;

const MICRO = 1_000_000;

export function parseAmerican(raw) {
  if (raw == null) return null;
  const s = String(raw)
    .trim()
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\s+/g, "")
    .replace(/^\+/, "");
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  if (Math.abs(n) < 100) return null;
  return n;
}

export function toMicro(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * MICRO);
}

export function fromMicro(micro) {
  return micro / MICRO;
}

export function normalizeTick(tick) {
  const n = Number(tick);
  if (!(n > 0 && n < 1)) return DEFAULT_TICK;
  const micro = Math.round(n * MICRO);
  if (micro < 1 || micro >= MICRO) return DEFAULT_TICK;
  return micro / MICRO;
}

export function impliedProbFromAmerican(american) {
  const a = typeof american === "number" && Number.isFinite(american) && american !== 0
    ? american
    : parseAmerican(american);
  if (a == null) return null;
  const p = a < 0 ? Math.abs(a) / (Math.abs(a) + 100) : 100 / (a + 100);
  if (!(p > 0 && p < 1)) return null;
  return p;
}

export function americanFromMicro(micro) {
  const m = Math.round(Number(micro));
  if (!(m > 0 && m < MICRO)) return null;
  if (m >= MICRO / 2) return -Math.round((100 * m) / (MICRO - m));
  return Math.round((100 * (MICRO - m)) / m);
}

export function americanFromProb(p) {
  const micro = toMicro(p);
  if (micro == null) return null;
  return americanFromMicro(micro);
}

export function formatAmerican(a) {
  if (a == null || !Number.isFinite(Number(a))) return "";
  const r = Math.round(Number(a));
  if (!r) return "";
  return r > 0 ? "+" + r : String(r);
}

export function formatCentsFromMicro(micro) {
  const m = Math.round(Number(micro));
  if (!Number.isFinite(m)) return "";
  const cents = m / 10000;
  const rounded = Math.round(cents * 10) / 10;
  const text = Math.abs(rounded - Math.round(rounded)) < 1e-9
    ? String(Math.round(rounded))
    : rounded.toFixed(1);
  return text + "¢";
}

function priceDecimals(tickMicro) {
  for (let d = 2; d <= 6; d++) {
    const unit = MICRO / 10 ** d;
    if (tickMicro % unit === 0) return d;
  }
  return 6;
}

export function formatYesPrice(yesMicro, tickMicro) {
  const places = priceDecimals(tickMicro);
  return (Math.round(yesMicro) / MICRO).toFixed(places);
}

function floorToTick(micro, tickMicro) {
  return Math.floor(micro / tickMicro) * tickMicro;
}

function ceilToTick(micro, tickMicro) {
  return Math.ceil(micro / tickMicro) * tickMicro;
}

export function normalizeOutcome(outcome) {
  const s = String(outcome || "").trim().toLowerCase();
  if (s === "long" || s === "yes" || s === "buy_long") return "long";
  if (s === "short" || s === "no" || s === "buy_short") return "short";
  return "";
}

export function normalizeAction(action) {
  const s = String(action || "").trim().toLowerCase();
  if (s === "buy" || s === "b") return "buy";
  if (s === "sell" || s === "s") return "sell";
  return "";
}

export function intentFor(outcome, action) {
  const side = normalizeOutcome(outcome);
  const act = normalizeAction(action);
  if (side === "long" && act === "buy") return "ORDER_INTENT_BUY_LONG";
  if (side === "long" && act === "sell") return "ORDER_INTENT_SELL_LONG";
  if (side === "short" && act === "buy") return "ORDER_INTENT_BUY_SHORT";
  if (side === "short" && act === "sell") return "ORDER_INTENT_SELL_SHORT";
  return "";
}

// Polymarket US has no side field. The exchange derives ORDER_SIDE_SELL from
// BUY_SHORT (buy the short team = sell YES) and ORDER_SIDE_BUY from
// SELL_SHORT (sell the short team = buy YES). Keep the team on the intent so
// an open buy of Green Bay is not labeled as a sell of Atlanta.
export function yesBookSide(outcome, action) {
  const side = normalizeOutcome(outcome);
  const act = normalizeAction(action);
  if (!side || !act) return "";
  if (side === "short") return act === "buy" ? "sell" : "buy";
  return act;
}

export function outcomeFromIntent(intent, outcomeSide, action) {
  const sideRaw = String(outcomeSide || "").toUpperCase();
  const actRaw = String(action || "").toUpperCase();
  if (sideRaw.includes("NO") || sideRaw.includes("SHORT")) {
    return { outcome: "short", action: actRaw.includes("SELL") ? "sell" : "buy" };
  }
  if (sideRaw.includes("YES") || sideRaw.includes("LONG")) {
    if (actRaw.includes("SELL") || actRaw.includes("BUY")) {
      return { outcome: "long", action: actRaw.includes("SELL") ? "sell" : "buy" };
    }
  }
  const text = String(intent || "").toUpperCase();
  if (text.includes("SELL_SHORT")) return { outcome: "short", action: "sell" };
  if (text.includes("BUY_SHORT")) return { outcome: "short", action: "buy" };
  if (text.includes("SELL_LONG") || text.includes("SELL")) return { outcome: "long", action: "sell" };
  if (text.includes("BUY_LONG") || text.includes("BUY")) return { outcome: "long", action: "buy" };
  return { outcome: "long", action: "buy" };
}

function alignYesMicro(yesMicro, side, action, tickMicro) {
  const rem = yesMicro % tickMicro;
  if (rem === 0) return yesMicro;
  const wantHigherYes = (side === "long" && action === "sell") || (side === "short" && action === "buy");
  if (wantHigherYes) return yesMicro + (tickMicro - rem);
  return yesMicro - rem;
}

/**
 * Snap a typed American onto the Polymarket US tick in the trader's favor.
 * Returns the YES book price that should be sent as price.value.
 */
export function snapRestingLimit({ american, outcome, action, tick } = {}) {
  const asked = parseAmerican(american);
  const side = normalizeOutcome(outcome);
  const act = normalizeAction(action);
  if (asked == null || !side || !act) {
    return { ok: false, error: "Enter American odds like −150 or +130, plus buy/sell and Yes/No." };
  }
  const fair = impliedProbFromAmerican(asked);
  if (fair == null) {
    return { ok: false, error: "Those American odds do not convert to a price." };
  }
  const tickNorm = normalizeTick(tick);
  const tickMicro = Math.round(tickNorm * MICRO);
  const fairMicro = toMicro(fair);
  let outcomeMicro = act === "buy" ? floorToTick(fairMicro, tickMicro) : ceilToTick(fairMicro, tickMicro);
  if (!(outcomeMicro > 0 && outcomeMicro < MICRO)) {
    return { ok: false, error: "That price snaps off the board. Try a different American." };
  }
  let yesMicro = side === "long" ? outcomeMicro : (MICRO - outcomeMicro);
  yesMicro = alignYesMicro(yesMicro, side, act, tickMicro);
  outcomeMicro = side === "long" ? yesMicro : (MICRO - yesMicro);
  const minMicro = toMicro(PRICE_MIN);
  const maxMicro = toMicro(PRICE_MAX);
  if (yesMicro < minMicro || yesMicro > maxMicro || !(outcomeMicro > 0 && outcomeMicro < MICRO)) {
    return { ok: false, error: "Polymarket US only rests prices from 1¢ to 99¢." };
  }
  const favorable = act === "buy" ? outcomeMicro <= fairMicro : outcomeMicro >= fairMicro;
  if (!favorable) {
    return { ok: false, error: "Tick snap would be worse than the American you typed." };
  }
  const snappedAmerican = americanFromMicro(outcomeMicro);
  return {
    ok: true,
    outcome: side,
    action: act,
    tick: tickNorm,
    askedAmerican: asked,
    fairProb: fair,
    outcomeMicro,
    yesMicro,
    outcomePrice: fromMicro(outcomeMicro),
    yesPrice: fromMicro(yesMicro),
    yesPriceValue: formatYesPrice(yesMicro, tickMicro),
    snappedAmerican,
    snappedAmericanLabel: formatAmerican(snappedAmerican),
    centsLabel: formatCentsFromMicro(outcomeMicro),
    yesCentsLabel: formatCentsFromMicro(yesMicro),
    intent: intentFor(side, act),
    bookSide: yesBookSide(side, act),
  };
}

function positiveQty(v) {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  return 1;
}

export function sizeToContracts({ dollars, outcomeMicro, action, minQty } = {}) {
  const d = typeof dollars === "number" ? dollars : Number(String(dollars == null ? "" : dollars).trim());
  if (!Number.isFinite(d) || d <= 0) return { ok: false, error: "Enter a dollar size." };
  if (d > MAX_SIZE_DOLLARS + 1e-9) {
    return { ok: false, error: "Size cap is $" + MAX_SIZE_DOLLARS + " on this desk." };
  }
  const micro = Math.round(Number(outcomeMicro));
  if (!(micro > 0 && micro < MICRO)) return { ok: false, error: "Price is not tradable." };
  const act = normalizeAction(action);
  if (!act) return { ok: false, error: "Pick buy or sell." };
  const riskMicro = act === "sell" ? (MICRO - micro) : micro;
  if (!(riskMicro > 0 && riskMicro < MICRO)) return { ok: false, error: "Price is not tradable." };
  const step = positiveQty(minQty);
  const raw = (d * MICRO) / riskMicro;
  const steps = Math.floor(raw / step + 1e-9);
  const contracts = Number((steps * step).toFixed(8));
  if (!(contracts > 0) || contracts + 1e-9 < step) {
    return {
      ok: false,
      error: "That size is below the market minimum (" + step + " contract" + (step === 1 ? "" : "s") + ").",
    };
  }
  if (contracts > MAX_CONTRACTS) {
    return { ok: false, error: "Contract count is too large for this desk." };
  }
  const riskDollars = (contracts * riskMicro) / MICRO;
  return {
    ok: true,
    contracts: step >= 1 ? Math.round(contracts) : contracts,
    riskDollars,
    riskLabel: "$" + riskDollars.toFixed(2),
  };
}

export function quoteRestingOrder(input) {
  const snap = snapRestingLimit(input);
  if (!snap.ok) return snap;
  const sized = sizeToContracts({
    dollars: input && input.dollars,
    outcomeMicro: snap.outcomeMicro,
    action: snap.action,
    minQty: input && input.minQty,
  });
  if (!sized.ok) return { ...snap, ok: false, error: sized.error, snap };
  return { ...snap, ...sized, ok: true };
}

export function buildLimitOrder({ slug, quote, allowCross } = {}) {
  return {
    marketSlug: String(slug || "").trim(),
    type: "ORDER_TYPE_LIMIT",
    price: { value: quote.yesPriceValue, currency: "USD" },
    quantity: quote.contracts,
    tif: "TIME_IN_FORCE_GOOD_TILL_CANCEL",
    intent: quote.intent,
    manualOrderIndicator: "MANUAL_ORDER_INDICATOR_MANUAL",
    participateDontInitiate: !allowCross,
  };
}

export function compactCents(micro) {
  const label = formatCentsFromMicro(micro);
  if (!label) return "";
  return label.replace(/¢$/, "c");
}

export function formatMaxCost(riskDollars) {
  const n = Number(riskDollars);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return "$" + Math.round(rounded);
  return "$" + rounded.toFixed(2);
}

function formatContracts(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  const text = v.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  return text;
}

export function formatDeskOrderLine({ action, team, americanLabel, cents, contracts, cost } = {}) {
  const act = normalizeAction(action) === "sell" ? "SELL" : "BUY";
  return "You will " + act + " " + String(team || "")
    + " at " + String(americanLabel || "")
    + " (" + String(cents || "") + ")"
    + " · " + formatContracts(contracts) + " contracts"
    + " · max cost " + String(cost || "");
}

export function orderTicket(quote, team) {
  const cents = compactCents(quote.outcomeMicro);
  const cost = formatMaxCost(quote.riskDollars);
  const line = formatDeskOrderLine({
    action: quote.action,
    team,
    americanLabel: quote.snappedAmericanLabel,
    cents,
    contracts: quote.contracts,
    cost,
  });
  return {
    team: String(team || ""),
    outcome: quote.outcome,
    action: quote.action,
    american: quote.snappedAmericanLabel,
    cents,
    contracts: quote.contracts,
    cost,
    yesPrice: quote.yesPriceValue,
    intent: quote.intent,
    bookSide: quote.bookSide,
    line,
  };
}

export function matchDisplayedOrder(quote, team, confirm) {
  const expected = orderTicket(quote, team);
  if (!confirm || typeof confirm !== "object") {
    return { ok: false, error: "Confirm the order sentence before sending.", expected };
  }
  const keys = ["team", "outcome", "action", "american", "contracts", "cost", "yesPrice", "intent", "bookSide", "line"];
  for (const key of keys) {
    if (String(confirm[key]) !== String(expected[key])) {
      return {
        ok: false,
        error: "That confirmation does not match this order. Read the sentence and send again.",
        expected,
      };
    }
  }
  return { ok: true, expected };
}

export function strayOrderMismatch(body, quote) {
  if (!body || typeof body !== "object" || !quote) return "";
  if (body.price != null) {
    const raw = typeof body.price === "object" ? body.price.value : body.price;
    if (raw != null && String(raw) !== "" && String(raw) !== String(quote.yesPriceValue)) {
      return "Request price does not match the team and American on this order.";
    }
  }
  if (body.quantity != null && String(body.quantity) !== "" && String(body.quantity) !== String(quote.contracts)) {
    return "Request quantity does not match the dollar size on this order.";
  }
  if (body.intent != null && String(body.intent) !== "" && String(body.intent) !== String(quote.intent)) {
    return "Request intent does not match the team and side on this order.";
  }
  return "";
}

export function readYesBbo(payload) {
  const data = payload && (payload.marketData || payload.market_data || payload);
  if (!data || typeof data !== "object") {
    return { ok: false, bestBid: null, bestAsk: null, error: "The book is missing or crossed. A rest will not be sent." };
  }
  const bid = amountValue(data.bestBid != null ? data.bestBid : data.best_bid);
  const ask = amountValue(data.bestAsk != null ? data.bestAsk : data.best_ask);
  const bidOk = bid > 0 && bid < 1;
  const askOk = ask > 0 && ask < 1;
  if (!bidOk || !askOk || ask + 1e-9 < bid) {
    return {
      ok: false,
      bestBid: bidOk ? bid : null,
      bestAsk: askOk ? ask : null,
      error: "The book is missing or crossed. A rest will not be sent.",
    };
  }
  return { ok: true, bestBid: bid, bestAsk: ask };
}

export function crossBlock({ bookSide, yesMicro, bestBid, bestAsk } = {}) {
  const side = bookSide === "buy" || bookSide === "sell" ? bookSide : "";
  const yes = Math.round(Number(yesMicro));
  if (!side || !(yes > 0 && yes < MICRO)) {
    return { ok: false, crosses: true, error: "That limit has no book side." };
  }
  const bid = Number(bestBid);
  const ask = Number(bestAsk);
  const bidOk = bid > 0 && bid < 1;
  const askOk = ask > 0 && ask < 1;
  if (!bidOk || !askOk || ask + 1e-9 < bid) {
    return { ok: false, crosses: true, error: "The book is missing or crossed. A rest will not be sent." };
  }
  const bidMicro = Math.round(bid * MICRO);
  const askMicro = Math.round(ask * MICRO);
  const crosses = side === "buy" ? yes >= askMicro : yes <= bidMicro;
  if (!crosses) return { ok: true, crosses: false };
  return {
    ok: false,
    crosses: true,
    error: "That limit would cross the book and take liquidity. Tick Allow cross to send it, or rest inside the spread.",
  };
}

export function allowCrossRequested(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

/**
 * What a successful Live Trading Desk rest clears. Mirrors Combo Locks
 * addParlay: the leg (game + market) selection is emptied, stake and odds
 * stay, and there is no success toast. A rejected submit returns null so
 * the typed ticket stays on screen with the error.
 * Overrides, always: the Buy/Sell toggle returns to Buy, and Bet Protect
 * turns off. American odds, dollar size, and Allow cross are omitted
 * because Combo Locks keeps those inputs.
 */
export function restFormAfterPlace(accepted) {
  if (accepted !== true) return null;
  return {
    action: "buy",
    protect: false,
    gameId: "",
    slug: "",
    slugDraft: "",
    outcome: "long",
    marketType: "moneyline",
    notice: "",
  };
}

function sideLabel(side) {
  const team = (side && side.team) || {};
  return team.name || team.safeName || team.displayAbbreviation || side.description || (side.long ? "Yes" : "No");
}

export function readMarketSides(market) {
  const sides = market && (market.marketSides || market.market_sides);
  if (!Array.isArray(sides) || !sides.length) {
    return {
      ok: false,
      error: "This market has no marketSides. Refusing to guess the long team from outcomes[].",
    };
  }
  const longSide = sides.find((s) => s && s.long === true);
  const shortSide = sides.find((s) => s && s.long === false);
  if (!longSide || !shortSide) {
    return { ok: false, error: "Market is missing a long or short side." };
  }
  const closed = !!(market.closed || market.archived);
  const status = String(market.status || market.ep3Status || "");
  const resolved = /RESOLVED|EXPIRED|SETTLED|CLOSED/i.test(status);
  return {
    ok: true,
    slug: String(market.slug || longSide.identifier || "").trim(),
    title: market.question || market.title || market.slug || "",
    longName: sideLabel(longSide),
    shortName: sideLabel(shortSide),
    tick: normalizeTick(market.orderPriceMinTickSize),
    minQty: positiveQty(market.minimumTradeQty),
    tradable: market.active !== false && !closed && !resolved,
    closed: closed || resolved,
  };
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

export function mapPositions(payload) {
  const raw = payload && (payload.positions || payload);
  const entries = [];
  if (Array.isArray(raw)) {
    raw.forEach((pos) => entries.push([(pos && pos.marketMetadata && pos.marketMetadata.slug) || "", pos]));
  } else if (raw && typeof raw === "object") {
    for (const [slug, pos] of Object.entries(raw)) entries.push([slug, pos]);
  }
  const rows = [];
  for (const [slug, pos] of entries) {
    if (!pos || typeof pos !== "object") continue;
    if (pos.expired) continue;
    const net = Number(pos.netPositionDecimal != null ? pos.netPositionDecimal : pos.netPosition);
    if (!Number.isFinite(net) || net === 0) continue;
    const meta = pos.marketMetadata || {};
    rows.push({
      slug: String(meta.slug || slug || "").trim(),
      title: meta.title || meta.outcome || slug || "Position",
      outcomeLabel: meta.outcome || "",
      net,
      side: net > 0 ? "long" : "short",
      cost: amountValue(pos.cost),
      cashValue: amountValue(pos.cashValue),
      realized: amountValue(pos.realized),
    });
  }
  rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return rows;
}

function exchangeBookSide(side) {
  const s = String(side || "").toUpperCase();
  if (s.includes("SELL")) return "sell";
  if (s.includes("BUY")) return "buy";
  return "";
}

// SELL_SHORT is a buy of YES. Label that open order as the long team, not
// as a sell of the short team. BUY_SHORT is a sell of YES and stays a buy
// of the short team.
export function openOrderDisplay(order) {
  const intent = String((order && order.intent) || "").toUpperCase();
  const book = exchangeBookSide(order && order.side);
  if (book === "buy" && intent.includes("SELL_SHORT")) return { outcome: "long", action: "buy" };
  if (book === "sell" && intent.includes("BUY_SHORT")) return { outcome: "short", action: "buy" };
  if (book === "sell" && intent.includes("SELL_LONG")) return { outcome: "long", action: "sell" };
  if (book === "buy" && intent.includes("BUY_LONG")) return { outcome: "long", action: "buy" };
  return outcomeFromIntent(order && order.intent, order && order.outcomeSide, order && order.action);
}

export function mapOpenOrders(payload, marketsBySlug = {}) {
  const raw = payload && (payload.orders || payload);
  const list = Array.isArray(raw) ? raw : [];
  return list.map((order) => {
    if (!order || typeof order !== "object") return null;
    const slug = String(order.marketSlug || (order.marketMetadata && order.marketMetadata.slug) || "").trim();
    const parsed = openOrderDisplay(order);
    const yes = amountValue(order.price);
    const yesMicro = yes == null ? null : toMicro(yes);
    const outcomeMicro = yesMicro == null
      ? null
      : (parsed.outcome === "short" ? MICRO - yesMicro : yesMicro);
    const sides = marketsBySlug[slug];
    const name = sides
      ? (parsed.outcome === "short" ? sides.shortName : sides.longName)
      : (parsed.outcome === "short" ? "No" : "Yes");
    return {
      id: String(order.id || ""),
      marketSlug: slug,
      title: (order.marketMetadata && (order.marketMetadata.title || order.marketMetadata.outcome)) || (sides && sides.title) || slug,
      outcome: parsed.outcome,
      action: parsed.action,
      outcomeName: name,
      americanLabel: outcomeMicro == null ? "" : formatAmerican(americanFromMicro(outcomeMicro)),
      centsLabel: outcomeMicro == null ? "" : formatCentsFromMicro(outcomeMicro),
      quantity: order.leavesQuantity != null ? order.leavesQuantity : order.quantity,
      state: order.state || "",
    };
  }).filter((row) => row && row.id);
}

export function deskErrorText(value, fallback = "Could not load the desk.") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object") {
    if (typeof value.message === "string" && value.message.trim()) return value.message.trim();
    if (typeof value.error === "string" && value.error.trim()) return value.error.trim();
  }
  return fallback;
}

export function mapActivities(payload, marketsBySlug = {}) {
  const list = payload && payload.activities;
  const rows = [];
  if (!Array.isArray(list)) return rows;
  for (const item of list) {
    if (!item || item.type && item.type !== "ACTIVITY_TYPE_TRADE") continue;
    const trade = item.trade || (item.price ? item : null);
    if (!trade) continue;
    const slug = String(trade.marketSlug || "").trim();
    const yes = amountValue(trade.price);
    const yesMicro = yes == null ? null : toMicro(yes);
    const sides = marketsBySlug[slug];
    rows.push({
      id: String(trade.id || slug + ":" + (trade.createTime || rows.length)),
      marketSlug: slug,
      title: (sides && sides.title) || slug || "Trade",
      longName: sides ? sides.longName : "Yes",
      time: trade.createTime || trade.updateTime || "",
      qty: trade.qtyDecimal != null ? trade.qtyDecimal : trade.qty,
      americanLabel: yesMicro == null ? "" : formatAmerican(americanFromMicro(yesMicro)),
      centsLabel: yesMicro == null ? "" : formatCentsFromMicro(yesMicro),
      state: trade.state || "",
    });
  }
  return rows;
}

export function isMarketSlug(slug) {
  return /^[a-z0-9][a-z0-9._-]{0,180}$/i.test(String(slug || "").trim());
}
