// Which side of a Polymarket US trade is ours, and what that order did.
//
// Real /v1/portfolio/activities trades carry buy/sell and long/short on the
// order inside the execution, not on the trade: the top-level trade has no
// intent (or ORDER_INTENT_UNDEFINED). Ours is aggressorExecution when
// isAggressor is true, otherwise passiveExecution. Shared by Filled orders
// (mapFilledOrders), the position drill-down and the fill-based position
// correction in liveDeskPrice.js. No imports, so both can use it.

function str(v) {
  return v == null ? "" : String(v).trim();
}

/** Our execution and its order for one trade. */
export function ourExecution(trade) {
  const agg = trade.aggressorExecution;
  const pas = trade.passiveExecution;
  if (trade.isAggressor === true) return { exec: agg || null, order: (agg && agg.order) || trade.aggressor || null, role: "taker" };
  return { exec: pas || null, order: (pas && pas.order) || trade.passive || null, role: "maker" };
}

/** { action: "buy"|"sell", outcome: "long"|"short" } from an order, or null. */
export function sideFromOrder(order) {
  const intent = str(order && (order.intent || order.orderIntent)).toUpperCase();
  if (intent.includes("BUY_LONG")) return { action: "buy", outcome: "long" };
  if (intent.includes("SELL_LONG")) return { action: "sell", outcome: "long" };
  if (intent.includes("BUY_SHORT")) return { action: "buy", outcome: "short" };
  if (intent.includes("SELL_SHORT")) return { action: "sell", outcome: "short" };
  const side = str(order && order.outcomeSide).toUpperCase();
  const act = str(order && order.action).toUpperCase();
  const isNo = side.includes("NO");
  const isYes = side.includes("YES");
  const isBuy = act.includes("BUY");
  const isSell = act.includes("SELL");
  if ((isYes || isNo) && (isBuy || isSell)) {
    return { action: isBuy ? "buy" : "sell", outcome: isNo ? "short" : "long" };
  }
  return null;
}

/** Side of our order on a trade (from its execution's order), or null. */
export function tradeOrderSide(trade) {
  if (!trade || typeof trade !== "object") return null;
  return sideFromOrder(ourExecution(trade).order);
}
