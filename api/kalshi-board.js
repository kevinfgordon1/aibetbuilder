'use strict';

// GET /api/kalshi-board?league=NFL|NCAAF|MLB
// JSON snapshot of the public Kalshi game-moneyline book. No API key.
//
// New Odds Board snapshot mode paints from this. The SSE stream can replay
// only the last contract that moved, which leaves every other Kalshi cell
// blank. This route always returns the full book loadKalshiQuotes just read.

const { parseLeague, loadKalshiQuotes } = require('../lib/venue-live');

function readLeague(req) {
  let raw = '';
  if (req && req.query && req.query.league != null) raw = req.query.league;
  if (!raw && req && req.url) {
    try { raw = new URL(req.url, 'http://localhost').searchParams.get('league') || ''; } catch (_) { raw = ''; }
  }
  return parseLeague(raw || 'NFL');
}

async function handler(req, res, deps) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'GET only' });
    return;
  }
  const league = readLeague(req);
  if (!league) {
    res.status(400).json({ ok: false, error: 'league must be NFL, NCAAF, or MLB' });
    return;
  }
  try {
    const quotes = await loadKalshiQuotes(league, deps || {});
    res.status(200).json({ ok: true, league, quotes });
  } catch (_) {
    res.status(502).json({ ok: false, league, quotes: [], error: 'kalshi_unavailable' });
  }
}

module.exports = handler;
