const { supabase, applyBookAdjustments } = require('../lib/odds-shared');
const {
  parseRequestedSports,
  isFeaturedOnlyQuery,
  runFetchOddsJob,
} = require('../lib/odds-fetch-job');

// Vercel cron / manual GET. Pulls The Odds API, upserts odds_cache +
// event_odds_cache, then returns a *receipt* — { success, results: [{ sport, games }] }.
// `games` is a count, not a game/odds array. Promo Builder never calls this
// route; it reads selected sports via /api/odds-cache (cache, then live
// featured fallback). Changing this JSON to include full odds would blow the
// cron payload. Empty/failed Odds API pulls log and skip that sport; they
// still 200 with whatever sports did upsert. A wall-clock budget + per-request
// timeouts keep GET from hanging with 0 bytes (Odds API hang, lock wait, or
// unbounded per-event loops).

// Daily game lines. Futures/championship markets are handled by the separate
// /api/fetch-futures function so the two pulls run as independent, shorter jobs.
// Optional ?sports=baseball_mlb,americanfootball_nfl limits the job (Promo
// selected-sports refresh). ?featuredOnly=1 skips per-event alt markets.

module.exports = async (req, res) => {
  try {
    const query = req.query || {};
    const sports = parseRequestedSports(query.sports);
    const featuredOnly = isFeaturedOnlyQuery(query);
    const { results } = await runFetchOddsJob({
      sports,
      featuredOnly,
      apiKey: process.env.ODDS_API_KEY,
      supabaseClient: supabase,
      applyBookAdjustments,
    });
    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports.config = { maxDuration: 60 };
