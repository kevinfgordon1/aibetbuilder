'use strict';

// GET /api/underdog-predict — Underdog phone prices for Promo and the
// New Odds Board. Indexes NFL, CFB (app sport NCAAF), and MLB moneylines,
// spreads, and totals from /v1/lobbies/content/lines (Team Picks
// PickemStat pills, phone PE). A market with no prediction quote is omitted.
// A side whose quote updated_at is older than 24 hours
// (UNDERDOG_BOARD_OMIT_MS) is omitted (missing timestamps stay). A side
// aged 1–24 hours stays in this payload; Promo ranking still skips it
// after 1 hour (UNDERDOG_STALE_MS). Two-way moneylines whose implied
// probabilities sum outside 0.80–1.22 are omitted
// (Akron −527 / Central Michigan −715). After those filters, h2h sides
// with |american| >= 2000 are omitted (phone caps +3230 and −10000),
// and a moneyline with only one side left is omitted. Spreads and totals
// on that game stay. A normal −110 / −110 pair stays. Phone PE only.
// Defaults (override with server env, never VITE_):
//   UNDERDOG_STATE_CONFIG_ID=f8996742-f10c-4d32-955a-dcbcaa5dc5c0
//   UNDERDOG_PRODUCT_EXPERIENCE_ID=018e1234-5678-9abc-def0-123456789009
//   UNDERDOG_CLIENT_VERSION=20260918170103
// The other experience id returns the sticker (+252). A failed fetch
// yields games: [] so callers omit the line. Never Betstamp book 196.

const { fetchUnderdogPhone } = require('../lib/underdog-lobby');

function queryLive(req) {
  let raw = '';
  if (req && req.query && req.query.live != null) {
    raw = Array.isArray(req.query.live) ? req.query.live.join(',') : String(req.query.live);
  }
  if (!raw && req && req.url) {
    try { raw = new URL(req.url, 'http://localhost').searchParams.get('live') || ''; } catch (_) { raw = ''; }
  }
  return raw === '1' || raw === 'true';
}

function queryParam(req, name) {
  let raw = '';
  if (req && req.query && req.query[name] != null) {
    raw = Array.isArray(req.query[name]) ? req.query[name].join(',') : String(req.query[name]);
  }
  if (!raw && req && req.url) {
    try { raw = new URL(req.url, 'http://localhost').searchParams.get(name) || ''; } catch (_) { raw = ''; }
  }
  return raw;
}

// ?fresh=1 (with live=1) is the odds relay's single shared poller: 1s edge
// bust bucket and 1s memory cache instead of 5s / 5s. ?sport=NCAAF[,NFL]
// polls just those leagues (4 Underdog requests per sport on the first poll,
// 3 after, instead of 16 for all four sports).
async function handler(req, res, deps) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(204).end();
    return;
  }
  if (req.method && req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ ok: false, error: 'GET only', games: [] });
    return;
  }
  try {
    const live = deps && Object.prototype.hasOwnProperty.call(deps, 'live') ? !!deps.live : queryLive(req);
    const fresh = deps && Object.prototype.hasOwnProperty.call(deps, 'fresh')
      ? !!deps.fresh
      : ['1', 'true'].includes(queryParam(req, 'fresh'));
    const sports = deps && deps.sports != null ? deps.sports : queryParam(req, 'sport');
    const result = await fetchUnderdogPhone({ ...(deps || {}), live, fresh, sports });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Underdog-Cache', result.cacheStatus || 'MISS');
    res.status(200).json({
      ok: result.ok !== false,
      missingConfig: !!result.missingConfig,
      configRejected: !!result.configRejected,
      games: result.games || [],
      // When Underdog was actually asked (ms). A price's updated_at only moves
      // when the quote CHANGES, so the Pro board ages Underdog from this.
      fetchedAt: Number.isFinite(result.fetchedAt) ? result.fetchedAt : Date.now(),
      error: result.error || null,
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({
      ok: false,
      missingConfig: false,
      configRejected: false,
      games: [],
      error: (e && e.message) || 'Underdog request failed',
    });
  }
}

module.exports = handler;
