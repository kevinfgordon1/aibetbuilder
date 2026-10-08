'use strict';

// Hand-curated blocklist for bad sportsbook lines. Applied at ingestion
// (applyBookAdjustments) so the line never reaches odds_cache /
// event_odds_cache, which means Promo picks, Optimize!, Free Bet conversions,
// +EV, Odds Board and /api/scan-ev-parlays all skip it. The 5-min cron rewrites
// the caches, so deleting cache rows alone would not stick.
//
// Each entry matches one bookmaker on one game (home/away + commence time) and
// strips outcomes in the listed markets. Optional `absPoint` limits it to the
// outcomes whose |point| equals it (both sides of that line); omit it to drop
// every point in those markets. Optional `name` limits it to one side. Entries stop
// applying after `expiresAt`, so stale rows are harmless; prune them anytime.
const BLOCKED_LINES = Object.freeze([
  {
    // DK alt spreads on this game are inflated across the WKU ladder:
    // -19.5 +1140 vs FanDuel +630 / Fanatics +550, -17.5 +950 vs +520,
    // -15.5 +720 vs +430. Blocking only -19.5 just promoted the next rung into
    // every Promo Best Pick, so drop DK's whole alt-spread ladder for this
    // game (main spread -1.5 and moneyline are in line and stay). Kevin's call.
    book: 'draftkings',
    homeTeam: 'Western Kentucky Hilltoppers',
    awayTeam: 'Missouri State Bears',
    commenceTime: '2026-10-08T23:00:00Z',
    markets: ['alternate_spreads'],
    expiresAt: '2026-10-09T12:00:00Z',
  },
]);

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function sameInstant(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && ta === tb;
}

function activeEntriesForGame(game, entries, nowMs) {
  if (!game) return [];
  return entries.filter((e) => {
    if (e.expiresAt && nowMs > new Date(e.expiresAt).getTime()) return false;
    if (norm(e.homeTeam) !== norm(game.home_team)) return false;
    if (norm(e.awayTeam) !== norm(game.away_team)) return false;
    if (e.commenceTime && !sameInstant(e.commenceTime, game.commence_time)) return false;
    return true;
  });
}

function outcomeBlocked(entry, marketKey, outcome) {
  if (!entry.markets.includes(marketKey)) return false;
  if (entry.absPoint != null) {
    const pt = Number(outcome && outcome.point);
    if (!Number.isFinite(pt) || Math.abs(Math.abs(pt) - entry.absPoint) > 1e-9) return false;
  }
  if (entry.name && norm(entry.name) !== norm(outcome.name)) return false;
  return true;
}

function stripBlockedGame(game, entries = BLOCKED_LINES, nowMs = Date.now()) {
  const hits = activeEntriesForGame(game, entries, nowMs);
  if (!hits.length || !Array.isArray(game.bookmakers)) return game;
  return {
    ...game,
    bookmakers: game.bookmakers.map((bm) => {
      const mine = hits.filter((e) => norm(e.book) === norm(bm.key));
      if (!mine.length) return bm;
      return {
        ...bm,
        markets: (bm.markets || [])
          .map((m) => ({
            ...m,
            outcomes: (m.outcomes || []).filter((o) => !mine.some((e) => outcomeBlocked(e, m.key, o))),
          }))
          .filter((m) => m.outcomes.length > 0),
      };
    }),
  };
}

function stripBlockedLines(sportData, entries = BLOCKED_LINES, nowMs = Date.now()) {
  if (!Array.isArray(sportData)) return sportData;
  return sportData.map((g) => stripBlockedGame(g, entries, nowMs));
}

module.exports = { BLOCKED_LINES, stripBlockedGame, stripBlockedLines };
