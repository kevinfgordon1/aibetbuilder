const { supabase, applyBookAdjustments } = require('../lib/odds-shared');

// Vercel cron / manual GET. Pulls The Odds API, upserts odds_cache +
// event_odds_cache, then returns a *receipt* — { success, results: [{ sport, games }] }.
// `games` is a count, not a game/odds array. Promo Builder never calls this
// route; it reads the cache tables from the browser via queryOddsCaches.
// Changing this JSON to include full odds would not unblock the UI and would
// blow the cron payload. Empty/failed Odds API pulls log and skip that sport;
// they still 200 with whatever sports did upsert.

// Daily game lines. Futures/championship markets are handled by the separate
// /api/fetch-futures function so the two pulls run as independent, shorter jobs.
const SPORTS = [
  'baseball_mlb',
  'americanfootball_nfl',
  'americanfootball_ncaaf',
  'basketball_nba',
  'basketball_ncaab',
  'icehockey_nhl',
];

// Per-event additional markets (alt lines + team totals), pulled one game at a time
// from the /events/{id}/odds endpoint. Sport-aware: ONLY sports listed here get a
// per-event pull. All six leagues get the full alt-line + team-total layer. Only
// games starting within EVENT_HORIZON_MS are pulled, so offseason leagues cost
// nothing until their slate fills in.
const ALT_MARKETS = ['alternate_spreads', 'alternate_totals', 'team_totals', 'alternate_team_totals'];
const EVENT_MARKETS = {
  baseball_mlb: ALT_MARKETS,
  americanfootball_nfl: ALT_MARKETS,
  americanfootball_ncaaf: ALT_MARKETS,
  basketball_nba: ALT_MARKETS,
  basketball_ncaab: ALT_MARKETS,
  icehockey_nhl: ALT_MARKETS,
};

// Only pull per-event markets for games starting within this window. Far-out games
// rarely have alt lines posted yet, and this caps job runtime.
const EVENT_HORIZON_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// Main handler — daily game lines (featured + per-event alt markets)
// Regions:
//   us  — DK, FD, Caesars, BetMGM, BetRivers, Fanatics, Bovada, MyBookie,
//          BetOnline, LowVig, BetUS
//   us2 — Hard Rock Bet, theScore Bet (formerly ESPN Bet), Bally Bet,
//          BetAnything, betPARX, Fliff
//   us_ex — Kalshi, Novig, ProphetX, BetOpenly, Polymarket
//   eu  — Pinnacle (public-site odds; The Odds API may delay them)
// All six current leagues use 2-way h2h (no Draw), so moneyline EV computes
// directly. The is_three_way detection downstream stays as defensive cover for
// any future 3-way sport (e.g. soccer) but is inert for this set.
// ─────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  try {
    const results = [];
    // Leagues run concurrently (independent). MLB's per-event alt-line loop below
    // stays sequential to respect The Odds API rate limits.
    await Promise.all(SPORTS.map(async (sport) => {
      // includeBetLimits: exchange books attach one `bet_limit` per outcome — top-of-book
      // size only. The Odds API has no depth / order-book parameter (no extra levels).
      // Do not add per-game depth fetches here; that would multiply cron quota.
      // Rest levels are on-demand via /api/book-depth when a Promo card is viewed.
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,us2,us_ex,eu&markets=h2h,spreads,totals&oddsFormat=american&includeBetLimits=true`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Failed to fetch ${sport}: ${response.status}`);
        return;
      }
      const rawData = await response.json();
      const data = applyBookAdjustments(rawData);
      const { error } = await supabase
        .from('odds_cache')
        .upsert({ sport, data, fetched_at: new Date().toISOString() }, { onConflict: 'sport' });
      if (error) {
        console.error(`Supabase upsert error for ${sport}:`, error);
      } else {
        results.push({ sport, games: data.length });
      }

      // ── Per-event additional markets: alt spreads/totals + team totals ──
      // Reuses the event ids/commence times from the featured pull above (no extra
      // /events call needed), gated to games starting within EVENT_HORIZON_MS.
      const eventMarkets = EVENT_MARKETS[sport];
      if (eventMarkets && Array.isArray(data)) {
        const nowMs = Date.now();
        const horizon = nowMs + EVENT_HORIZON_MS;
        const eventsInWindow = data.filter(g => {
          const t = new Date(g.commence_time).getTime();
          return t > nowMs && t <= horizon;
        });
        const marketsParam = eventMarkets.join(',');
        let eventCount = 0;
        // Sequential to stay under rate limits; ~15 MLB games ≈ a few seconds.
        for (const game of eventsInWindow) {
          try {
            const evUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${game.id}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,us2,us_ex,eu&markets=${marketsParam}&oddsFormat=american&includeBetLimits=true`;
            const evResp = await fetch(evUrl);
            if (!evResp.ok) {
              console.error(`Failed event odds ${sport}/${game.id}: ${evResp.status}`);
              continue;
            }
            const evRaw = await evResp.json();
            if (!evRaw?.bookmakers?.length) continue; // no alt markets posted yet
            const evData = applyBookAdjustments([evRaw])[0];
            const nowIso = new Date().toISOString();
            const { error: evError } = await supabase
              .from('event_odds_cache')
              .upsert({
                event_id: evData.id,
                sport,
                commence_time: evData.commence_time,
                home_team: evData.home_team,
                away_team: evData.away_team,
                data: evData,
                markets: eventMarkets,
                fetched_at: nowIso,
                updated_at: nowIso,
              }, { onConflict: 'event_id' });
            if (evError) {
              console.error(`event_odds_cache upsert error ${sport}/${game.id}:`, evError);
            } else {
              eventCount++;
            }
          } catch (evErr) {
            console.error(`event odds exception ${sport}/${game.id}:`, evErr.message);
          }
        }
        // Self-clean: drop finished games (they stop appearing in the feed, so they'd
        // otherwise linger forever). Keeps the table at just the live/upcoming slate.
        await supabase
          .from('event_odds_cache')
          .delete()
          .eq('sport', sport)
          .lt('commence_time', new Date(nowMs - 6 * 60 * 60 * 1000).toISOString());
        results.push({ sport, event_markets: eventCount });
      }
    }));

    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
