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

const TERMINAL = new Set(["filled", "canceled", "partial_canceled", "expired", "partial_expired"]);
export const TERMINAL_TRACK_STATES = ["filled", "canceled", "partial_canceled", "expired", "partial_expired"];
export const TRACK_LOOKUP_LIMIT = 3;
export const FAILURE_STOP = 6;
export const REOPEN_LIMIT = 3;

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
  if (s.includes("EXPIRED")) return cumQty > 0 ? "partial_expired" : "expired";
  if (s.includes("PARTIAL")) return "partial";
  if (s.includes("PENDING")) return cumQty > 0 ? "partial" : "open";
  if (s.includes("FILLED")) return "filled";
  if (s.includes("CANCEL") || s.includes("REPLACED") || s.includes("REJECT")) {
    return cumQty > 0 ? "partial_canceled" : "canceled";
  }
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
    totalFailures: Number(src.totalFailures != null ? src.totalFailures : src.total_failures) || 0,
    reopenCount: Number(src.reopenCount != null ? src.reopenCount : src.reopen_count) || 0,
    readFailed: !!(src.readFailed || src.transient),
    stopped: !!src.stopped,
  };
}

const REPLACEABLE = new Set(["canceled", "partial_canceled", "expired", "partial_expired"]);

/**
 * A cancel HTTP success is not a fill report. Without an official order
 * payload the record stays unreconciled and must not be stored as a
 * zero-fill cancel.
 */
export function protectCancelRecord(row, { replacedBy, at, official } = {}) {
  const base = {
    orderId: row && row.order_id,
    ownerEmail: row && row.owner_email,
    marketSlug: row && row.market_slug,
    replaces: (row && row.replaces) || null,
    replacedBy: replacedBy || (row && row.replaced_by) || null,
    lineageId: (row && row.lineage_id) || null,
    terminalAt: at || null,
  };
  if (official && !official.transient && official.verifiedState && official.verifiedState !== "unknown") {
    return { ...official, ...base, source: official.source || "get_order", transient: false, readFailed: false };
  }
  return {
    ...base,
    verifiedState: "unknown",
    unknownReason: "cancel_unreconciled",
    source: "protect_cancel",
    transient: true,
    readFailed: true,
    cumQty: null,
  };
}

/**
 * Replace only after the exchange confirms the order is terminal and how
 * much already executed. Unknown quantity or unknown fill cost → no new order.
 * Room is the $1000 desk cap minus this order's executed notional and any
 * already-counted lineage spend. Remainder is original quantity minus cumQty.
 */
export function executedRiskDollars(row, { outcome, action } = {}) {
  const cum = num(row && (row.cumQty != null ? row.cumQty : row.cumQuantity));
  if (!(cum > 0)) return { known: true, dollars: 0 };
  const avgYes = num(row && (row.avgYesPrice != null ? row.avgYesPrice : row.avgPx));
  if (avgYes == null) return { known: false, dollars: null };
  const short = (outcome || row.outcome) === "short";
  const outcomePx = short ? 1 - avgYes : avgYes;
  if (!(outcomePx > 0 && outcomePx < 1)) return { known: false, dollars: null };
  const sell = (action || row.action) === "sell";
  const riskPx = sell ? 1 - outcomePx : outcomePx;
  return { known: true, dollars: cum * riskPx };
}

export function lineagePriorSpent(rows, { excludeOrderId, outcome, action } = {}) {
  let dollars = 0;
  for (const row of rows || []) {
    if (!row || row.orderId === excludeOrderId) continue;
    const part = executedRiskDollars(row, {
      outcome: row.outcome || outcome,
      action: row.action || action,
    });
    if (!part.known) return { known: false, dollars: null };
    dollars += part.dollars;
  }
  return { known: true, dollars };
}

