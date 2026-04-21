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
