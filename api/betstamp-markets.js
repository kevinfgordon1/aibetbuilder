'use strict';

// GET /api/betstamp-markets — same-origin REST snapshot proxy.
// Forwards league / is_live / book_ids / include_alts / fixture_id / timedelta
// to Betstamp Pro using BETSTAMP_API_KEY (server-only). League-wide fixture
// and market pulls send timedelta (default 240h / 10 days) so next-week NFL
// and NCAAF slates are not clipped to Betstamp's ±24h window. Override via
// ?timedelta= or BETSTAMP_TIMEDELTA. A fixture_id pull is markets-only so
// the New Odds Board can load one game's alts without the full slate.
// Does not touch The Odds API or odds_cache.
//
// Responses are cached ~5 minutes per query (league / book_ids / is_live /
// include_alts / timedelta / fixture_id). In-memory per instance plus
// Cache-Control s-maxage so Promo remounts do not re-download Betstamp.
// ?refresh=1 (or ?force=1) bypasses the server TTL — Promo Refresh does
// not send this; it only bypasses the client TTL and still hits this cache.

const {
  readQuery,
  fetchSnapshot,
  fetchSnapshotWithCache,
  snapshotCacheControl,
  redact,
} = require('../lib/betstamp');

function applyCacheHeaders(res, result) {
  res.setHeader('X-Betstamp-Cache', result.cacheStatus || 'MISS');
  if (result.ageMs != null) {
    res.setHeader('Age', String(Math.max(0, Math.floor(result.ageMs / 1000))));
  }
  res.setHeader('Cache-Control', snapshotCacheControl(result.remainingMs));
}

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
    res.status(405).json({ ok: false, error: 'GET only' });
    return;
  }
  try {
    const query = readQuery(req);
    const result = await fetchSnapshotWithCache(query, deps);
    applyCacheHeaders(res, result);
    res.status(200).json(result.snap);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    const status = e && e.status ? e.status : 502;
    res.status(status).json({
      ok: false,
      error: redact(e && e.message ? e.message : e),
      missingKey: !!(e && e.missingKey),
      markets: [],
      fixtures: [],
      teams: [],
    });
  }
}

module.exports = handler;
module.exports._helpers = { readQuery, fetchSnapshot, fetchSnapshotWithCache };
