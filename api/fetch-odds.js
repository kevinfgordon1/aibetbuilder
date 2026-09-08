const { supabase, applyBookAdjustments } = require('../lib/odds-shared');
const {
  parseRequestedSports,
  isFeaturedOnlyQuery,
  runFetchOddsJob,
} = require('../lib/odds-fetch-job');

// Vercel cron / manual GET. Pulls The Odds API, upserts odds_cache +
// event_odds_cache, then returns a *receipt* — { success, results: [{ sport, games }] }.
// `games` is a count, not a game/odds array. Promo Builder never calls this
// route; it reads the cache tables from the browser via queryOddsCaches.
// Changing this JSON to include full odds would not unblock the UI and would
// blow the cron payload. Empty/failed Odds API pulls log and skip that sport;
// they still 200 with whatever sports did upsert.
//
// When Supabase/PostgREST is down (Cloudflare 520/522, connection timeout),
// upserts cannot complete. Fail the first hung write quickly and return 503
// instead of holding GET open with 0 bytes until the client or platform quits.

// Daily game lines. Futures/championship markets are handled by the separate
// /api/fetch-futures function so the two pulls run as independent, shorter jobs.
// Optional ?sports= / ?featuredOnly=1 for a shorter manual refresh.

module.exports = async (req, res) => {
  try {
    const query = req.query || {};
    const sports = parseRequestedSports(query.sports);
    const featuredOnly = isFeaturedOnlyQuery(query);
    const { results, cacheUnreachable } = await runFetchOddsJob({
      sports,
      featuredOnly,
      apiKey: process.env.ODDS_API_KEY,
      supabaseClient: supabase,
      applyBookAdjustments,
    });
    if (cacheUnreachable) {
      return res.status(503).json({
        success: false,
        error: 'Supabase odds cache unreachable',
        results,
      });
    }
    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports.config = { maxDuration: 60 };
