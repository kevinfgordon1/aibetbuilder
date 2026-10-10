// Copy + payload helpers for the "Combo Lock submitted" confirmation popup.
import { allInFromExchange, COMBO_FEE_RATE } from "./comboCredits.js";
import { fmtAmerican } from "./comboLockView.js";

export const LOCK_SUBMITTED_TITLE = "Combo Lock submitted";
export const LOCK_SUBMITTED_NOTE = "We're looking for a buyer on Kalshi and Polymarket. You'll get a fill when someone takes your price.";
export const LOCK_SUBMITTED_AUTO_MS = 4500;

/** Leg lines for the popup — plain labels, newest-friendly. */
export function submittedLegLines(legs) {
  const list = Array.isArray(legs) ? legs : [];
  return list
    .map((leg) => {
      if (!leg) return "";
      const label = String(leg.label || "").trim();
      if (label) return label;
      const side = String(leg.side || "").toUpperCase();
      const ticker = String(leg.ticker || "").trim();
      if (ticker && side) return `${ticker} (${side})`;
      return ticker || "";
    })
    .filter(Boolean);
}

/**
 * American fill odds to show after a successful save.
 * Fee users see all-in (incl. 1%); everyone else sees the stored exchange fill.
 */
export function submittedFillDisplay(fillAmerican, { feesEnabled = false, feeRate = COMBO_FEE_RATE } = {}) {
  const ex = Number(fillAmerican);
  if (!Number.isFinite(ex) || ex === 0) return null;
  if (!feesEnabled) return { american: ex, text: fmtAmerican(ex), feesEnabled: false };
  const allIn = allInFromExchange(ex, feeRate);
  const a = allIn == null ? ex : allIn;
  return { american: a, text: fmtAmerican(a), feesEnabled: true, exchangeAmerican: ex };
}

/** Build the success popup model from the row we just inserted (server confirmed). */
export function buildLockSubmittedToast(row, { feesEnabled = false } = {}) {
  if (!row) return null;
  const legs = submittedLegLines(row.legs);
  const fill = submittedFillDisplay(row.fill_american, { feesEnabled });
  return {
    kind: "ok",
    title: LOCK_SUBMITTED_TITLE,
    legs,
    fillText: fill ? fill.text : null,
    fillLabel: feesEnabled ? "Your all-in price" : "Your sell price",
    note: LOCK_SUBMITTED_NOTE,
    autoMs: LOCK_SUBMITTED_AUTO_MS,
  };
}

export function buildLockSubmitError(message) {
  const msg = String(message || "").trim() || "Something went wrong saving that lock.";
  return {
    kind: "error",
    title: "Couldn't save that Combo Lock",
    message: msg.startsWith("Save failed") ? msg : `Save failed: ${msg}`,
    autoMs: 0, // errors stay until dismissed
  };
}
