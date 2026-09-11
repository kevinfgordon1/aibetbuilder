'use strict';

// Promo ranking: soccer same-binary No from PM catalog / orderbooks.
// POST { games: [{ sport, away, home, commence_time }], venues?: string[] }
// Never invents Away Yes. Does not call The Odds API.

const { resolveSoccerPmNos, SOCCER_PM_NO_VENUES } = require('../lib/soccer-pm-no');

const MAX_GAMES = 80;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only', venues: [...SOCCER_PM_NO_VENUES] });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const games = Array.isArray(body.games) ? body.games.slice(0, MAX_GAMES) : [];
    const venues = Array.isArray(body.venues) && body.venues.length
      ? body.venues
      : SOCCER_PM_NO_VENUES;
    const quotes = await resolveSoccerPmNos(games, { venues });
    res.status(200).json({ quotes, venues: SOCCER_PM_NO_VENUES });
  } catch (e) {
    res.status(200).json({ quotes: {}, error: String(e && e.message || e) });
  }
};

module.exports.SOCCER_PM_NO_VENUES = SOCCER_PM_NO_VENUES;
module.exports.MAX_GAMES = MAX_GAMES;
