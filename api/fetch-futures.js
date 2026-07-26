const { supabase, applyBookAdjustments } = require('../lib/odds-shared');

// Championship / outright futures for six leagues. The Odds API supplies the
// sportsbook (Yes) side; Kalshi + Polymarket are pulled directly for the exchange
// Yes/No sides and injected as extra bookmakers. Upserted into odds_cache under
// each futures key, read separately from the game boards by the frontend.
// Split out from /api/fetch-odds so game lines and futures run as independent jobs.
const FUTURES_SPORTS = [
  'baseball_mlb_world_series_winner',
  'americanfootball_nfl_super_bowl_winner',
  'americanfootball_ncaaf_championship_winner',
  'basketball_nba_championship_winner',
  'basketball_ncaab_championship_winner',
  'icehockey_nhl_championship_winner',
];

// ═════════════════════════════════════════════════════════════════════════
// Direct exchange futures (Kalshi + Polymarket)
//
// The Odds API returns NO exchange data for the outright/championship markets
// (verified: empty bookmakers on the us_ex region). So we pull championship
// futures straight from Kalshi and Polymarket (both public, keyless), convert
// their probability prices to American odds, match each contract to the team
// name the sportsbooks use, and inject them as `kalshi`/`polymarket` bookmakers
// with a Yes side (`outrights`) and No side (`outrights_lay`). Downstream this
// is identical to sportsbook data: applyBookAdjustments bakes in the taker fees
// and the frontend renders them with no changes. All best-effort — any failure
// skips that exchange/league and never breaks the job.
// ═════════════════════════════════════════════════════════════════════════

// pmQuery/keywords → Polymarket event discovery. kalshiSeries → Kalshi series
// ticker (its current open event holds one market per team). All six confirmed
// from the live Kalshi market URLs (kalshi.com/markets/<series>/…).
const EXCHANGE_FUTURES = {
  baseball_mlb_world_series_winner:        { pmQuery: 'World Series',            keywords: ['world series'],        kalshiSeries: 'KXMLB' },
  americanfootball_nfl_super_bowl_winner:  { pmQuery: 'Super Bowl',             keywords: ['super bowl'],          kalshiSeries: 'KXSB' },
  americanfootball_ncaaf_championship_winner: { pmQuery: 'College Football Playoff', keywords: ['college football playoff', 'cfp', 'national championship'], kalshiSeries: 'KXNCAAF' },
  basketball_nba_championship_winner:      { pmQuery: 'NBA Champion',           keywords: ['nba champion', 'nba finals'], kalshiSeries: 'KXNBA' },
  basketball_ncaab_championship_winner:    { pmQuery: 'March Madness',          keywords: ['march madness', 'ncaa', 'college basketball champion'], kalshiSeries: 'KXMARMAD' },
  icehockey_nhl_championship_winner:       { pmQuery: 'Stanley Cup',            keywords: ['stanley cup'],         kalshiSeries: 'KXNHL' },
};

