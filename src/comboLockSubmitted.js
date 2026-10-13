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
    fillLabel: feesEnabled ? "Your all-in price" : "Your sale price",
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

export const SINGLE_LEG_CONFIRM_TITLE = "Quick heads-up on single-leg locks";

/** Warning lines shown before a 1-leg lock is saved (owner + testers). */
export function singleLegWarningLines({ feesEnabled = false } = {}) {
  return [
    "Your hedge rests on both Kalshi and Polymarket at the same time, so you get filled faster on whichever one a buyer picks.",
    "As soon as one side fills, we shrink or cancel the other. If both fill within about 1.5 seconds of each other, you could be over-hedged for a moment until we trim the extra. We alert you right away if that happens.",
    feesEnabled
      ? "Fees: Kalshi charges a small maker fee on some series, Polymarket charges $0, and our fee is 1% after your free $100 monthly allowance."
      : "Fees: Kalshi charges a small maker fee on some series, and Polymarket charges $0. Our 1% fee applies only to accounts with fees turned on.",
  ];
}

/** Pre-save confirmation for a 1-leg lock. onConfirm saves it. */
export function buildSingleLegConfirm(legs, fillAmerican, { feesEnabled = false, onConfirm } = {}) {
  const fill = submittedFillDisplay(fillAmerican, { feesEnabled });
  return {
    kind: "confirm",
    title: SINGLE_LEG_CONFIRM_TITLE,
    legs: submittedLegLines(legs),
    fillText: fill ? fill.text : null,
    fillLabel: feesEnabled ? "Your all-in price" : "Your sale price",
    warnings: singleLegWarningLines({ feesEnabled }),
    autoMs: 0,
    onConfirm,
  };
}
