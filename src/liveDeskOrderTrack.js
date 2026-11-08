// Verified Polymarket US order state for the Live Trading Desk.
//
// GET /v1/order/{orderId} returns an Order (docs.polymarket.us): state,
// quantity, cumQuantity, leavesQuantity, avgPx, commissionNotionalTotalCollected,
// createTime. Open orders use the same Order. Activities are executions, not
// a substitute for that state.
//
// Disappearing from GET /v1/orders/open is not a fill, a cancel, or an expiry.
// A 404 or a dropped read stays unknown until an official order payload says
// otherwise. A later read of the same official payload does not create a
// second record.

export const RESOLVE_ATTEMPT_LIMIT = 3;
export const RESOLVE_COOLDOWN_MS = 60_000;

const TERMINAL = new Set(["filled", "canceled", "expired"]);

function amount(v) {
  if (v == null || v === "") return null;
  if (typeof v === "object") return amount(v.value);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v) {
  return v == null ? "" : String(v).trim();
}

export function officialOrder(payload) {
  if (!payload || typeof payload !== "object") return null;
  const wrapped = payload.order;
  if (wrapped && typeof wrapped === "object" && (wrapped.id || wrapped.state)) return wrapped;
  if (payload.id || payload.state) return payload;
  return null;
}

function stateFromExchange(exchangeState, cumQty, orderQty) {
  const s = String(exchangeState || "").toUpperCase();
  if (!s) {
    if (cumQty != null && orderQty != null && cumQty > 0 && cumQty + 1e-9 < orderQty) return "partial";
    if (cumQty != null && orderQty != null && orderQty > 0 && cumQty + 1e-9 >= orderQty) return "filled";
    return "unknown";
  }
  if (s.includes("EXPIRED")) return "expired";
  if (s.includes("PARTIAL")) return "partial";
  if (s.includes("PENDING")) return cumQty > 0 ? "partial" : "open";
  if (s.includes("FILLED")) return "filled";
  if (s.includes("CANCEL") || s.includes("REPLACED") || s.includes("REJECT")) return "canceled";
  if (s.includes("NEW")) return cumQty > 0 ? "partial" : "open";
  return "unknown";
}

/** Classify one official Order payload. Never treats a missing order as filled. */
export function classifyOfficialOrder(payload) {
  const raw = officialOrder(payload);
  if (!raw) {
    return {
      verifiedState: "unknown",
      unknownReason: "unseen",
      source: "get_order",
      transient: true,
      exchangeState: "",
    };
  }
  const exchangeState = text(raw.state);
  const orderQty = amount(raw.quantity);
  const cumQty = amount(raw.cumQuantity);
  const leavesQty = amount(raw.leavesQuantity);
  const verifiedState = stateFromExchange(exchangeState, cumQty, orderQty);
  const fees = amount(
    raw.commissionNotionalTotalCollected != null
      ? raw.commissionNotionalTotalCollected
      : raw.commissionNotionalCollected,
  );
  const when = text(raw.updateTime) || text(raw.createTime) || text(raw.insertTime) || null;
  return {
    verifiedState,
    exchangeState,
    orderQty,
    cumQty,
    leavesQty,
    avgYesPrice: amount(raw.avgPx),
    fees,
    cost: amount(raw.cashOrderQty),
    openedAt: text(raw.createTime) || text(raw.insertTime) || null,
    lastFillAt: cumQty > 0 ? when : null,
    terminalAt: TERMINAL.has(verifiedState) ? when : null,
    source: "get_order",
    transient: false,
    unknownReason: verifiedState === "unknown" ? "unrecognized_state" : "",
    readFailed: false,
  };
}

/**
 * Result of a lookup that may have failed. `disappeared` means the id was
 * absent from the open-order list and no order payload was returned.
 */
