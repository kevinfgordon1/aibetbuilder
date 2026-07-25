const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SPORTS = [
  'baseball_mlb',
  'americanfootball_nfl',
  'americanfootball_ncaaf',
  'basketball_nba',
  'basketball_ncaab',
  'icehockey_nhl',
];

// Futures / outrights (championship winners). Each key is a single "event" with a
// long list of team outcomes, pulled with markets=outrights. Stored in the same
// odds_cache table under the futures key; the frontend reads these separately from
// the game boards. The Odds API only carries the championship winner per league
// (no MVP/award/pennant markets). Exchange "No"/lay side (outrights_lay) is a
// future Phase 2 add for Kalshi/Polymarket two-sided EV.
const FUTURES_SPORTS = [
  'baseball_mlb_world_series_winner',
  'americanfootball_nfl_super_bowl_winner',
  'americanfootball_ncaaf_championship_winner',
  'basketball_nba_championship_winner',
  'basketball_ncaab_championship_winner',
  'icehockey_nhl_championship_winner',
];

// Per-event additional markets (alt lines + team totals), pulled one game at a time
// from the /events/{id}/odds endpoint. Sport-aware: ONLY sports listed here get a
// per-event pull. All six leagues get the full alt-line + team-total layer, matching
// MLB. Only games starting within EVENT_HORIZON_MS are pulled, so offseason leagues
// cost nothing until their slate fills in.
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
// rarely have alt lines posted yet, and this caps job runtime. Featured lines still
// cover the full slate; only the alt/team-total layer is gated.
const EVENT_HORIZON_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// Prediction-market taker-fee adjustment (Kalshi + Polymarket)
//
// Both venues charge a taker fee of  θ · C · p · (1−p)  per fill, where p is the
// contract price in dollars (0–1) and C the number of contracts. Crucially the
// fee is paid UP FRONT — added to your cost — not netted out of the payout. So
// for $1 of payout the effective cost per contract is:
//     p_eff = p · (1 + θ·(1−p))
// and the effective decimal odds are 1 / p_eff. This reproduces the venue's own
// "stake → to-win" math exactly (verified against Polymarket US: a 37¢ ask shows
// +170 raw but pays +162 after the $3.05 taker fee on a ~$100 / 262-contract order).
//
// The Odds API serves the raw price with no fee baked in, so we bake it in here.
// θ: Kalshi 0.07, Polymarket US regulated exchange 0.05 (uniform taker).
// ─────────────────────────────────────────────────────────────────────────
const KALSHI_FEE_COEFF = 0.07;
const POLYMARKET_FEE_COEFF = 0.05;

function applyTakerFee(rawAmericanOdds, theta) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  // Implied price (probability) of the quoted odds.
  let p;
  if (rawAmericanOdds > 0) {
    p = 100 / (rawAmericanOdds + 100);
  } else {
    p = Math.abs(rawAmericanOdds) / (Math.abs(rawAmericanOdds) + 100);
  }
  if (p <= 0 || p >= 1) return rawAmericanOdds;
  // Taker fee is added to cost → effective price, then convert back to odds.
  const effPrice = p * (1 + theta * (1 - p));
  const decimalOdds = 1 / effPrice;
  if (decimalOdds <= 1) return rawAmericanOdds;
  if (decimalOdds >= 2) return Math.round((decimalOdds - 1) * 100);
  return -Math.round(100 / (decimalOdds - 1));
}

function applyKalshiFee(rawAmericanOdds) {
  return applyTakerFee(rawAmericanOdds, KALSHI_FEE_COEFF);
}

// ─────────────────────────────────────────────────────────────────────────
// ProphetX commission adjustment
// ProphetX takes 2% on net winnings only.
// ─────────────────────────────────────────────────────────────────────────
const PROPHETX_COMMISSION_RATE = 0.02; // 2%

function applyProphetXCommission(rawAmericanOdds) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  // Convert American to decimal
  let rawDecimal;
  if (rawAmericanOdds > 0) {
    rawDecimal = 1 + rawAmericanOdds / 100;
  } else {
    rawDecimal = 1 + 100 / Math.abs(rawAmericanOdds);
  }
  // Apply commission to winnings only (decimal - 1 = profit per $1 staked)
  const effectiveDecimal = 1 + (rawDecimal - 1) * (1 - PROPHETX_COMMISSION_RATE);
  if (effectiveDecimal <= 1) return rawAmericanOdds;
  // Convert back to American
  let adjustedAmerican;
  if (effectiveDecimal >= 2) {
    adjustedAmerican = Math.round((effectiveDecimal - 1) * 100);
  } else {
    adjustedAmerican = -Math.round(100 / (effectiveDecimal - 1));
  }
  return adjustedAmerican;
}