export function replacementGate({
  official,
  observedLeaves,
  priorSpentDollars = 0,
  priorKnown = true,
  capDollars = 1000,
  outcomeShort = false,
  action = "buy",
} = {}) {
  if (priorKnown === false) return { replace: false, reason: "prior-spent-unknown" };
  if (!official || official.transient || official.readFailed || official.verifiedState === "unknown") {
    return { replace: false, reason: "unconfirmed" };
  }
  if (official.verifiedState === "filled") {
    return { replace: false, reason: "filled", cumQty: official.cumQty };
  }
  if (official.verifiedState === "open" || official.verifiedState === "partial") {
    return { replace: false, reason: "still-open", cumQty: official.cumQty };
  }
  if (!REPLACEABLE.has(official.verifiedState)) {
    return { replace: false, reason: "unconfirmed" };
  }
  if (official.orderQty == null || official.cumQty == null) {
    return { replace: false, reason: "qty-unknown", cumQty: official.cumQty };
  }
  const remainder = official.orderQty - official.cumQty;
  if (!(remainder > 1e-9)) {
    return { replace: false, reason: "nothing-left", cumQty: official.cumQty, remainder: 0 };
  }
  const spentPart = executedRiskDollars(official, {
    outcome: outcomeShort ? "short" : "long",
    action,
  });
  if (!spentPart.known) {
    return { replace: false, reason: "fill-cost-unknown", cumQty: official.cumQty, remainder };
  }
  const spent = spentPart.dollars;
  const room = capDollars - Number(priorSpentDollars || 0) - spent;
  if (!(room > 1e-6)) {
    return { replace: false, reason: "chain-cap", cumQty: official.cumQty, remainder, spent, roomDollars: 0 };
  }
  const observed = observedLeaves == null ? remainder : Number(observedLeaves);
  const leaves = Math.min(observed, remainder);
  if (!(leaves > 1e-9)) {
    return { replace: false, reason: "nothing-left", cumQty: official.cumQty, remainder, roomDollars: room };
  }
  return {
    replace: true,
    leaves,
    remainder,
    cumQty: official.cumQty,
    spent,
    roomDollars: room,
    avgYesPrice: official.avgYesPrice,
  };
}

export function mergeVerifiedTrack(previous, incoming) {
  const next = blank(incoming);
  if (!previous) {
    if (next.readFailed) {
      next.resolveAttempts = 1;
      next.totalFailures = 1;
      next.stopped = next.totalFailures >= FAILURE_STOP;
    }
    return next;
  }
  const prev = blank(previous);
  next.orderId = next.orderId || prev.orderId;
  next.ownerEmail = next.ownerEmail || prev.ownerEmail;
  next.marketSlug = next.marketSlug || prev.marketSlug;
  next.replaces = next.replaces || prev.replaces;
  next.replacedBy = next.replacedBy || prev.replacedBy;
  next.lineageId = next.lineageId || prev.lineageId;
  next.totalFailures = prev.totalFailures;
  next.reopenCount = prev.reopenCount;

  const failed = next.readFailed
    || next.unknownReason === "not_found"
    || next.unknownReason === "read_error"
    || next.unknownReason === "disappeared"
    || next.unknownReason === "cancel_unreconciled";
  if (failed && next.verifiedState === "unknown") {
    if (TERMINAL.has(prev.verifiedState)) return { ...prev, readFailed: true };
    const attempts = (prev.resolveAttempts || 0) + 1;
    const total = (prev.totalFailures || 0) + 1;
    const stopped = attempts >= RESOLVE_ATTEMPT_LIMIT || total >= FAILURE_STOP;
    return {
      ...prev,
      verifiedState: "unknown",
      unknownReason: next.unknownReason || prev.unknownReason || "not_found",
      resolveAttempts: attempts,
      totalFailures: total,
      readFailed: true,
      stopped,
      replacedBy: next.replacedBy || prev.replacedBy,
      source: prev.source || next.source,
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
  if ((prev.verifiedState === "unknown" || prev.stopped) && (next.verifiedState === "open" || next.verifiedState === "partial")) {
    const reopenCount = (prev.reopenCount || 0) + 1;
    if (reopenCount > REOPEN_LIMIT) {
      return { ...prev, reopenCount, stopped: true };
    }
    next.reopenCount = reopenCount;
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
  next.stopped = false;
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

export function tracksNeedingLookup(rows, openIds, limit = TRACK_LOOKUP_LIMIT) {
  const open = new Set((openIds || []).map((id) => String(id || "")));
  const out = [];
  const cap = Number(limit) > 0 ? Number(limit) : TRACK_LOOKUP_LIMIT;
  for (const row of rows || []) {
    if (!row || row.stopped) continue;
    if ((row.totalFailures || 0) >= FAILURE_STOP) continue;
    if (open.has(String(row.orderId || ""))) continue;
    if (row.verifiedState !== "open" && row.verifiedState !== "partial" && row.verifiedState !== "unknown") continue;
    out.push(row);
    if (out.length >= cap) break;
  }
  return out;
}

export function sameTrack(a, b) {
  if (!a || !b) return false;
  return trackFacts(a) === trackFacts(b);
}
