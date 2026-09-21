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
// Pregame / Promo responses are cached ~5 minutes per query (league /
// book_ids / is_live / include_alts / timedelta / fixture_id). Live snaps
// and ?refresh=1 skip that TTL and send Cache-Control: private, no-store.
//
// Auth: this route is anon (CORS * + no JWT). 196 stays on the allowlist so
// an explicit book_ids=196 still parses. Promo and the New Odds Board do
// not send 196; Underdog cells come from /api/underdog-predict. Default /
// omitted book_ids omit 196 and 400 (BetMGM) — the trial key 403s the whole
// /markets request when 400 is in book_ids. Opt in with
// BETSTAMP_INCLUDE_BETMGM=1. A 403 that still includes unauthorized books
// retries without them. The board refuses to paint 196.

const {
  readQuery,
  fetchSnapshot,
  fetchSnapshotWithCache,
  snapshotCacheControl,
  redact,
} = require('../lib/betstamp');

function applyCacheHeaders(res, result, query) {
  res.setHeader('X-Betstamp-Cache', result.cacheStatus || 'MISS');
  if (result.ageMs != null) {
    res.setHeader('Age', String(Math.max(0, Math.floor(result.ageMs / 1000))));
  }
  res.setHeader('Cache-Control', snapshotCacheControl(result.remainingMs, query));
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
    applyCacheHeaders(res, result, query);
    res.status(200).json(result.snap);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    const status = e && e.status ? e.status : 502;
    res.status(status).json({
      ok: false,
      error: redact(e) || 'Betstamp request failed',
      missingKey: !!(e && e.missingKey),
      markets: [],
      fixtures: [],
      teams: [],
    });
  }
}

module.exports = handler;
module.exports._helpers = { readQuery, fetchSnapshot, fetchSnapshotWithCache };