function applyPolymarketFee(rawAmericanOdds) {
  return applyTakerFee(rawAmericanOdds, POLYMARKET_FEE_COEFF);
}

// ─────────────────────────────────────────────────────────────────────────
// Apply per-book fee/commission adjustments to a sport's raw data
// Currently handles: kalshi (fee schedule) + prophetx (2% commission)
//                    + polymarket (taker fee)
// ─────────────────────────────────────────────────────────────────────────
function applyBookAdjustments(sportData) {
  if (!Array.isArray(sportData)) return sportData;
  return sportData.map(game => {
    if (!game.bookmakers) return game;
    return {
      ...game,
      bookmakers: game.bookmakers.map(bookmaker => {
        let adjustFn = null;
        if (bookmaker.key === 'kalshi') {
          adjustFn = applyKalshiFee;
        } else if (bookmaker.key === 'prophetx') {
          adjustFn = applyProphetXCommission;
        } else if (bookmaker.key === 'polymarket') {
          adjustFn = applyPolymarketFee;
        } else {
          return bookmaker;
        }
        return {
          ...bookmaker,
          markets: (bookmaker.markets || []).map(market => ({
            ...market,
            outcomes: (market.outcomes || []).map(outcome => ({
              ...outcome,
              price: adjustFn(outcome.price),
            })),
          })),
        };
      }),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Main handler
// Regions:
//   us  — DK, FD, Caesars, BetMGM, BetRivers, Fanatics, Bovada, MyBookie,
//          BetOnline, LowVig, BetUS
//   us2 — Hard Rock Bet, theScore Bet (formerly ESPN Bet), Bally Bet,
//          BetAnything, betPARX, Fliff
//   us_ex — Kalshi, Novig, ProphetX, BetOpenly, Polymarket
// Cost per invocation:
//   Featured (bulk /odds): 3 regions × 3 markets × 6 sports = 54 credits
//   Per-event (all sports): ~N games in the 24h window × 4 markets × 3 regions.
//     MLB full slate ≈ 180 credits; each in-season league adds a similar chunk when
//     its games fall inside EVENT_HORIZON_MS. Peak overlap (e.g. NFL + NBA + NHL +
//     college nights in winter) is the high-water mark — still trivial on the 5M plan.
//   Note: per-event is gated to the 24h horizon, so offseason leagues cost nothing
//   until their slate fills in; featured is billed per sport regardless of slate size.
//
// All six current leagues use 2-way h2h (no Draw), so moneyline EV computes
// directly. The is_three_way detection downstream stays as defensive cover for
// any future 3-way sport (e.g. soccer) but is inert for this set.
// ─────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  try {
    const results = [];
    for (const sport of SPORTS) {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,us2,us_ex&markets=h2h,spreads,totals&oddsFormat=american`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Failed to fetch ${sport}: ${response.status}`);
        continue;
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
            const evUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${game.id}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,us2,us_ex&markets=${marketsParam}&oddsFormat=american`;
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
    }

    // ── Futures / outrights (championship winners) ──
    // Bulk /odds pull with markets=outrights for each futures key. Same fee/commission
    // adjustments apply to any exchange (Kalshi/Polymarket/ProphetX) outright prices.
    // Upserted into odds_cache under the futures key so the frontend can query them
    // apart from the game boards. Only 6 keys, 1 credit-cheap call each.
    for (const sport of FUTURES_SPORTS) {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,us2,us_ex&markets=outrights&oddsFormat=american`;
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`Failed to fetch futures ${sport}: ${response.status}`);
          continue;
        }
        const rawData = await response.json();
        const data = applyBookAdjustments(rawData);
        const { error } = await supabase
          .from('odds_cache')
          .upsert({ sport, data, fetched_at: new Date().toISOString() }, { onConflict: 'sport' });
        if (error) {
          console.error(`Supabase upsert error for futures ${sport}:`, error);
        } else {
          results.push({ sport, futures: Array.isArray(data) ? data.length : 0 });
        }
      } catch (futErr) {
        console.error(`futures exception ${sport}:`, futErr.message);
      }
    }

    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
