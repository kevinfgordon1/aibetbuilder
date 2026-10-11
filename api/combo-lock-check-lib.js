// Pending-lock "Check market price": pause the lock's own quotes, RFQ the lock's
// combo on the lock owner's key for a full 10s, report the best competing quote.
// Pure helpers (no I/O) so the flow is testable; I/O lives in combo-probe.js.
'use strict';

const LOCK_CHECK_WAIT_MS = 10_000;        // Kevin: collect for 10s "to be safe"
const LOCK_CHECK_COOLDOWN_MS = 60_000;    // per user
// Hold written on the lock (settle ≤6s + market + 10s collect + delete ≈ 19s fits).
const PROBE_PAUSE_HOLD_MS = 25_000;
// combo-worker's hard backstop: it ignores a probe pause older than this.
const PROBE_PAUSE_MAX_MS = 30_000;
// How long the server waits for the worker to cancel the lock's open quotes (poll 5s + cancel).
const PAUSE_SETTLE_MAX_MS = 6_000;

const POLY_NOT_AVAILABLE =
  'Check market price is not available for Polymarket locks yet. It only works on Kalshi combos for now.';
const PAUSED_ALREADY_NOTE = 'Lock is already paused, so there were no quotes of yours to pull.';

// A lock can be checked whenever its legs can be built into a Kalshi combo (every leg a
// Kalshi KX… market), even if its saved combo_ticker is the Polymarket caoc- one: most
// locks quote both venues. Only truly Polymarket-only locks are gated.
function hasKalshiSide(parlay) {
  const legs = Array.isArray(parlay && parlay.legs) ? parlay.legs : [];
  return legs.length > 0 && legs.every((l) => /^KX[A-Z0-9]/i.test(String((l && l.ticker) || '').trim()));
}
function isPolyLock(parlay) {
  return !hasKalshiSide(parlay);
}

/** Can this user run a check on this lock? Only the lock's owner, on their own lock. */
function lockCheckAccess(parlay, user) {
  if (!parlay) return { ok: false, status: 404, error: 'Lock not found' };
  if (!user || !user.id || String(parlay.user_id) !== String(user.id)) {
    return { ok: false, status: 403, error: 'You can only check the market on your own locks' };
  }
  if (parlay.active === false) return { ok: false, status: 400, error: 'This lock is not active' };
  if (isPolyLock(parlay)) return { ok: false, status: 400, error: POLY_NOT_AVAILABLE, polyNotAvailable: true };
  return { ok: true };
}

/** Which Kalshi key prices the check: the lock owner's. Kevin's lock → server env key; anyone else → their Vault key. */
function credsPlanFor(parlay, ownerUserId) {
  return String(parlay.user_id) === String(ownerUserId) ? 'owner-env' : 'user-vault';
}

function lockContracts(parlay) {
  const n = Math.floor(Number(parlay && parlay.max_contracts));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function probePausePatch(nowMs) {
  return {
    probe_paused_at: new Date(nowMs).toISOString(),
    probe_pause_until: new Date(nowMs + PROBE_PAUSE_HOLD_MS).toISOString(),
  };
}
const PROBE_RESUME_PATCH = Object.freeze({ probe_paused_at: null, probe_pause_until: null });

const PROBE_COL_ERR = /probe_pause(d_at|_until)/i;
function isMissingProbePauseColumn(err) {
  const m = String((err && err.message) || '');
  return PROBE_COL_ERR.test(m) && /(column|schema cache)/i.test(m);
}

/**
 * Drop our own quotes. Kalshi tags every quote with creator_id; anything created by the
 * account that opened the RFQ (the lock owner) or matching a quote id the lock still has
 * open is ours, not a competitor.
 */
function competitorQuotes(quotes, { selfCreatorId = null, ownQuoteIds = [] } = {}) {
  const own = new Set((ownQuoteIds || []).filter(Boolean).map(String));
  const self = selfCreatorId ? String(selfCreatorId) : null;
  return (Array.isArray(quotes) ? quotes : []).filter((q) => {
    if (!q) return false;
    if (q.id && own.has(String(q.id))) return false;
    const creator = q.creator_id || q.creator_user_id || q.quoter_id || null;
    if (self && creator && String(creator) === self) return false;
    return true;
  });
}

module.exports = {
  LOCK_CHECK_WAIT_MS,
  LOCK_CHECK_COOLDOWN_MS,
  PROBE_PAUSE_MAX_MS,
  PROBE_PAUSE_HOLD_MS,
  PAUSE_SETTLE_MAX_MS,
  POLY_NOT_AVAILABLE,
  PAUSED_ALREADY_NOTE,
  isPolyLock,
  hasKalshiSide,
  lockCheckAccess,
  credsPlanFor,
  lockContracts,
  probePausePatch,
  PROBE_RESUME_PATCH,
  isMissingProbePauseColumn,
  competitorQuotes,
};
