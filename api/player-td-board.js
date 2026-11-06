'use strict';

// GET /api/player-td-board
// NFL player touchdown Yes prices from Kalshi, Polymarket US, and Underdog.
// American odds, fee-inclusive on Kalshi and Polymarket. No sportsbook columns.
//
// The 5-minute cron hits /api/fetch-player-props, a different function. That
// job already downloads these quotes (plus a Novig book walk budgeted at 25s)
// and writes player_prop_cache. This route used to ignore that row, keep only
// a 45s in-process cache, and send Cache-Control: no-store. A cold instance
// then blocked on the same Novig walk and the request died at about 25s.
//
// Serve the cron snapshot when it is younger than 30 minutes. Rebuild only
// when that row is missing or older, and skip Novig on that path so a cold
// start cannot spend the 25s book budget. The cron remains the only steady
// upstream caller.

const { loadPlayerTdBoard, readPlayerTdBoardSnapshot } = require('../lib/player-td-feeds');

const BOARD_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=240';

function boardSupabase(deps) {
  if (deps && Object.prototype.hasOwnProperty.call(deps, 'supabaseClient')) return deps.supabaseClient || null;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  return require('../lib/odds-shared').supabase;
}

async function handler(req, res, deps) {
  const d = deps || {};
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'GET only' });
    return;
  }
  try {
    const now = d.now || Date.now();
    const snap = d.skipSnapshot ? null : await readPlayerTdBoardSnapshot(boardSupabase(d), now);
    if (snap) {
      res.setHeader('Cache-Control', BOARD_CACHE_CONTROL);
      res.status(200).json({
        ok: true,
        league: 'NFL',
        fetchedAt: snap.fetchedAt,
        cached: true,
        games: snap.games || [],
      });
      return;
    }
    const board = await loadPlayerTdBoard(d);
    const games = (board.games || []).map((game) => ({
      gameKey: game.gameKey,
      away: game.away,
      home: game.home,
      awayAbbr: game.awayAbbr,
      homeAbbr: game.homeAbbr,
      commence: game.commence,
      players: game.players,
    }));
    res.setHeader('Cache-Control', BOARD_CACHE_CONTROL);
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
module.exports.BOARD_CACHE_CONTROL = BOARD_CACHE_CONTROL;
