// Edit fill odds + open-quote cancel helpers for Combo Locks.
// Pure: no fetch, no supabase. Used by the UI and api/combo-lock-orders.

import { buyerSeesAfterFees } from "./buyerOdds.js";
import { COMBO_FEE_RATE, allInFromExchange, exchangeFromAllIn } from "./comboCredits.js";
import { hedgeCap, lockKind } from "./comboLockProfile.js";
import { etDateTime, fmtAmerican } from "./comboLockView.js";

export { COMBO_FEE_RATE, allInFromExchange, exchangeFromAllIn };

/** Same American-odds gate the create form uses (!+form.fill and ±100 band). */
export function validateFillAmerican(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return { ok: false, error: "Enter fill odds as American odds (for example +1200 or -150)." };
  if (n > -100 && n < 100) return { ok: false, error: "American odds must be ≤ -100 or ≥ +100." };
  return { ok: true, american: n };
}

/**
 * Resolve what to store as fill_american from the user's typed price.
 * Fee users type all-in (incl. 1%); fee-free type the exchange sell price (same as create).
 */
export function resolveExchangeFill(typedAmerican, { feesEnabled = false, feeRate = COMBO_FEE_RATE } = {}) {
  const v = validateFillAmerican(typedAmerican);
  if (!v.ok) return v;
  if (!feesEnabled) return { ok: true, fillAmerican: v.american, typedAmerican: v.american, feesEnabled: false };
  const ex = exchangeFromAllIn(v.american, feeRate);
  if (ex == null) return { ok: false, error: "Could not convert that all-in price to an exchange price." };
  return { ok: true, fillAmerican: ex, typedAmerican: v.american, feesEnabled: true, allInAmerican: v.american };
}

/** Display price for the edit field: all-in for fee users, exchange otherwise. */
export function displayFillForEdit(parlay, { feesEnabled = false, feeRate = COMBO_FEE_RATE } = {}) {
  const ex = Number(parlay && parlay.fill_american);
  if (!Number.isFinite(ex) || ex === 0) return "";
  if (!feesEnabled) return String(ex);
  const allIn = allInFromExchange(ex, feeRate);
  return allIn == null ? String(ex) : String(allIn);
}

export function fillEditLabel(feesEnabled) {
  return feesEnabled ? "Your all-in price (includes 1% fee)" : "Sell at (odds you offer, after fees)";
}

/** "Edited Sat 10/10, 12:40 AM ET" — empty when never edited. */
export function fillEditedNote(parlay) {
  if (!parlay || !parlay.fill_edited_at) return "";
  const when = etDateTime(parlay.fill_edited_at, { weekday: true });
  return when ? `Fill odds edited ${when}` : "Fill odds edited";
}

/**
 * Open / pending unfilled quotes for a lock. Matched fills (is_live false, or
 * real order with executed fill) are excluded. Prefer is_live rows.
 */
export function openQuotesForLock(submissions, parlayId) {
  const pid = parlayId;
  const rows = (Array.isArray(submissions) ? submissions : []).filter((r) => {
    if (!r || r.parlay_id !== pid) return false;
    if (r.cancel_requested_at) return false;
    if (!(r.quote_id || r.order_id)) return false;
    // Live resting / awaiting quotes.
    if (r.is_live === true) return true;
    // Pending quoted status without a fill reconcile yet.
    const st = String(r.status || "").toLowerCase();
    return st === "quoted" || (st === "unfilled" && r.is_live === true);
  });
  return rows.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
}

export function openQuoteLabel(row) {
  if (!row) return "";
  const venue = row.venue === "polymarket" || row.venue === "polymarket_us" ? "Polymarket" : "Kalshi";
  const n = Number(row.contracts);
  const size = Number.isFinite(n) && n > 0 ? `${Math.round(n)} contracts` : "quote";
  const fill = Number(row.fill_american);
  const price = Number.isFinite(fill) && fill !== 0 ? ` @ ${fmtAmerican(fill)}` : "";
  const buyer = Number.isFinite(fill) && fill !== 0 ? buyerSeesAfterFees(fill, { venue: row.venue }) : null;
  return `${venue} · ${size}${price}${buyer ? ` · buyer sees ${buyer.text} after fees` : ""}`;
}

/**
 * Patch for combo_parlays after a validated fill edit.
 * Recalculates max_contracts like create; never below already-filled count.
 */
export function fillEditParlayPatch(parlay, fillAmerican, { filled = 0, now = new Date() } = {}) {
  const kind = lockKind(parlay);
  const stake = Number(parlay.parlay_stake);
  const boost = Number(parlay.parlay_american);
  let cap = hedgeCap({
    stake: Number.isFinite(stake) ? stake : 0,
    boostAmerican: Number.isFinite(boost) ? boost : 0,
    fillAmerican,
    mode: parlay.hedge_mode || "1x",
    kind,
  });
  if (!(cap > 0)) cap = Number(parlay.max_contracts) || 0;
  const floor = Math.max(0, Math.ceil(Number(filled) || 0));
  if (cap < floor) cap = floor;
  const iso = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    fill_american: fillAmerican,
    max_contracts: cap,
    fill_edited_at: iso,
    cancel_open_at: iso,
  };
}

export function cancelOpenParlayPatch(now = new Date()) {
  return { cancel_open_at: (now instanceof Date ? now : new Date(now)).toISOString() };
}

export function cancelQuoteSubmissionPatch(now = new Date()) {
  return { cancel_requested_at: (now instanceof Date ? now : new Date(now)).toISOString() };
}

/** Who may edit/cancel this lock: owner of the row, or Combo Locks owner. */
export function canManageLock(actor, parlay, { isOwner = false } = {}) {
  if (!actor || !parlay) return false;
  if (isOwner) return true;
  return String(actor.id || "") === String(parlay.user_id || "");
}
