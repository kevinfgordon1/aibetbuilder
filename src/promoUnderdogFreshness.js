// Underdog Predict quote freshness for Promo cards.
//
// Missing timestamp → no flag (no false alarm). Only underdog_predict is
// warned; other sportsbooks stay quiet even if they later grow a stamp.
// Age is wall clock vs the phone quote updated_at. Cards are not hidden
// or re-ranked — flag only.

import { formatCompactAge } from "./betstampNormalize.js";
import { UNDERDOG_PREDICT_BOOK_KEY } from "./betstampBooks.js";

export { UNDERDOG_PREDICT_BOOK_KEY };
export const UNDERDOG_STALE_MINUTES = 60;
export const UNDERDOG_STALE_MS = UNDERDOG_STALE_MINUTES * 60 * 1000;
export const UNDERDOG_STALE_WARNING =
  "Underdog odds last updated over 1 hour ago — double-check in the app.";

export function parseUnderdogUpdatedAtMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isUnderdogPredictBook(bookKey) {
  return bookKey === UNDERDOG_PREDICT_BOOK_KEY;
}

/** True only when a timestamp exists and is older than the threshold. */
export function isUnderdogOddsStale(updatedAt, now = Date.now(), maxAgeMs = UNDERDOG_STALE_MS) {
  const ts = parseUnderdogUpdatedAtMs(updatedAt);
  if (ts == null) return false;
  const clock = Number(now);
  if (!Number.isFinite(clock)) return false;
  return (clock - ts) > Number(maxAgeMs);
}

export function underdogStaleAgeLabel(updatedAt, now = Date.now()) {
  const ts = parseUnderdogUpdatedAtMs(updatedAt);
  if (ts == null) return null;
  const compact = formatCompactAge(ts, now);
  return compact ? `~${compact} ago` : null;
}

export function formatUnderdogUpdatedAtEt(updatedAt) {
  const ts = parseUnderdogUpdatedAtMs(updatedAt);
  if (ts == null) return null;
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " ET";
}

export function describeUnderdogStaleWarning(updatedAt, now = Date.now(), maxAgeMs = UNDERDOG_STALE_MS) {
  if (!isUnderdogOddsStale(updatedAt, now, maxAgeMs)) return null;
  const ts = parseUnderdogUpdatedAtMs(updatedAt);
  const ageLabel = underdogStaleAgeLabel(ts, now);
  const et = formatUnderdogUpdatedAtEt(ts);
  const message = ageLabel
    ? `Underdog odds last updated over 1 hour ago (${ageLabel}) — double-check in the app.`
    : UNDERDOG_STALE_WARNING;
  return { stale: true, updatedAt: ts, ageLabel, et, message };
}

export function assignBookUpdatedAt(leg, updatedAt) {
  const ts = parseUnderdogUpdatedAtMs(updatedAt);
  if (leg && ts != null) leg.bookUpdatedAt = ts;
  return leg;
}

/** Offer-side stamp when this promo book is Underdog Predict. */
export function underdogOfferUpdatedAtFromLeg(leg) {
  if (!leg || !isUnderdogPredictBook(leg.bookKey)) return null;
  return parseUnderdogUpdatedAtMs(leg.bookUpdatedAt ?? leg.updatedAt);
}

/** Hedge/true-odds stamp when the opposite quote is Underdog Predict. */
export function underdogHedgeUpdatedAtFromLeg(leg) {
  if (!leg || !isUnderdogPredictBook(leg.bestOppBook)) return null;
  return parseUnderdogUpdatedAtMs(leg.bestOppUpdatedAt);
}

export function describeUnderdogOfferStaleWarning(leg, now = Date.now(), maxAgeMs = UNDERDOG_STALE_MS) {
  return describeUnderdogStaleWarning(underdogOfferUpdatedAtFromLeg(leg), now, maxAgeMs);
}

export function describePromoUnderdogStaleWarning(legs, now = Date.now(), maxAgeMs = UNDERDOG_STALE_MS) {
  const stamps = [];
  for (const leg of legs || []) {
    const offer = underdogOfferUpdatedAtFromLeg(leg);
    if (offer != null) stamps.push(offer);
    const hedge = underdogHedgeUpdatedAtFromLeg(leg);
    if (hedge != null) stamps.push(hedge);
  }
  if (!stamps.length) return null;
  return describeUnderdogStaleWarning(Math.min(...stamps), now, maxAgeMs);
}
