// Load the canonical game schedule for a set of Kalshi events: public.game_schedule first (written by combo-worker's
// schedule sync), then ESPN's public scoreboard live for any league/day the table doesn't cover yet.
'use strict';
const GS = require('./game-schedule');
async function loadSchedule(events, env, f = (...a) => fetch(...a), maxEspn = 16) {
  const want = new Set(); // league|YYYY-MM-DD
  for (const ev of events) { const p = GS.parseEvent(ev); if (!p) continue; for (const d of (GS.LEAGUES[p.league].dateShift || [0])) want.add(`${p.league}|${GS.addDays(p.date, d)}`); }
  if (!want.size) return { games: [], from: 'none' };
  let games = []; const have = new Set(); let from = 'table';
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL; const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY; // table is public-read (RLS)
  if (url && key) {
    try {
      const dates = [...new Set([...want].map((k) => k.split('|')[1]))];
      const r = await f(`${url}/rest/v1/game_schedule?select=*&et_date=in.(${dates.join(',')})&limit=5000`, { headers: { apikey: key, Authorization: `Bearer ${key}`, accept: 'application/json' } });
      if (r.ok) { const rows = await r.json(); games = (rows || []).map(GS.rowToGame).filter((g) => Number.isFinite(g.start_ms)); for (const g of games) have.add(`${g.league}|${GS.etDate(g.start_ms)}`); }
    } catch (_) { /* table missing or down: live ESPN below */ }
  }
  const gaps = [...want].filter((k) => !have.has(k)).slice(0, maxEspn);
  if (gaps.length) from = have.size ? 'table+espn' : 'espn';
  await Promise.all(gaps.map(async (k) => { const [lg, d] = k.split('|'); try { games.push(...await GS.fetchEspnDay(lg, d, f)); } catch (_) { /* that day stays unverified */ } }));
  return { games, from };
}

module.exports = { loadSchedule };
