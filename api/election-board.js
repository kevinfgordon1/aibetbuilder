'use strict';

// GET /api/election-board
// Fee-adjusted 2026 midterm prices for the New Odds Board Politics tab.
// Polymarket US gateway and Kalshi's public elections API. No Betstamp.

const { loadElectionBoard } = require('../lib/election-board');

async function handler(req, res, deps) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'GET only' });
    return;
  }
  try {
    const load = deps && deps.loadElectionBoard ? deps.loadElectionBoard : loadElectionBoard;
    const body = await load(deps || {});
    res.status(200).json(body);
  } catch (_) {
    res.status(502).json({ ok: false, races: [], venues: {}, error: 'election_board_unavailable' });
  }
}

module.exports = handler;
