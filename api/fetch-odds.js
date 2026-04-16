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

      const data = await response.json();

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
