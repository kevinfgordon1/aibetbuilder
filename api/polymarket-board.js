'use strict';

// GET /api/polymarket-board?league=NFL|NCAAF|MLB
// JSON snapshot of Polymarket game-moneyline best asks. No API key.
//
// Gamma outcomePrices are cached for minutes. This route reads CLOB /books
// and uses the minimum ask with size > 0. asks[0] is the worst level (0.99),
// not the price to buy.

const { parseLeague, loadPolymarketQuotes } = require('../lib/venue-live');

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
    const quotes = await loadPolymarketQuotes(league, deps || {});
    res.status(200).json({ ok: true, league, quotes });
  } catch (_) {
    res.status(502).json({ ok: false, league, quotes: [], error: 'polymarket_unavailable' });
  }
}

module.exports = handler;
