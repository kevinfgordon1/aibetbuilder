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
// long list of team outcomes, pulled with markets=outrights,outrights_lay. Stored in the same
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
// skips that exchange/league and never breaks the main odds job.
// ═════════════════════════════════════════════════════════════════════════

// Per futures key: Polymarket search query + title keywords used to locate the
// right event/series on each exchange (matched against slug/title, case-insensitive).
// pmQuery/keywords → Polymarket event discovery. kalshiSeries → Kalshi series
// ticker (its current open event holds one market per team). KXMLB confirmed;
// the others are filled once we confirm each league's series ticker (null =
// Kalshi skipped for that league, so we never inject the wrong market).
const EXCHANGE_FUTURES = {
  baseball_mlb_world_series_winner:        { pmQuery: 'World Series',            keywords: ['world series'],        kalshiSeries: 'KXMLB' },
  americanfootball_nfl_super_bowl_winner:  { pmQuery: 'Super Bowl',             keywords: ['super bowl'],          kalshiSeries: null },
  americanfootball_ncaaf_championship_winner: { pmQuery: 'College Football Playoff', keywords: ['college football playoff', 'cfp', 'national championship'], kalshiSeries: null },
  basketball_nba_championship_winner:      { pmQuery: 'NBA Champion',           keywords: ['nba champion', 'nba finals'], kalshiSeries: null },
  basketball_ncaab_championship_winner:    { pmQuery: 'March Madness',          keywords: ['march madness', 'ncaa', 'college basketball champion'], kalshiSeries: null },
  icehockey_nhl_championship_winner:       { pmQuery: 'Stanley Cup',            keywords: ['stanley cup'],         kalshiSeries: null },
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
    // Bulk /odds pull with markets=outrights,outrights_lay for each futures key.
    // outrights = back/Yes side (all books); outrights_lay = exchange against/No side
    // (Kalshi/Polymarket/Novig/ProphetX). Same fee/commission
    // adjustments apply to any exchange (Kalshi/Polymarket/ProphetX) outright prices.
    // Upserted into odds_cache under the futures key so the frontend can query them
    // apart from the game boards. Only 6 keys, 1 credit-cheap call each.
    for (const sport of FUTURES_SPORTS) {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,us2,us_ex&markets=outrights,outrights_lay&oddsFormat=american`;
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`Failed to fetch futures ${sport}: ${response.status}`);
          continue;
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
    }

    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
