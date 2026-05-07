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

// ─────────────────────────────────────────────────────────────────────────
// Kalshi fee adjustment (unchanged from existing)
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
// ProphetX commission adjustment (NEW)
// ProphetX takes 2% on net winnings only. So a raw +128 actually pays
// out as if it were +125 because winnings are reduced by 2%.
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
// Main handler — unchanged structure, only the adjustment function name
// changed from feeAdjustKalshiOdds to applyBookAdjustments
// ─────────────────────────────────────────────────────────────────────────
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
      const data = applyBookAdjustments(rawData);
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
