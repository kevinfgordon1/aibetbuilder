const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SPORTS = [
  'basketball_nba',
  'baseball_mlb',
  'icehockey_nhl',
];

// =============================================================================
// Kalshi fee adjustment
// -----------------------------------------------------------------------------
// Kalshi shows raw order book prices, but actually takes a fee on every trade.
// Formula (from Kalshi's published fee schedule):
//   fee_cents = ceil(0.07 × contracts × P × (1 - P) × 100)
// For $100 stake at price P cents, net payout is:
//   net_payout_cents = (1,000,000 - 700 × (100 - P)) / P
//
// We apply a 50-cent safety buffer to absorb Kalshi's internal rounding.
//
// This function takes raw American odds, back-calculates the implied cent
// price, applies the fee, and returns fee-adjusted American odds that match
// what Kalshi actually shows in their Dollars mode UI.
// =============================================================================
function applyKalshiFee(rawAmericanOdds) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;

  // Convert American odds to implied probability (cent price)
  // +150 → 100 / (150+100) = 0.40 → 40¢
  // -150 → 150 / (150+100) = 0.60 → 60¢
  let centPrice;
  if (rawAmericanOdds > 0) {
    centPrice = (100 / (rawAmericanOdds + 100)) * 100;
  } else {
    centPrice = (Math.abs(rawAmericanOdds) / (Math.abs(rawAmericanOdds) + 100)) * 100;
  }

  // Kalshi only trades at whole-cent prices
  centPrice = Math.round(centPrice);
  if (centPrice < 1 || centPrice > 99) return rawAmericanOdds; // edge case, bail

  // Apply fee formula for $100 stake
  // net_payout_cents = (1,000,000 - 700 × (100 - P)) / P
  const netPayoutCents = (1000000 - 700 * (100 - centPrice)) / centPrice;
  const netPayoutWithBuffer = netPayoutCents - 50; // 50¢ safety buffer

  // Convert net payout to American odds
  // decimal_odds = net_payout / 100
  // American odds: if decimal >= 2, +((decimal-1) × 100); else -(100 / (decimal-1))
  const decimalOdds = netPayoutWithBuffer / 100;
  if (decimalOdds < 1) return rawAmericanOdds; // safety check

  let adjustedAmerican;
  if (decimalOdds >= 2) {
    adjustedAmerican = Math.round((decimalOdds - 1) * 100);
  } else {
    adjustedAmerican = -Math.round(100 / (decimalOdds - 1));
  }

  return adjustedAmerican;
}

// Transform a The Odds API response, fee-adjusting any Kalshi outcomes
function feeAdjustKalshiOdds(sportData) {
  if (!Array.isArray(sportData)) return sportData;

  return sportData.map(game => {
    if (!game.bookmakers) return game;

    return {
      ...game,
      bookmakers: game.bookmakers.map(bookmaker => {
        if (bookmaker.key !== 'kalshi') return bookmaker;

        return {
          ...bookmaker,
          markets: (bookmaker.markets || []).map(market => ({
            ...market,
            outcomes: (market.outcomes || []).map(outcome => ({
              ...outcome,
              price: applyKalshiFee(outcome.price),
            })),
          })),
        };
      }),
    };
  });
}

module.exports = async (req, res) => {
  try {
    const results = [];
    for (const sport of SPORTS) {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,us_ex&markets=h2h,spreads,totals&oddsFormat=american`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Failed to fetch ${sport}: ${response.status}`);
        continue;
      }
      const rawData = await response.json();

      // Fee-adjust any Kalshi odds before storing
      const data = feeAdjustKalshiOdds(rawData);

      const { error } = await supabase
        .from('odds_cache')
        .upsert({ sport, data, fetched_at: new Date().toISOString() }, { onConflict: 'sport' });
      if (error) {
        console.error(`Supabase upsert error for ${sport}:`, error);
      } else {
        results.push({ sport, games: data.length });
      }
    }
    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
