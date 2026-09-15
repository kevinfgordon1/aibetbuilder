'use strict';

// GET /api/betstamp-markets — same-origin REST snapshot proxy.
// Forwards league / is_live / book_ids / include_alts / fixture_id / timedelta
// to Betstamp Pro using BETSTAMP_API_KEY (server-only). League-wide fixture
// and market pulls send timedelta (default 240h / 10 days) so next-week NFL
// and NCAAF slates are not clipped to Betstamp's ±24h window. Override via
// ?timedelta= or BETSTAMP_TIMEDELTA. A fixture_id pull is markets-only so
// the New Odds Board can load one game's alts without the full slate.
// Does not touch The Odds API or odds_cache.

const {
  readQuery,
  fetchSnapshot,
  redact,
} = require('../lib/betstamp');

async function handler(req, res, deps) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'GET only' });
    return;
  }
  try {
    const query = readQuery(req);
    const snap = await fetchSnapshot(query, deps);
    res.status(200).json(snap);
  } catch (e) {
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
module.exports._helpers = { readQuery, fetchSnapshot };
