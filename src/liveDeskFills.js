// Filled orders for the private Live Trading Desk (Polymarket US).
//
// One row per individual fill (not aggregated positions), newest first.
// Source: GET /v1/portfolio/activities (ACTIVITY_TYPE_TRADE). Each trade
// carries both executions; ours is aggressorExecution when isAggressor is
// true, otherwise passiveExecution. The execution's order gives the order id,
// intent (BUY_LONG / BUY_SHORT / SELL_LONG / SELL_SHORT) and limit price.
// Trade prices are always the long instrument; a short side is 1 - price.
//
// Bet Protect: when the fill's order id is a desk_protect_rests row that came
// from a re-rest (protect_count > 0 or replaces set), the first submitted
// price of that lineage (submitted_outcome_micro) is shown next to the fill.
// American odds only.
import { americanFromMicro, formatAmerican, formatCentsFromMicro, readMarketSides, toMicro } from "./liveDeskPrice.js";
import { originalSubmittedMicro } from "./liveDeskProtect.js";
import { ourExecution, sideFromOrder } from "./liveDeskTradeSide.js";

const MICRO = 1_000_000;
export const FILLS_VENUE = "Polymarket US";
export const FILLED_ORDERS_LIMIT = 50;

function amount(v) {
  if (v == null) return null;
  if (typeof v === "object") return amount(v.value);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  return v == null ? "" : String(v).trim();
}

function roundQty(n) {
  return Math.round(n * 10000) / 10000;
}

function americanLabel(micro) {
  if (micro == null) return "";
  return formatAmerican(americanFromMicro(micro)) || "";
}

/** Sortable key for ISO times with nanosecond fractions. */
export function fillTimeMs(iso) {
  const s = str(iso);
  if (!s) return 0;
  const trimmed = s.replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : 0;
}

export function fillTimeEt(iso) {
  const ms = fillTimeMs(iso);
  if (!ms) return "";
  const text = new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  return text + " ET";
}

function outcomeMicroFromYes(yes, outcome) {
  if (yes == null || !(yes > 0 && yes < 1)) return null;
  const yesMicro = toMicro(yes);
  if (yesMicro == null) return null;
  return outcome === "short" ? MICRO - yesMicro : yesMicro;
}

function marketTypeLabel(market, slug) {
  const t = str(market && (market.sportsMarketType || market.marketType)).toLowerCase();
  if (/spread/.test(t)) return "Spread";
  if (/total|over|under/.test(t)) return "Total";
  if (/winner|moneyline/.test(t)) return "Moneyline";
  if (/^caoc-/.test(slug)) return "Combo";
  if (/^aec-/.test(slug)) return "Moneyline";
  if (/^asc-/.test(slug)) return "Spread";
  if (/^tsc-|^aoc-/.test(slug)) return "Total";
  return t ? t.replace(/_/g, " ") : "Market";
}

function sideName(market, outcome, typeLabel) {
  const raw = Array.isArray(market && market.marketSides) ? market.marketSides : [];
  const side = raw.find((s) => s && s.long === (outcome === "long"));
  if (!side) return outcome === "short" ? "No" : "Yes";
  const team = (side.team && (side.team.name || side.team.safeName)) || "";
  const desc = str(side.description);
  if (typeLabel === "Spread" && team && desc && desc !== team) return team + " " + desc;
  if (typeLabel === "Total" && desc) return desc;
  if (team) return team;
  const sides = readMarketSides(market);
  if (sides.ok) return outcome === "short" ? sides.shortName : sides.longName;
  return desc || (outcome === "short" ? "No" : "Yes");
}

function gameName(trade, order) {
  const meta = (order && order.marketMetadata) || trade.marketMetadata || {};
  if (str(meta.title)) return str(meta.title);
  const market = trade.market || {};
  return str(market.title) || str(market.question) || str(trade.marketSlug) || "Trade";
}

function protectRowFor(orderId, byId) {
  if (!orderId) return null;
  return byId.get(orderId) || null;
}

function submittedFor(row, byId) {
  const direct = originalSubmittedMicro(row);
  if (direct != null) return direct;
  const root = row && row.lineage_id ? byId.get(String(row.lineage_id)) : null;
  if (root && root !== row) {
    const rootMicro = originalSubmittedMicro(root);
    if (rootMicro != null) return rootMicro;
  }
  return null;
}

function improvementOf({ action, submittedMicro, fillMicro }) {
  if (submittedMicro == null || fillMicro == null) return null;
  const diff = action === "sell" ? fillMicro - submittedMicro : submittedMicro - fillMicro;
  return diff;
}

function centsText(micro) {
  const cents = Math.round((micro / 10000) * 10) / 10;
  const abs = Math.abs(cents);
  const txt = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return txt + "¢";
}

function americanPoints(a, b) {
  const x = americanFromMicro(a);
  const y = americanFromMicro(b);
  if (x == null || y == null) return null;
  // Distance on the American scale, skipping the -100/+100 gap.
  const lin = (v) => (v > 0 ? v - 100 : v + 100);
  return Math.abs(lin(y) - lin(x));
}

