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

export const DEFAULT_PROTECT_X_CENTS = 3;
export const DEFAULT_PROTECT_Y_CENTS = 1;
export const MAX_PROTECTS_PER_LINEAGE = 8;
export const PROTECT_COOLDOWN_MS = 1000;
export const PROTECT_STALE_SWEEP_MS = 15000;

const MICRO = 1_000_000;

export function centsToMicro(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10_000);
}

export function parseProtectCents(raw, fallback, { min = 0, max = 25 } = {}) {
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

export function readProtectRequest(body) {
  const raw = body || {};
  const flag = raw.protect;
  const on = flag === true || flag === 1 || flag === "1" || flag === "true";
  if (!on) return { ok: true, on: false };
  const x = parseProtectCents(raw.protectXCents != null ? raw.protectXCents : raw.xCents, DEFAULT_PROTECT_X_CENTS, { min: 0.1 });
  if (!x.ok) return { ok: false, on: true, error: "Through-mid (X): " + x.error };
  const y = parseProtectCents(raw.protectYCents != null ? raw.protectYCents : raw.yCents, DEFAULT_PROTECT_Y_CENTS, { min: 0 });
  if (!y.ok) return { ok: false, on: true, error: "Re-rest (Y): " + y.error };
  return { ok: true, on: true, xCents: x.cents, yCents: y.cents };
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
 * Buy is through when the rest is more than X¢ above the outcome mid
 * (bidding a stale high price). Sell is through when the rest is more than
 * X¢ below the outcome mid. Exactly X¢, or a rest on the safe side of mid,
 * does not fire. Protect does not chase a market that ran away.
 */
export function evaluateProtect({ action, restingOutcomeMicro, midOutcomeMicro, xCents } = {}) {
  const act = normalizeAction(action);
  const rest = Math.round(Number(restingOutcomeMicro));
  const mid = Math.round(Number(midOutcomeMicro));
  const xMicro = centsToMicro(xCents);
  if (!act || !Number.isFinite(rest) || !Number.isFinite(mid) || xMicro == null) {
    return { fire: false, reason: "unpriced", gapMicro: null };
  }
  const gapMicro = act === "buy" ? rest - mid : mid - rest;
  if (gapMicro < 0) return { fire: false, reason: "ran-away", gapMicro };
  if (gapMicro <= xMicro) return { fire: false, reason: "inside", gapMicro };
  return { fire: true, reason: "through", gapMicro };
}

/**
 * New rest at outcome mid ∓ Y¢, then the Desk V1 tick snap.
 * Buy must land strictly lower than the cancelled rest. Sell strictly higher.
 */
export function improveFromMid({
  outcome,
  action,
  midOutcomeMicro,
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
  if (!act || !side || !Number.isFinite(mid) || yMicro == null) {
    return { ok: false, error: "Cannot price a re-rest.", code: "no-improve" };
  }
  const target = act === "buy" ? mid - yMicro : mid + yMicro;
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
      midOutcomeMicro: mid,
      xCents,
    });
    if (still.fire) {
      return { ok: false, error: "Re-rest would still be through the mid.", code: "no-improve", snap };
    }
  }
  return { ok: true, ...snap, targetMicro: target };
}

export function protectContracts({ leaves, outcomeMicro, action, minQty } = {}) {
  const n = Number(leaves);
  if (!(n > 0)) return { ok: false, error: "No size left on the resting order." };
  const cap = sizeToContracts({
    dollars: MAX_SIZE_DOLLARS,
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
  if (!(riskDollars <= MAX_SIZE_DOLLARS + 1e-6)) {
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
