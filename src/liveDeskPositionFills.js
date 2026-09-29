// Drill-down for one "Open positions" card on the private Live Trading Desk.
//
// The card is a blended average: one row per market slug, legs netted on the
// long instrument (long minus short), shown as contracts on the team that net
// holds (PR #224 "true net position"). This module takes the individual fills
// for that same slug (mapFilledOrders rows from PR #244) and works out which
// of them make up the position that is open now, then reconciles a subtotal
// back to the card's contracts and cost.
//
// Which fills: walk newest -> oldest from the card's signed instrument net,
// undoing each fill, until the net was flat (or on the other team). Those
// fills opened and built the current position; anything older was closed out.
// If history runs out first, the fetched fills only partly explain the
// position and the remainder is reported as older than the fetched window.
//
// Subtotal: replay those fills oldest -> newest with the same average-cost
// book as the desk (a reducing fill removes cost pro rata, an opening fill
// adds contracts at its price), so the result is comparable to the card.
import { americanFromProb, formatAmerican } from "./liveDeskPrice.js";
import { fillTimeMs } from "./liveDeskFills.js";

const EPS = 1e-6;
export const POSITION_FILLS_PAGE_LIMIT = 100;
export const POSITION_FILLS_MAX_PAGES = 5;
export const COST_TOLERANCE = 0.05;

function roundQty(n) {
  return Math.round(n * 10000) / 10000;
}

