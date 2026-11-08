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