function probToAmerican(p) {
  if (p == null || !(p > 0 && p < 1)) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

function normTeam(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Resolve an exchange team label to the exact team name the sportsbooks use, so
// both land on the same row. Returns null when no confident match (contract dropped).
function matchCanonical(label, canon) {
  const n = normTeam(label);
  if (!n) return null;
  let hit = canon.find(c => c.norm === n);
  if (hit) return hit.name;
  hit = canon.find(c => c.norm.includes(n) || n.includes(c.norm));
  if (hit) return hit.name;
  const lastTok = n.split(' ').pop();
  if (lastTok && lastTok.length > 3) {
    hit = canon.find(c => c.norm.split(' ').pop() === lastTok);
    if (hit) return hit.name;
  }
  return null;
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'aibetbuilder/1.0 (+https://aibetbuilder.io)' } });
    if (!r.ok) { console.error(`exchange fetch ${r.status}: ${url}`); return null; }
    return await r.json();
  } catch (e) {
    console.error(`exchange fetch error: ${url} — ${e.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Polymarket (Gamma API) ──
async function fetchPolymarketFutures(cfg) {
  const search = await fetchJson(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(cfg.pmQuery)}`);
  const events = (search && (search.events || search.data)) || [];
  const kw = cfg.keywords.map(k => k.toLowerCase());
  const sig = (e) => `${e.slug || ''} ${e.title || ''}`.toLowerCase().replace(/-/g, ' ');
  const notClosed = (e) => !e.closed && e.active !== false;
  let ev = events.find(e => notClosed(e) && kw.some(k => sig(e).includes(k)) && /champion|winner|world series|super bowl|stanley cup|finals/.test(sig(e)))
        || events.find(e => notClosed(e) && kw.some(k => sig(e).includes(k)));
  if (!ev) return [];
  let markets = ev.markets;
  if (!markets || !markets.length) {
    const full = await fetchJson(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(ev.slug)}`);
    markets = (Array.isArray(full) && full[0] && full[0].markets) || [];
  }
  const out = [];
  for (const m of markets) {
    if (m.closed) continue;
    const team = m.groupItemTitle || m.title;
    let prices, outcomes;
    try { prices = JSON.parse(m.outcomePrices); } catch { prices = null; }
    try { outcomes = JSON.parse(m.outcomes); } catch { outcomes = ['Yes', 'No']; }
    if (!team || !Array.isArray(prices) || prices.length < 2) continue;
    let yi = outcomes.findIndex(o => String(o).toLowerCase() === 'yes');
    let ni = outcomes.findIndex(o => String(o).toLowerCase() === 'no');
    if (yi < 0) yi = 0;
    if (ni < 0) ni = 1;
    out.push({ team, yes: probToAmerican(parseFloat(prices[yi])), no: probToAmerican(parseFloat(prices[ni])) });
  }
  return out;
}

// ── Kalshi (public trade-api v2) ──
// Kalshi models a "who wins the championship" market as ONE event (e.g. KXMLB-26)
// under a league series (e.g. KXMLB), with one nested market per team. Discover
// via series ticker → current open event(s) → nested markets. Team is in
// `yes_sub_title` (often abbreviated, e.g. "Los Angeles D", "New York Y"); prices
// in `yes_ask_dollars`/`no_ask_dollars` (0–1), falling back to integer-cent fields.
function parseKalshiPrice(dollarStr, centsInt) {
  if (dollarStr != null && dollarStr !== '') { const d = parseFloat(dollarStr); if (isFinite(d)) return d; }
  if (centsInt != null && isFinite(centsInt)) return centsInt / 100;
  return null;
}

async function fetchKalshiFutures(cfg) {
  if (!cfg.kalshiSeries) return [];
  const base = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
  const resp = await fetchJson(`${base}/events?series_ticker=${encodeURIComponent(cfg.kalshiSeries)}&status=open&with_nested_markets=true`);
  const markets = ((resp && resp.events) || []).flatMap(e => e.markets || []);
  const out = [];
  for (const m of markets) {
    if (m.status && m.status !== 'active' && m.status !== 'open') continue;
    const team = m.yes_sub_title || m.subtitle || m.title;
    const yesP = parseKalshiPrice(m.yes_ask_dollars, m.yes_ask);
    const noP = parseKalshiPrice(m.no_ask_dollars, m.no_ask);
    const yes = (yesP != null && yesP > 0 && yesP < 1) ? probToAmerican(yesP) : null;
    const no = (noP != null && noP > 0 && noP < 1) ? probToAmerican(noP) : null;
    if (!team || (yes == null && no == null)) continue;
    out.push({ team, yes, no });
  }
  return out;
}

// Build injectable kalshi/polymarket bookmaker objects for a futures event,
// matching each exchange contract to the sportsbook team names in rawData.
async function buildExchangeBookmakers(sport, rawData) {
  const cfg = EXCHANGE_FUTURES[sport];
  if (!cfg) return { bookmakers: [], diag: {} };
  const ev = Array.isArray(rawData) ? rawData[0] : null;

  // Canonical team names = the exact strings the sportsbooks use (outrights side).
  const canonMap = new Map();
  (ev?.bookmakers || []).forEach(bm => {
    (bm.markets || []).forEach(mk => {
      if (mk.key !== 'outrights') return;
      (mk.outcomes || []).forEach(o => { if (o.name) canonMap.set(normTeam(o.name), o.name); });
    });
  });
  const canon = [...canonMap.entries()].map(([norm, name]) => ({ norm, name }));
  const resolveName = (label) => (canon.length === 0 ? label : matchCanonical(label, canon));

  const specs = [['polymarket', 'Polymarket', fetchPolymarketFutures], ['kalshi', 'Kalshi', fetchKalshiFutures]];
  const pulled = await Promise.all(specs.map(async ([key, title, fn]) => {
    let raw = [];
    try { raw = (await fn(cfg)) || []; } catch (e) { console.error(`${key} futures error ${sport}: ${e.message}`); }
    const yesOut = [], noOut = [];
    for (const r of raw) {
      const name = resolveName(r.team);
      if (!name) continue;
      if (r.yes != null) yesOut.push({ name, price: r.yes });
      if (r.no != null) noOut.push({ name, price: r.no });
    }
    return { key, title, yesOut, noOut };
  }));

  const bookmakers = [];
  const diag = {};
  const nowIso = new Date().toISOString();
  for (const { key, title, yesOut, noOut } of pulled) {
    diag[key] = yesOut.length;
    if (yesOut.length || noOut.length) {
      bookmakers.push({
        key, title, last_update: nowIso,
        markets: [
          ...(yesOut.length ? [{ key: 'outrights', outcomes: yesOut }] : []),
          ...(noOut.length ? [{ key: 'outrights_lay', outcomes: noOut }] : []),
        ],
      });
    }
  }
  return { bookmakers, diag };
}

// ─────────────────────────────────────────────────────────────────────────
// Main handler — championship futures (sportsbook outrights + exchange Yes/No)
// Bulk /odds pull with markets=outrights,outrights_lay for each futures key, then
// inject Kalshi/Polymarket. Leagues run concurrently. Cheap: 6 Odds API calls
// plus a handful of free exchange calls.
// ─────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  try {
    const results = [];
    await Promise.all(FUTURES_SPORTS.map(async (sport) => {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,us2,us_ex&markets=outrights,outrights_lay&oddsFormat=american`;
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`Failed to fetch futures ${sport}: ${response.status}`);
          return;
        }
        const rawData = await response.json();
        // Inject direct Kalshi/Polymarket exchange futures (Yes + No) before fee adjustment.
        let exDiag = {};
        try {
          const { bookmakers: exBm, diag } = await buildExchangeBookmakers(sport, rawData);
          exDiag = diag;
          if (exBm.length && Array.isArray(rawData) && rawData[0]) {
            rawData[0].bookmakers = [...(rawData[0].bookmakers || []), ...exBm];
          }
        } catch (exErr) {
          console.error(`exchange futures inject failed ${sport}:`, exErr.message);
        }
        const data = applyBookAdjustments(rawData);
        const { error } = await supabase
          .from('odds_cache')
          .upsert({ sport, data, fetched_at: new Date().toISOString() }, { onConflict: 'sport' });
        if (error) {
          console.error(`Supabase upsert error for futures ${sport}:`, error);
        } else {
          results.push({ sport, futures: Array.isArray(data) ? data.length : 0, exchanges: exDiag });
        }
      } catch (futErr) {
        console.error(`futures exception ${sport}:`, futErr.message);
      }
    }));

    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
