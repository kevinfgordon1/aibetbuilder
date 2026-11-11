const { guardCron } = require('../lib/cron-auth');
const { supabase, applyBookAdjustments } = require('../lib/odds-shared');
const { dropExcludedBooks } = require('../lib/odds-excluded-books');
const ncaamChamp = require('../lib/ncaam-champ');

// Championship / outright futures for six leagues. The Odds API supplies the
// sportsbook (Yes) side; Kalshi + Polymarket are pulled directly for the exchange
// Yes/No sides and injected as extra bookmakers. Upserted into odds_cache under
// each futures key, read separately from the game boards by the frontend.
// Split out from /api/fetch-odds so game lines and futures run as independent jobs.
// World Series only with MLB_ENABLED=1 (Kevin Oct 30 2026, season over).
const FUTURES_SPORTS = require('../lib/mlb-switch').withoutMlb([
  'baseball_mlb_world_series_winner',
  'americanfootball_nfl_super_bowl_winner',
  'americanfootball_ncaaf_championship_winner',
  'basketball_nba_championship_winner',
  'basketball_ncaab_championship_winner',
  'icehockey_nhl_championship_winner',
]);

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
  // NCAAM: Polymarket US cbb-champ-* (not the international gamma event) + Kalshi KXMARMAD, joined on
  // ESPN team id via lib/ncaam-champ-crosswalk.json. See lib/ncaam-champ.js / buildNcaamExchangeBookmakers.
  basketball_ncaab_championship_winner:    { ncaam: true, kalshiSeries: 'KXMARMAD' },
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

// No international fallback. US NCAAM futures use buildNcaamExchangeBookmakers below.
async function fetchPolymarketFutures() { return []; }

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
    // Dollar size available at each side's ask. Buying No matches Yes bids, so
    // no_ask_size falls back to yes_bid_size when the direct field is absent.
    const yesSizeK = parseFloat(m.yes_ask_size_fp);
    const noSizeK = parseFloat(m.no_ask_size_fp != null ? m.no_ask_size_fp : m.yes_bid_size_fp);
    out.push({ team, yes, no, yesSize: isFinite(yesSizeK) ? yesSizeK : null, noSize: isFinite(noSizeK) ? noSizeK : null });
  }
  return out;
}

// NCAAM national champion: Polymarket US + Kalshi with strict ESPN-id team matching (unmatched dropped),
// depth as potential profit on each exchange outcome.
async function buildNcaamExchangeBookmakers(sport, rawData, deps = {}) {
  const cfg = EXCHANGE_FUTURES[sport];
  const fetchFn = deps.fetchFn || fetch;
  const base = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
  const [polymarket, kalshiBody] = await Promise.all([
    ncaamChamp.fetchPolymarketUsChamp({ fetchFn, ...(deps.sleepFn ? { sleepFn: deps.sleepFn } : {}) }).catch((e) => { console.error(`polymarket us ncaam futures: ${e.message}`); return []; }),
    deps.kalshiBody !== undefined ? Promise.resolve(deps.kalshiBody)
      : fetchJson(`${base}/events?series_ticker=${encodeURIComponent(cfg.kalshiSeries)}&status=open&with_nested_markets=true`),
  ]);
  const kalshi = ncaamChamp.kalshiChampFromEvents(kalshiBody);
  return ncaamChamp.buildNcaamChampBookmakers(rawData, { polymarket, kalshi });
}

// Build injectable kalshi/polymarket bookmaker objects for a futures event,
// matching each exchange contract to the sportsbook team names in rawData.
async function buildExchangeBookmakers(sport, rawData) {
  const cfg = EXCHANGE_FUTURES[sport];
  if (!cfg) return { bookmakers: [], diag: {} };
  if (cfg.ncaam) return buildNcaamExchangeBookmakers(sport, rawData);
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
      if (r.yes != null) yesOut.push({ name, price: r.yes, size: r.yesSize != null ? r.yesSize : null });
      if (r.no != null) noOut.push({ name, price: r.no, size: r.noSize != null ? r.noSize : null });
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
const handler = async (req, res) => {
  if (!(await guardCron(req, res))) return;
  try {
    const results = [];
    await Promise.all(FUTURES_SPORTS.map(async (sport) => {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,us2,us_ex,eu&markets=outrights,outrights_lay&oddsFormat=american`;
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`Failed to fetch futures ${sport}: ${response.status}`);
          return;
        }
        let rawData = dropExcludedBooks(await response.json());
        // NCAAM: keep a row for the exchanges even when no sportsbook has posted the outright yet.
        if (EXCHANGE_FUTURES[sport] && EXCHANGE_FUTURES[sport].ncaam) rawData = ncaamChamp.ensureOutrightsEvent(rawData, sport);
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
        // NCAAM: one name per team across every book + exchange so the board shows one Yes/No row pair per team.
        if (EXCHANGE_FUTURES[sport] && EXCHANGE_FUTURES[sport].ncaam) {
          try { exDiag = { ...exDiag, renamed: ncaamChamp.unifyTeamNames(rawData) }; } catch (e) { console.error(`ncaam name unify failed: ${e.message}`); }
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

module.exports = handler;
module.exports._helpers = { EXCHANGE_FUTURES, FUTURES_SPORTS, buildExchangeBookmakers, buildNcaamExchangeBookmakers };
