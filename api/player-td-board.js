'use strict';

// GET /api/player-td-board
// NFL player touchdown Yes prices from Kalshi, Polymarket US, and Underdog.
// American odds, fee-inclusive on Kalshi and Polymarket. No sportsbook columns.
// Cached in the function so a ~45s poll does not re-download event payloads.

const { loadPlayerTdBoard } = require('../lib/player-td-feeds');

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
    const board = await loadPlayerTdBoard(deps || {});
    const games = (board.games || []).map((game) => ({
      gameKey: game.gameKey,
      away: game.away,
      home: game.home,
      awayAbbr: game.awayAbbr,
      homeAbbr: game.homeAbbr,
      commence: game.commence,
      players: game.players,
    }));
    res.status(200).json({
      ok: true,
      league: 'NFL',
      fetchedAt: board.fetchedAt,
      cached: board.cached === true,
      games,
    });
  } catch (err) {
    res.status(502).json({ ok: false, games: [], error: 'player_td_unavailable' });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