function roundCents(n) {
  return Math.round(n * 100) / 100;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Signed change to the long instrument, same keys as the desk position:
 * buy long / sell short add, buy short / sell long subtract. Unknown -> null.
 */
export function fillInstrumentDelta(fill) {
  if (!fill || typeof fill !== "object") return null;
  const qty = num(fill.contracts);
  if (qty == null || qty === 0) return null;
  const mag = Math.abs(qty);
  const a = String(fill.action || "");
  const o = String(fill.outcome || "");
  if ((a === "buy" && o === "long") || (a === "sell" && o === "short")) return mag;
  if ((a === "buy" && o === "short") || (a === "sell" && o === "long")) return -mag;
  return null;
}

/** Price per contract of the side this fill opens (long or short instrument), 0..1. */
function openPrice(fill, openSide) {
  const qty = Math.abs(num(fill.contracts) || 0);
  const cost = num(fill.cost);
  const perContract = qty > 0 && cost != null && cost >= 0 ? cost / qty : null;
  const sameOutcome = fill.outcome === openSide;
  if (perContract != null && perContract > 0 && perContract < 1) {
    // Buying the held side: cost per contract. Selling the other side opens
    // the held side at 1 - proceeds per contract.
    return sameOutcome && fill.action === "buy" ? perContract : 1 - perContract;
  }
  const micro = num(fill.fillMicro);
  if (micro == null || !(micro > 0 && micro < 1_000_000)) return null;
  const p = micro / 1_000_000;
  return sameOutcome ? p : 1 - p;
}

function emptyBook() {
  return { longQty: 0, longCost: 0, shortQty: 0, shortCost: 0, unpriced: false };
}

function apply(book, fill, delta) {
  const qty = Math.abs(delta);
  const [same, opp] = delta > 0 ? ["long", "short"] : ["short", "long"];
  const oppQty = book[opp + "Qty"];
  const cover = Math.min(oppQty, qty);
  if (cover > 0) {
    book[opp + "Cost"] -= book[opp + "Cost"] * (cover / oppQty);
    book[opp + "Qty"] = oppQty - cover;
  }
  const open = qty - cover;
  if (open > EPS) {
    book[same + "Qty"] += open;
    const p = openPrice(fill, same);
    if (p == null) book.unpriced = true;
    else book[same + "Cost"] += open * p;
  }
}

function money(n) {
  return n == null || !Number.isFinite(n) ? "" : (n < 0 ? "−$" : "$") + Math.abs(n).toFixed(2);
}

function qtyLabel(n) {
  return n == null || !Number.isFinite(n) ? "" : String(roundQty(n));
}

function avgAmerican(contracts, cost) {
  if (!(contracts > 0) || cost == null) return "";
  const p = cost / contracts;
  return p > 0 && p < 1 ? (formatAmerican(americanFromProb(p)) || "") : "";
}

/**
 * @param {object} position  Open-positions row (slug, instrumentNet, net, cost, team).
 * @param {object[]} fills   mapFilledOrders rows (any slugs, any order).
 * @param {{ complete?: boolean }} opts  complete = the fetch reached the start
 *   of this market's history (eof), so nothing older exists.
 */
export function reconcilePosition(position, fills, { complete = false } = {}) {
  const slug = String((position && position.slug) || "");
  const signedNet = num(position && (position.instrumentNet != null ? position.instrumentNet : position.net));
  const cardContracts = signedNet == null ? null : Math.abs(roundQty(signedNet));
  const cardCost = num(position && position.cost);
  const heldSide = signedNet != null && signedNet < 0 ? "short" : "long";
  const mine = (Array.isArray(fills) ? fills : [])
    .filter((f) => f && typeof f === "object" && String(f.marketSlug || "") === slug)
    .slice()
    .sort((a, b) => fillTimeMs(b.time) - fillTimeMs(a.time));

  const rows = [];
  let running = signedNet || 0;
  let opened = false;
  let baseline = 0;
  let unknown = 0;
  for (const fill of mine) {
    const delta = fillInstrumentDelta(fill);
    if (delta == null) {
      unknown += 1;
      rows.push({ ...fill, inPosition: true, sideUnknown: true });
      continue;
    }
    const pre = roundQty(running - delta);
    // +1 adds to the held team (e.g. Buy Packers or Sell Falcons), -1 reduces it.
    rows.push({ ...fill, inPosition: true, delta, effect: Math.sign(delta) === Math.sign(signedNet) ? 1 : -1 });
    if (Math.abs(pre) < EPS || Math.sign(pre) !== Math.sign(signedNet)) {
      opened = true;
      baseline = Math.abs(pre) < EPS ? 0 : pre;
      break;
    }
    running = pre;
  }
  const olderCount = mine.length - rows.length;
  // Contracts still unexplained when we ran out of fetched history (signed).
  const remainder = opened ? 0 : roundQty(running);

  const book = emptyBook();
  if (baseline > 0) book.longQty = baseline;
  if (baseline < 0) book.shortQty = -baseline;
  // Unexplained older contracts sit in the book with unknown cost (0 here);
  // their share of cost is reported as the gap to the card.
  if (remainder > 0) book.longQty += remainder;
  if (remainder < 0) book.shortQty += -remainder;
  const buys = { count: 0, contracts: 0, cost: 0 };
  const sells = { count: 0, contracts: 0, proceeds: 0 };
  const adds = { count: 0, contracts: 0 };
  const reduces = { count: 0, contracts: 0 };
  for (const row of rows.slice().reverse()) {
    if (row.sideUnknown) continue;
    apply(book, row, row.delta);
    const c = Math.abs(num(row.contracts) || 0);
    const cost = num(row.cost) || 0;
    const bucket = row.effect > 0 ? adds : reduces;
    bucket.count += 1; bucket.contracts += c;
    if (row.action === "sell") {
      sells.count += 1; sells.contracts += c; sells.proceeds += cost;
    } else {
      buys.count += 1; buys.contracts += c; buys.cost += cost;
    }
  }
  const heldQty = heldSide === "short" ? book.shortQty : book.longQty;
  const heldCost = heldSide === "short" ? book.shortCost : book.longCost;
  const explainedContracts = roundQty(heldQty - Math.abs(remainder));
  const replayContracts = roundQty(heldQty);
  const subtotalCost = roundCents(heldCost);
  const contractsMatch = cardContracts != null && Math.abs(replayContracts - cardContracts) < 0.01;
  const costDiff = cardCost == null ? null : roundCents(cardCost - subtotalCost);
  const partial = !opened;
  const reconciled = opened && contractsMatch && unknown === 0 && !book.unpriced
    && (costDiff == null || Math.abs(costDiff) <= COST_TOLERANCE);

  let note = "";
  if (!rows.length) {
    note = complete
      ? "No fills found for this market in Polymarket US activity."
      : "No fills for this market in the fetched history.";
  } else if (partial) {
    const older = qtyLabel(Math.abs(remainder));
    note = complete
      ? "Fills in Polymarket US activity explain " + qtyLabel(explainedContracts) + " of " + qtyLabel(cardContracts)
        + " contracts. The other " + older + " did not come from a trade fill in the history (e.g. a transfer or settlement adjustment)."
      : "Partial: fetched fills explain " + qtyLabel(explainedContracts) + " of " + qtyLabel(cardContracts)
        + " contracts. " + older + " contracts" + (costDiff != null ? " (≈" + money(costDiff) + ")" : "")
        + " come from older fills beyond the fetched history.";
  } else if (unknown) {
    note = unknown + " fill" + (unknown === 1 ? "" : "s") + " had no readable buy/sell side and are not in the subtotal.";
  } else if (!contractsMatch) {
    note = "Fills replay to " + qtyLabel(replayContracts) + " contracts; the card shows " + qtyLabel(cardContracts) + ".";
  } else if (costDiff != null && Math.abs(costDiff) > COST_TOLERANCE) {
    note = "Contracts match. Cost differs from the card by " + money(costDiff)
      + " (Polymarket's cost basis vs. fill prices, e.g. fees or rounding).";
  }

  return {
    slug,
    team: String((position && position.team) || ""),
    rows,
    olderClosedCount: olderCount,
    heldSide,
    card: { contracts: cardContracts, cost: cardCost, costLabel: money(cardCost), avgAmerican: String((position && position.avgAmerican) || "") },
    subtotal: {
      contracts: partial ? explainedContracts : replayContracts,
      contractsLabel: qtyLabel(partial ? explainedContracts : replayContracts),
      cost: partial ? null : subtotalCost,
      costLabel: partial ? money(subtotalCost) : money(subtotalCost),
      avgAmerican: partial ? "" : avgAmerican(replayContracts, subtotalCost),
    },
    buys: { ...buys, contracts: roundQty(buys.contracts), cost: roundCents(buys.cost), costLabel: money(buys.cost) },
    sells: { ...sells, contracts: roundQty(sells.contracts), proceeds: roundCents(sells.proceeds), proceedsLabel: money(sells.proceeds) },
    adds: { count: adds.count, contracts: roundQty(adds.contracts) },
    reduces: { count: reduces.count, contracts: roundQty(reduces.contracts) },
    costDiff,
    contractsMatch,
    partial,
    complete: !!complete,
    reconciled,
    unknownSides: unknown,
    note,
  };
}

/** True once the fetched fills already reach the start of the open position. */
export function reachesOpen(position, fills) {
  const r = reconcilePosition(position, fills, { complete: false });
  return r.rows.length > 0 && !r.partial;
}

/** Filled orders filter: "desk" keeps rows tagged Desk (incl. Bet Protect); "all" keeps everything. */
export const FILLS_FILTER_KEY = "abb.liveDesk.filledOrdersFilter";
export function filterFills(fills, mode) {
  const rows = (Array.isArray(fills) ? fills : []).filter((r) => r && typeof r === "object");
  if (mode === "all") return rows;
  return rows.filter((r) => r.source === "desk" || !!r.protect);
}
export function readFillsFilter(storage) {
  try {
    const v = storage && storage.getItem(FILLS_FILTER_KEY);
    return v === "all" ? "all" : "desk";
  } catch (_) {
    return "desk";
  }
}
export function writeFillsFilter(storage, mode) {
  try { if (storage) storage.setItem(FILLS_FILTER_KEY, mode === "all" ? "all" : "desk"); } catch (_) { /* private mode */ }
}
