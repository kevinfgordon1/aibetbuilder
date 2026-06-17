const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SPORTS = [
  'baseball_mlb',
  'soccer_fifa_world_cup',
];

// Per-event additional markets (alt lines + team totals), pulled one game at a time
// from the /events/{id}/odds endpoint. Sport-aware: ONLY sports listed here get a
// per-event pull. Starting with MLB; soccer stays off until we verify US-book
// World Cup alt-market coverage with a live pull.
const EVENT_MARKETS = {
  baseball_mlb: ['alternate_spreads', 'alternate_totals', 'team_totals', 'alternate_team_totals'],
  soccer_fifa_world_cup: ['alternate_spreads', 'alternate_totals', 'team_totals', 'alternate_team_totals'],
};

// Only pull per-event markets for games starting within this window. Far-out games
// rarely have alt lines posted yet, and this caps job runtime. Featured lines still
// cover the full slate; only the alt/team-total layer is gated.
const EVENT_HORIZON_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// Kalshi fee adjustment
// ─────────────────────────────────────────────────────────────────────────
function applyKalshiFee(rawAmericanOdds) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  let centPrice;
  if (rawAmericanOdds > 0) {
    centPrice = (100 / (rawAmericanOdds + 100)) * 100;
  } else {
    centPrice = (Math.abs(rawAmericanOdds) / (Math.abs(rawAmericanOdds) + 100)) * 100;
  }
  centPrice = Math.round(centPrice);
  if (centPrice < 1 || centPrice > 99) return rawAmericanOdds;
  // Net payout in cents for $100 (= 10,000 cents) stake
  const netPayoutCents = (1000000 - 700 * (100 - centPrice)) / centPrice;
  const netPayoutWithBuffer = netPayoutCents - 50;
  // Decimal odds = net_payout_cents / stake_cents = netPayoutCents / 10000
  const decimalOdds = netPayoutWithBuffer / 10000;
  if (decimalOdds < 1) return rawAmericanOdds;
  let adjustedAmerican;
  if (decimalOdds >= 2) {
    adjustedAmerican = Math.round((decimalOdds - 1) * 100);
  } else {
    adjustedAmerican = -Math.round(100 / (decimalOdds - 1));
  }
  return adjustedAmerican;
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

// ─────────────────────────────────────────────────────────────────────────
// Apply per-book fee/commission adjustments to a sport's raw data
// Currently handles: kalshi (fee schedule) + prophetx (2% commission)
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
//   Featured (bulk /odds): 3 regions × 3 markets × 2 sports = 18 credits
//   Per-event (MLB only):  ~15 games × 4 markets × 3 regions ≈ 180 credits
//   → ~200 credits/invocation when MLB's slate is full. Trivial on the 5M plan;
//     would have blown the old 100K plan, which is why this waited for the upgrade.
//
// NOTE (soccer_fifa_world_cup): h2h is 3-way (Home / Draw / Away). The draw
// outcome must be handled downstream before moneyline EV is valid. spreads
// (Asian handicap) and totals are 2-way and compute normally.
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
    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
