'use strict';

// GET /api/player-td-board
// NFL player touchdown Yes prices from Kalshi, Polymarket US, and Underdog.
// American odds, fee-inclusive on Kalshi and Polymarket. No sportsbook columns.
//
// A cold isolate used to wait on every upstream, including a Novig book walk
// the table does not render. loadPlayerTdBoard now stops at its deadline and
// returns whatever books arrived. `partial` means at least one displayed book
// timed out or errored. `stale` means the games are the previous in-process
// board because this refresh produced nothing. A total miss is 502 with
// `sources` filled in — the empty game list is a failure, not a quiet slate.
// Cache-Control stays no-store so a partial or stale body is not edge-cached
// as if it were complete.

const { loadPlayerTdBoard } = require('../lib/player-td-feeds');

const SOURCE_KEYS = ['kalshi', 'underdog', 'polymarket', 'novig'];

function sourceStatuses(sources) {
  const out = {};
  for (const key of SOURCE_KEYS) {
    const value = sources && sources[key];
    const status = value && typeof value === 'object' ? value.status : value;
    if (typeof status === 'string') out[key] = status;
  }
  return out;
}

function gamesOf(board) {
  return (board.games || []).map((game) => ({
    gameKey: game.gameKey,
    away: game.away,
    home: game.home,
    awayAbbr: game.awayAbbr,
    homeAbbr: game.homeAbbr,
    commence: game.commence,
    players: game.players,
  }));
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
  try {
    const board = await loadPlayerTdBoard(deps || {});
    const failed = !board || board.ok === false;
    const payload = {
      ok: !failed,
      league: 'NFL',
      fetchedAt: board && board.fetchedAt ? board.fetchedAt : null,
      cached: !!(board && board.cached),
      stale: !!(board && board.stale),
      partial: !!(board && board.partial),
      sources: sourceStatuses(board && board.sources),
      games: gamesOf(board || {}),
    };
    if (failed) payload.error = (board && board.error) || 'player_td_unavailable';
    res.status(failed ? 502 : 200).json(payload);
  } catch (err) {
    res.status(502).json({
      ok: false,
      league: 'NFL',
      fetchedAt: null,
      cached: false,
      stale: false,
      partial: true,
      sources: { kalshi: 'error', underdog: 'error', polymarket: 'error', novig: 'skipped' },
      games: [],
      error: 'player_td_unavailable',
    });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
