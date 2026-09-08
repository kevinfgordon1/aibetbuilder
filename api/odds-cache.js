const { supabase, applyBookAdjustments } = require('../lib/odds-shared');
const {
  parseRequestedSports,
  loadSelectedSportsOdds,
} = require('../lib/odds-fetch-job');

// Promo Builder selected-sports odds. Reads odds_cache one sport at a time
// (PostgREST cannot ship MLB+NFL+NCAAF JSON in one query before it times out).
// If a sport's cache row hangs or is missing, fetch that sport's featured
// board from The Odds API and return it — do not wait on the full cron job.
// Query: ?sports=baseball_mlb,americanfootball_nfl&eventSince=<iso>

module.exports = async (req, res) => {
  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }
  try {
    const query = req.query || {};
    const sports = parseRequestedSports(query.sports);
    const eventSince = query.eventSince || query.event_since || null;
    const out = await loadSelectedSportsOdds({
      sports,
      eventSince,
      apiKey: process.env.ODDS_API_KEY,
      supabaseClient: supabase,
      applyBookAdjustments,
    });
    const status = out.featured.length ? 200 : 504;
    res.status(status).json(out);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports.config = { maxDuration: 30 };