export function protectFillNote({ action, submittedMicro, fillMicro, count }) {
  const submittedAmerican = americanLabel(submittedMicro);
  const filledAmerican = americanLabel(fillMicro);
  if (!submittedAmerican || !filledAmerican) {
    return {
      submittedAmerican: submittedAmerican || "",
      filledAmerican: filledAmerican || "",
      improvementMicro: null,
      line: "Filled " + (filledAmerican || "—") + " · Bet Protect (original submitted odds not recorded)",
      improvementLabel: "",
      count: Number(count) || 0,
    };
  }
  const diff = improvementOf({ action, submittedMicro, fillMicro });
  let improvementLabel = "";
  if (diff != null && diff > 0) {
    const pts = americanPoints(submittedMicro, fillMicro);
    improvementLabel = "Improved " + centsText(diff) + (pts ? " (" + pts + " pts)" : "");
  } else if (diff != null && diff < 0) {
    improvementLabel = "Worse by " + centsText(diff);
  } else if (diff === 0) {
    improvementLabel = "Same price";
  }
  return {
    submittedAmerican,
    filledAmerican,
    improvementMicro: diff,
    line: "Submitted " + submittedAmerican + " → Filled " + filledAmerican + " · Bet Protect",
    improvementLabel,
    count: Number(count) || 0,
  };
}

function money(n) {
  if (n == null || !Number.isFinite(n)) return "";
  return "$" + n.toFixed(2);
}

function contractsLabel(n) {
  if (n == null || !Number.isFinite(n)) return "";
  const r = roundQty(n);
  return Number.isInteger(r) ? String(r) : String(r);
}

/**
 * @param {{ activities?: any[] }} payload  Polymarket US activities page.
 * @param {{ protectRows?: any[], limit?: number }} opts
 */
export function mapFilledOrders(payload, { protectRows, limit } = {}) {
  const list = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.activities) ? payload.activities : []);
  const byId = new Map();
  for (const row of protectRows || []) {
    if (row && row.order_id) byId.set(String(row.order_id), row);
  }
  const seen = new Set();
  const rows = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (item.type && item.type !== "ACTIVITY_TYPE_TRADE") continue;
    const trade = item.trade && typeof item.trade === "object" ? item.trade : null;
    if (!trade) continue;
    const state = str(trade.state);
    if (/BUSTED|REJECTED/i.test(state)) continue;
    const tradeId = str(trade.id);
    if (tradeId) {
      if (seen.has(tradeId)) continue;
      seen.add(tradeId);
    }
    const slug = str(trade.marketSlug || (trade.market && trade.market.slug));
    const { exec, order, role } = ourExecution(trade);
    const orderId = str(order && order.id);
    const side = sideFromOrder(order);
    const qty = amount(trade.qtyDecimal != null ? trade.qtyDecimal : (exec && exec.lastShares != null ? exec.lastShares : trade.qty));
    const yes = amount(exec && exec.lastPx) != null ? amount(exec.lastPx) : amount(trade.price);
    const fillMicro = side ? outcomeMicroFromYes(yes, side.outcome) : null;
    const limitMicro = side ? outcomeMicroFromYes(amount(order && order.price), side.outcome) : null;
    const cost = amount(trade.cost) != null ? amount(trade.cost) : amount(trade.costBasis);
    const fee = amount(exec && exec.commissionNotionalCollected);
    const typeLabel = marketTypeLabel(trade.market, slug);
    const team = side ? sideName(trade.market, side.outcome, typeLabel) : "";
    const orderQty = amount(order && order.quantity);
    const orderCum = amount(order && order.cumQuantity);
    const orderState = str(order && order.state);
    const partial = /PARTIALLY_FILLED/.test(orderState)
      || (orderQty != null && orderCum != null && orderCum + 1e-9 < orderQty);
    const time = str(trade.createTime || trade.updateTime || (exec && exec.transactTime));
    const row = protectRowFor(orderId, byId);
    let protect = null;
    if (row && ((Number(row.protect_count) || 0) > 0 || str(row.replaces))) {
      const submittedMicro = submittedFor(row, byId);
      protect = protectFillNote({
        action: side ? side.action : "buy",
        submittedMicro,
        fillMicro,
        count: row.protect_count,
      });
    }
    rows.push({
      id: tradeId || orderId + ":" + time + ":" + rows.length,
      tradeId,
      orderId,
      time,
      timeEt: fillTimeEt(time),
      venue: FILLS_VENUE,
      marketSlug: slug,
      game: gameName(trade, order),
      market: typeLabel,
      action: side ? side.action : "",
      outcome: side ? side.outcome : "",
      team,
      sideLabel: side ? (side.action === "sell" ? "Sell " : "Buy ") + team : "—",
      contracts: qty,
      contractsLabel: contractsLabel(qty),
      cost,
      costLabel: money(cost),
      costKind: side && side.action === "sell" ? "proceeds" : "cost",
      fee,
      fillMicro,
      fillAmerican: americanLabel(fillMicro),
      fillCents: fillMicro == null ? "" : formatCentsFromMicro(fillMicro),
      limitAmerican: americanLabel(limitMicro),
      role,
      partial,
      orderQty,
      orderCum,
      orderProgress: orderQty != null && orderCum != null
        ? contractsLabel(orderCum) + " of " + contractsLabel(orderQty)
        : "",
      state,
      source: row ? "desk" : (/^caoc-/.test(slug) ? "combo" : ""),
      protectArmed: !!row,
      protect,
    });
  }
  rows.sort((a, b) => fillTimeMs(b.time) - fillTimeMs(a.time));
  const cap = Number(limit) > 0 ? Number(limit) : FILLED_ORDERS_LIMIT;
  return rows.slice(0, cap);
}

/** Order ids (and Protect lineage roots) that the registry lookup needs. */
export function filledOrderIds(payload) {
  const list = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.activities) ? payload.activities : []);
  const ids = new Set();
  for (const item of list) {
    const trade = item && item.trade;
    if (!trade) continue;
    const { order } = ourExecution(trade);
    const id = str(order && order.id);
    if (id) ids.add(id);
  }
  return [...ids];
}
