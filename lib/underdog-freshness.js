'use strict';

// Phone-quote freshness shared by /api/underdog-predict and the CJS Promo
// leg builder. Keep both clocks in lockstep with
// src/promoUnderdogFreshness.js.
//
//   UNDERDOG_STALE_MS (1 hour) — Promo ranking, Best Pick, and EV skip an
//     Underdog offer older than this. The warning banner uses this clock.
//   UNDERDOG_BOARD_OMIT_MS (24 hours) — /api/underdog-predict and the New
//     Odds Board omit a side only when its quote is older than this.
//     A 1h–24h side stays on the board and is not a Best Pick.
//
// Missing timestamps are not stale. Phone product experience only — never
// Betstamp book 196.

const UNDERDOG_PREDICT_BOOK_KEY = 'underdog_predict';
const UNDERDOG_STALE_MINUTES = 60;
const UNDERDOG_STALE_MS = UNDERDOG_STALE_MINUTES * 60 * 1000;
const UNDERDOG_BOARD_OMIT_MS = 24 * 60 * 60 * 1000;
// Same band as src/promoUnderdogPredict.js UNDERDOG_TWO_WAY_SUM_*.
const UNDERDOG_TWO_WAY_SUM_MIN = 0.80;
const UNDERDOG_TWO_WAY_SUM_MAX = 1.22;

function parseUnderdogUpdatedAtMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isUnderdogOddsStale(updatedAt, now = Date.now(), maxAgeMs = UNDERDOG_STALE_MS) {
  const ts = parseUnderdogUpdatedAtMs(updatedAt);
  if (ts == null) return false;
  const clock = Number(now);
  if (!Number.isFinite(clock)) return false;
  return (clock - ts) > Number(maxAgeMs);
}

function underdogOfferUpdatedAtFromLeg(leg) {
  if (!leg || leg.bookKey !== UNDERDOG_PREDICT_BOOK_KEY) return null;
  return parseUnderdogUpdatedAtMs(leg.bookUpdatedAt ?? leg.updatedAt);
}

function underdogOfferIsRankable(leg, now = Date.now(), maxAgeMs = UNDERDOG_STALE_MS) {
  if (!leg || leg.bookKey !== UNDERDOG_PREDICT_BOOK_KEY) return true;
  return !isUnderdogOddsStale(underdogOfferUpdatedAtFromLeg(leg), now, maxAgeMs);
}

function underdogPairIncomplete(bookKey, left, right) {
  if (left == null && right == null) return true;
  if (bookKey === UNDERDOG_PREDICT_BOOK_KEY) return false;
  return left == null || right == null;
}

function impliedFromAmerican(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n < 0) return Math.abs(n) / (Math.abs(n) + 100);
  return 100 / (n + 100);
}

// Akron @ Central Michigan printed −527 / −715, both favorites, implied
// sum ~1.72. A normal −110 / −110 pair (~1.05) stays.
function h2hPairIncoherent(lines) {
  const h2h = (lines || []).filter((line) => line && line.market === 'h2h' && line.american != null);
  if (h2h.length !== 2) return false;
  const pa = impliedFromAmerican(h2h[0].american);
  const pb = impliedFromAmerican(h2h[1].american);
  if (pa == null || pb == null) return false;
  const sum = pa + pb;
  return sum < UNDERDOG_TWO_WAY_SUM_MIN || sum > UNDERDOG_TWO_WAY_SUM_MAX;
}

// Board / API omit. Default is 24 hours, not the 1-hour Promo rank gate.
function sanitizeUnderdogPhoneLines(lines, now = Date.now(), maxAgeMs = UNDERDOG_BOARD_OMIT_MS) {
  const fresh = (lines || []).filter((line) => !isUnderdogOddsStale(line && line.updatedAt, now, maxAgeMs));
  if (!h2hPairIncoherent(fresh)) return fresh;
  return fresh.filter((line) => !line || line.market !== 'h2h');
}

module.exports = {
  UNDERDOG_BOARD_OMIT_MS,
  UNDERDOG_PREDICT_BOOK_KEY,
  UNDERDOG_STALE_MINUTES,
  UNDERDOG_STALE_MS,
  UNDERDOG_TWO_WAY_SUM_MIN,
  UNDERDOG_TWO_WAY_SUM_MAX,
  h2hPairIncoherent,
  isUnderdogOddsStale,
  parseUnderdogUpdatedAtMs,
  sanitizeUnderdogPhoneLines,
  underdogOfferIsRankable,
  underdogPairIncomplete,
};