export function classifyLookup({ order, error, disappeared } = {}) {
  if (error) {
    const code = Number(error.statusCode);
    return {
      verifiedState: "unknown",
      unknownReason: code === 404 ? "not_found" : "read_error",
      source: "get_order",
      transient: true,
      exchangeState: "",
      readFailed: true,
    };
  }
  if (order) return classifyOfficialOrder(order);
  if (disappeared) {
    return {
      verifiedState: "unknown",
      unknownReason: "disappeared",
      source: "open_list",
      transient: true,
      exchangeState: "",
      readFailed: true,
    };
  }
  return {
    verifiedState: "unknown",
    unknownReason: "unseen",
    source: "none",
    transient: true,
    exchangeState: "",
    readFailed: true,
  };
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function blank(incoming) {
  const src = incoming || {};
  return {
    orderId: text(src.orderId || src.order_id),
    ownerEmail: text(src.ownerEmail || src.owner_email).toLowerCase(),
    marketSlug: text(src.marketSlug || src.market_slug),
    venue: "polymarket-us",
    verifiedState: text(src.verifiedState || src.verified_state) || "unknown",
    exchangeState: text(src.exchangeState || src.exchange_state),
    cumQty: num(src.cumQty != null ? src.cumQty : src.cum_qty),
    leavesQty: num(src.leavesQty != null ? src.leavesQty : src.leaves_qty),
    orderQty: num(src.orderQty != null ? src.orderQty : src.order_qty),
    avgYesPrice: num(src.avgYesPrice != null ? src.avgYesPrice : src.avg_yes_price),
    fees: num(src.fees),
    cost: num(src.cost),
    openedAt: src.openedAt || src.opened_at || null,
    lastFillAt: src.lastFillAt || src.last_fill_at || null,
    terminalAt: src.terminalAt || src.terminal_at || null,
    replaces: src.replaces || null,
    replacedBy: src.replacedBy || src.replaced_by || null,
    lineageId: src.lineageId || src.lineage_id || null,
    unknownReason: text(src.unknownReason || src.unknown_reason),
    source: text(src.source),
    resolveAttempts: Number(src.resolveAttempts != null ? src.resolveAttempts : src.resolve_attempts) || 0,
    readFailed: !!(src.readFailed || src.transient),
  };
}

/** Our own successful cancel is a cancel, not a fill. Quantity stays unset until an order payload has it. */
export function protectCancelRecord(row, { replacedBy, at } = {}) {
  return {
    orderId: row && row.order_id,
    ownerEmail: row && row.owner_email,
    marketSlug: row && row.market_slug,
    verifiedState: "canceled",
    exchangeState: "",
    source: "protect_cancel",
    transient: false,
    replacedBy: replacedBy || (row && row.replaced_by) || null,
    replaces: (row && row.replaces) || null,
    lineageId: (row && row.lineage_id) || null,
    terminalAt: at || null,
    cumQty: null,
    unknownReason: "",
  };
}

export function mergeVerifiedTrack(previous, incoming) {
  const next = blank(incoming);
  if (!previous) {
    if (next.readFailed) next.resolveAttempts = 1;
    return next;
  }
  const prev = blank(previous);
  next.orderId = next.orderId || prev.orderId;
  next.ownerEmail = next.ownerEmail || prev.ownerEmail;
  next.marketSlug = next.marketSlug || prev.marketSlug;
  next.replaces = next.replaces || prev.replaces;
  next.replacedBy = next.replacedBy || prev.replacedBy;
  next.lineageId = next.lineageId || prev.lineageId;

  const failed = next.readFailed
    || next.unknownReason === "not_found"
    || next.unknownReason === "read_error"
    || next.unknownReason === "disappeared";
  if (failed && next.verifiedState === "unknown") {
    if (TERMINAL.has(prev.verifiedState)) return { ...prev, readFailed: true };
    const attempts = (prev.resolveAttempts || 0) + 1;
    if (attempts >= RESOLVE_ATTEMPT_LIMIT) {
      return {
        ...prev,
        verifiedState: "unknown",
        unknownReason: next.unknownReason || "not_found",
        resolveAttempts: attempts,
        readFailed: true,
        source: prev.source || next.source,
      };
    }
    return {
      ...prev,
      unknownReason: next.unknownReason || prev.unknownReason,
      resolveAttempts: attempts,
      readFailed: true,
    };
  }

  if (TERMINAL.has(prev.verifiedState) && !TERMINAL.has(next.verifiedState)) {
    return {
      ...prev,
      replacedBy: next.replacedBy || prev.replacedBy,
      replaces: next.replaces || prev.replaces,
      readFailed: false,
    };
  }
  if (next.cumQty == null) next.cumQty = prev.cumQty;
  if (next.avgYesPrice == null) next.avgYesPrice = prev.avgYesPrice;
  if (next.fees == null) next.fees = prev.fees;
  if (next.cost == null) next.cost = prev.cost;
  if (next.orderQty == null) next.orderQty = prev.orderQty;
  if (next.leavesQty == null) next.leavesQty = prev.leavesQty;
  if (!next.openedAt) next.openedAt = prev.openedAt;
  next.resolveAttempts = 0;
  next.readFailed = false;
  return next;
}

function factNum(v) {
  const n = num(v);
  return n == null ? "" : String(Math.round(n * 1e8) / 1e8);
}

export function trackFacts(row) {
  const r = blank(row);
  return [
    r.orderId,
    r.verifiedState,
    r.exchangeState,
    factNum(r.cumQty),
    factNum(r.leavesQty),
    factNum(r.orderQty),
    factNum(r.avgYesPrice),
    factNum(r.fees),
    factNum(r.cost),
    r.unknownReason,
    r.replacedBy || "",
    r.replaces || "",
    r.lineageId || "",
    r.source,
    String(r.resolveAttempts || 0),
    r.lastFillAt || "",
    r.terminalAt || "",
  ].join("|");
}

export function sameTrack(a, b) {
  if (!a || !b) return false;
  return trackFacts(a) === trackFacts(b);
}
