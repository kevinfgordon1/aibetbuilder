// One Filled-orders summary per Polymarket order id.
//
// Executions stay inside the row. The average is the quantity-weighted
// outcome price, then converted to American once. American odds are not
// averaged. Partial and full are shown only when an official order total
// (quantity plus cumQuantity or order state, or a verified track) says so.
// Two fills of the same game stay apart when their order ids differ.
// The same trade id is one execution.

import { americanFromMicro, formatAmerican } from "./liveDeskPrice.js";
import { fillTimeMs } from "./liveDeskFills.js";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v) {
  return v == null ? "" : String(v).trim();
}

function money(n) {
  if (n == null || !Number.isFinite(n)) return "";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toFixed(2);
}

function contractsLabel(n) {
  if (n == null || !Number.isFinite(n)) return "";
  const r = Math.round(n * 10000) / 10000;
  return Number.isInteger(r) ? String(r) : String(r);
}

export function compactOrderId(id) {
  const s = text(id);
  if (!s) return "";
  if (s.length <= 14) return s;
  return s.slice(0, 4) + "…" + s.slice(-4);
}

function dedupeExecutions(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const tradeId = text(row && row.tradeId);
    if (tradeId) {
      if (seen.has(tradeId)) continue;
      seen.add(tradeId);
    }
    out.push(row);
  }
  return out;
}

function newest(rows) {
  return rows.reduce((best, row) => (fillTimeMs(row && row.time) >= fillTimeMs(best && best.time) ? row : best), rows[0]);
}

function verifiedOf(rows) {
  const withState = rows.filter((row) => row && row.verified && text(row.verified.state));
  if (!withState.length) return null;
  return newest(withState).verified;
}

function firstText(rows, field) {
  for (const row of rows) {
    const value = text(row && row[field]);
    if (value) return value;
  }
  return "";
}

function embeddedEvidence(rows) {
  const withTotal = rows.filter((row) => num(row && row.orderQty) != null || text(row && row.orderState));
  if (!withTotal.length) return null;
  return newest(withTotal);
}

/**
 * partial | full only with an order total. canceled and expired come from
 * an official state. No badge when the only fact is that executions exist.
 */
export function fillGroupStatus(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const verified = verifiedOf(list);
  const state = text(verified && verified.state);
  if (state === "filled") return "full";
  if (state === "partial") return "partial";
  if (state === "canceled" || state === "partial_canceled") return "canceled";
  if (state === "expired" || state === "partial_expired") return "expired";
  const embedded = embeddedEvidence(list);
  if (!embedded) return null;
  const orderState = text(embedded.orderState).toUpperCase();
  const orderQty = num(embedded.orderQty);
  const orderCum = num(embedded.orderCum);
  if (orderState.includes("EXPIRED")) return "expired";
  if (orderState.includes("CANCEL") || orderState.includes("REPLACED") || orderState.includes("REJECT")) return "canceled";
  if (orderState.includes("PARTIAL")) return orderQty != null ? "partial" : null;
  if (orderState.includes("FILLED")) return orderQty != null || orderCum != null ? "full" : null;
  if (orderQty == null || orderCum == null) return null;
  if (orderCum > 0 && orderCum + 1e-9 < orderQty) return "partial";
  if (orderQty > 0 && orderCum + 1e-9 >= orderQty) return "full";
  return null;
}

function progressOf(rows, status) {
  if (status !== "partial" && status !== "full" && status !== "canceled" && status !== "expired") return "";
  const verified = verifiedOf(rows);
  const vQty = num(verified && verified.orderQty);
  const vCum = num(verified && verified.cumQty);
  if (vQty != null && vCum != null) return contractsLabel(vCum) + " of " + contractsLabel(vQty);
  const embedded = embeddedEvidence(rows);
  const orderQty = num(embedded && embedded.orderQty);
  const orderCum = num(embedded && embedded.orderCum);
  if (orderQty == null || orderCum == null) return "";
  return contractsLabel(orderCum) + " of " + contractsLabel(orderQty);
}

function weightedAmerican(rows) {
  let qty = 0;
  let weighted = 0;
  for (const row of rows) {
    const contracts = num(row && row.contracts);
    const micro = num(row && row.fillMicro);
    if (!(contracts > 0) || micro == null) continue;
    qty += contracts;
    weighted += micro * contracts;
  }
  if (!(qty > 0)) return { avgAmerican: "", avgMicro: null };
  const avgMicro = Math.round(weighted / qty);
  return { avgAmerican: formatAmerican(americanFromMicro(avgMicro)) || "", avgMicro };
}

function sumIfComplete(rows, field) {
  let total = 0;
  for (const row of rows) {
    const n = num(row && row[field]);
    if (n == null) return null;
    total += n;
  }
  return Math.round(total * 100) / 100;
}

function executionView(row) {
  const fee = num(row.fee);
  return {
    id: text(row.tradeId) || text(row.id),
    time: text(row.time),
    timeEt: text(row.timeEt),
    contracts: num(row.contracts),
    contractsLabel: text(row.contractsLabel),
    fillAmerican: text(row.fillAmerican),
    cost: num(row.cost),
    costLabel: text(row.costLabel),
    costKind: text(row.costKind),
    fee,
    feeLabel: fee == null ? "" : money(fee),
  };
}

export function groupFillsByOrder(fills) {
  const rows = dedupeExecutions((Array.isArray(fills) ? fills : []).filter((row) => row && typeof row === "object"));
  const buckets = new Map();
  for (const row of rows) {
    const orderId = text(row.orderId);
    const key = orderId || ("fill:" + (text(row.tradeId) || text(row.id) || "row-" + buckets.size));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const groups = [];
  for (const [key, list] of buckets) {
    const ordered = list.slice().sort((a, b) => fillTimeMs(b.time) - fillTimeMs(a.time));
    const head = newest(ordered);
    const contracts = ordered.reduce((sum, row) => sum + (num(row.contracts) || 0), 0);
    const { avgAmerican, avgMicro } = weightedAmerican(ordered);
    const cost = sumIfComplete(ordered, "cost");
    const fees = sumIfComplete(ordered, "fee");
    const status = fillGroupStatus(ordered);
    const sells = ordered.every((row) => row.costKind === "proceeds");
    const protect = ordered.map((row) => row.protect).find((p) => p && typeof p === "object") || null;
    const replacedBy = firstText(ordered, "replacedBy");
    const replaces = firstText(ordered, "replaces");
    groups.push({
      key,
      orderId: text(head.orderId),
      compactOrderId: compactOrderId(head.orderId),
      game: text(head.game),
      market: text(head.market),
      sideLabel: text(head.sideLabel),
      team: text(head.team),
      time: text(head.time),
      timeEt: text(head.timeEt),
      contracts,
      contractsLabel: contractsLabel(contracts),
      avgAmerican,
      avgMicro,
      cost,
      costLabel: cost == null ? "" : money(cost),
      costKind: sells ? "proceeds" : "cost",
      fees,
      feesLabel: fees == null ? "" : money(fees),
      status,
      progress: progressOf(ordered, status),
      protect,
      source: text(head.source),
      venue: text(head.venue),
      replacedBy,
      replaces,
      executionCount: ordered.length,
      executions: ordered.map(executionView),
    });
  }
  groups.sort((a, b) => fillTimeMs(b.time) - fillTimeMs(a.time) || text(a.orderId).localeCompare(text(b.orderId)));
  return groups;
}
