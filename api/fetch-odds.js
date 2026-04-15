const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const SPORTS = [
  'basketball_nba',
  'baseball_mlb',
  'icehockey_nhl'
]

module.exports = async function handler(req, res) {
  try {
    for (const sport of SPORTS) {
      const response = await fetch(
        `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`
      )
      const data = await response.json()

      await supabase
        .from('odds_cache')
        .upsert({ sport, data, fetched_at: new Date() }, { onConflict: 'sport' })
    }

    res.status(200).json({ success: true, timestamp: new Date() })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
