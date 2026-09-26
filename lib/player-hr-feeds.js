'use strict';

// MLB batter home run (1+ HR) exchange quotes for the Promo props cron.
//   Kalshi      KXMLBHR series, -1 (1+) strike only. Public REST.
//   Polymarket  US gateway event payload, sportsMarketType
//               baseball_player_home_runs, line 1 (keyless).
//   Underdog    phone prediction lines, PickemStat ml_player_hr 0.5.
// Checked 2026-09-26: all three list MLB HR props. Each quote carries a
// Yes ask (fee-inclusive American) and, when there is a Yes bid, a No ask
// American (No ask = 1 − Yes bid, TAKER_FEE_RATE on the No). Game identity
// is MLB|AWAY|HOME|YYYY-MM-DD (ET date) plus a commence for doubleheaders.

const {
  TAKER_FEE_RATE,
  asUnitProb,
  parseAmerican,
  boardYesAmerican,
  noAskAmericanFromYesBid,
  quoteIsOlderThan,
  parseKalshiHrTicker,
  playerNameFromKalshiTitle,
  pairKeyFromMlbSlug,
  mlbSlugFromTeams,
  mlbAbbrFromName,
  canonMlbAbbr,
  hrMarketFromLine,
  easternDate,
} = require('./player-td.cjs');
const { UNDERDOG_BOARD_OMIT_MS } = require('./underdog-freshness');
const {
  KALSHI_REST,
  POLY_GATEWAY,
  fetchJson,
  sleep,
  valuesOf,
  indexById,
  mapPool,
  polyProb,
  noLevel,
  underdogConfig,
} = require('./player-td-feeds');

const KALSHI_HR_SERIES = 'KXMLBHR';
// limit=1000 drew 429s from Kalshi in testing; 200 per page with a cursor
// covers a full slate (~15 games x ~12 players x 2 strikes) in two pages.
const KALSHI_HR_PAGE = 200;
const KALSHI_HR_MAX_PAGES = 6;
const KALSHI_PAGE_GAP_MS = 250;
// Underdog PickemStat id for MLB "Home Runs" (appearance_stat.stat
// ml_player_hr), from the public over_under_lines catalog 2026-09-26.
const UNDERDOG_HR_FILTER_ID = 'b4110658-5fce-4e94-b25e-c6e3d760e02c';
const MAX_POLY_HR_GAMES = 16;
const POLY_HR_CONCURRENCY = 2;

function kalshiHrQuoteFromMarket(market, nowMs) {
  if (!market) return null;
  if (market.status && !['active', 'open'].includes(String(market.status).toLowerCase())) return null;
  const parsed = parseKalshiHrTicker(market.ticker);
  if (!parsed) return null;
  const yesAsk = asUnitProb(market.yes_ask_dollars != null ? market.yes_ask_dollars : market.yes_ask);
  const yesBid = asUnitProb(market.yes_bid_dollars != null ? market.yes_bid_dollars : market.yes_bid);
  const player = playerNameFromKalshiTitle(market.title, market.yes_sub_title);
  if (!player || (yesAsk == null && yesBid == null)) return null;
  const fee = TAKER_FEE_RATE.kalshi;
  const noAmerican = yesBid == null ? null : noAskAmericanFromYesBid(yesBid, fee);
  const top = noAmerican == null ? null : noLevel(yesBid, market.yes_bid_size_fp != null ? market.yes_bid_size_fp : market.yes_bid_size, fee);
  const noSize = top ? top.size : null;
  return {
    book: 'kalshi',
    market: 'hr',
    player,
    team: parsed.team,
    away: parsed.away,
    home: parsed.home,
    gameKey: parsed.gameKey,
    commence: parsed.commence,
    yesAmerican: yesAsk == null ? null : boardYesAmerican(yesAsk, fee),
    noAmerican,
    noSize,
    noLevels: noSize != null ? [{ american: noAmerican, size: noSize }] : null,
    updatedAt: market.updated_time || new Date(nowMs || Date.now()).toISOString(),
    ticker: market.ticker,
  };
}

function quotesFromKalshiHrMarkets(body, nowMs) {
  const markets = body && Array.isArray(body.markets) ? body.markets : [];
  const out = [];
  for (const market of markets) {
    const quote = kalshiHrQuoteFromMarket(market, nowMs);
    if (quote) out.push(quote);
  }
  return out;
}

async function loadKalshiHrQuotes(deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const base = (deps && deps.kalshiBase) || KALSHI_REST;
  const sleepFn = (deps && deps.sleepFn) || sleep;
  const now = (deps && deps.now) || Date.now();
  const out = [];
  let cursor = '';
  for (let page = 0; page < KALSHI_HR_MAX_PAGES; page += 1) {
    const url = `${base}/markets?series_ticker=${KALSHI_HR_SERIES}&status=open&limit=${KALSHI_HR_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchJson(fetchFn, url, { sleepFn, attempts: deps && deps.attempts ? deps.attempts : 4 });
    if (!res.ok || !res.body) break;
    out.push(...quotesFromKalshiHrMarkets(res.body, now));
    cursor = String(res.body.cursor || '');
    if (!cursor) break;
    await sleepFn(KALSHI_PAGE_GAP_MS);
  }
  return out;
}

function quotesFromPolymarketHrEvent(body) {
  const event = body && body.event ? body.event : body;
  if (!event) return [];
  const slug = pairKeyFromMlbSlug(event.slug || event.ticker);
  if (!slug) return [];
  const teamById = new Map();
  let awayName = '';
  let homeName = '';
  for (const team of event.teams || []) {
    if (!team) continue;
    const abbr = canonMlbAbbr(team.displayAbbreviation || team.abbreviation || '');
    if (team.id != null && abbr) teamById.set(String(team.id), abbr);
    if (abbr === slug.away && team.name) awayName = team.name;
    if (abbr === slug.home && team.name) homeName = team.name;
  }
  const fee = TAKER_FEE_RATE.polymarket;
  const commence = event.startTime || event.startDate || null;
  const out = [];
  for (const market of event.markets || []) {
    const kind = market && (market.sportsMarketType || market.marketType);
    if (kind !== 'baseball_player_home_runs') continue;
    if (hrMarketFromLine(market.line) !== 'hr') continue;
    if (market.closed === true || market.active === false) continue;
    const meta = market.metadata || {};
    const player = meta.playerName || '';
    if (!player) continue;
    const yesAsk = polyProb(market.bestAskQuote);
    const yesBid = polyProb(market.bestBidQuote);
    if (yesAsk == null && yesBid == null) continue;
    out.push({
      book: 'polymarket',
      market: 'hr',
      player,
      team: teamById.get(String(meta.teamId == null ? '' : meta.teamId)) || '',
      away: slug.away,
      home: slug.home,
      awayName,
      homeName,
      gameKey: slug.gameKey,
      commence: market.gameStartTime || commence,
      yesAmerican: yesAsk == null ? null : boardYesAmerican(yesAsk, fee),
      noAmerican: yesBid == null ? null : noAskAmericanFromYesBid(yesBid, fee),
      updatedAt: market.updatedAt || event.updatedAt || null,
      slug: market.slug || null,
      closed: market.closed === true,
    });
  }
  return out;
}

// Polymarket US event slugs for the given games ({ away_team, home_team,
// commence_time } from the Odds API). One event call per game.
function polymarketHrSlugs(games, maxGames = MAX_POLY_HR_GAMES) {
  const slugs = [];
  const seen = new Set();
  for (const game of games || []) {
    if (!game) continue;
    const slug = mlbSlugFromTeams(mlbAbbrFromName(game.away_team), mlbAbbrFromName(game.home_team), easternDate(game.commence_time));
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
    if (slugs.length >= maxGames) break;
  }
  return slugs;
}

async function loadPolymarketHrQuotes(games, deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const base = (deps && deps.polymarketBase) || POLY_GATEWAY;
  const sleepFn = (deps && deps.sleepFn) || sleep;
  const slugs = polymarketHrSlugs(games, deps && deps.maxGames != null ? deps.maxGames : MAX_POLY_HR_GAMES);
  const batches = await mapPool(slugs, POLY_HR_CONCURRENCY, async (slug) => {
    const res = await fetchJson(fetchFn, `${base}/v1/events/slug/${encodeURIComponent(slug)}`, { sleepFn, attempts: 2 });
    if (!res.ok || !res.body) return [];
    return quotesFromPolymarketHrEvent(res.body);
  });
  return batches.flat();
}

function underdogHrLinesUrl(cfg) {
  const params = new URLSearchParams({
    filter_id: UNDERDOG_HR_FILTER_ID,
    filter_type: 'PickemStat',
    include_live: 'true',
    product: cfg.product,
    product_experience_id: cfg.productExperienceId,
    show_mass_option_markets: 'false',
    sport_id: 'MLB',
    state_config_id: cfg.stateConfigId,
  });
  return `${cfg.base}/v1/lobbies/content/lines?${params}`;
}

function quotesFromUnderdogHr(body, { now = Date.now(), omitAfterMs = UNDERDOG_BOARD_OMIT_MS } = {}) {
  if (!body) return [];
  const games = indexById(body.games);
  const appearances = indexById(body.appearances);
  const teams = indexById(body.teams);
  const out = [];
  for (const line of valuesOf(body.over_under_lines)) {
    const stat = line && line.over_under && line.over_under.appearance_stat;
    if (!stat || String(stat.stat || '') !== 'ml_player_hr') continue;
    if (hrMarketFromLine(line.stat_value) !== 'hr') continue;
    const appearance = appearances.get(String(stat.appearance_id || ''));
    const game = games.get(String(appearance && appearance.match_id || ''));
    let higher = null;
    let lower = null;
    let player = '';
    let eventTicker = '';
    for (const opt of line.options || []) {
      if (!opt) continue;
      const choice = String(opt.choice || '').toLowerCase();
      const american = parseAmerican(opt.odds && opt.odds.prediction && opt.odds.prediction.american);
      if (!player) player = opt.selection_header || '';
      if (opt.event_ticker) eventTicker = opt.event_ticker;
      const at = opt.updated_at || line.updated_at || null;
      if (choice === 'higher' || choice === 'over' || choice === 'yes') higher = { american, updatedAt: at };
      else if (choice === 'lower' || choice === 'under' || choice === 'no') lower = { american, updatedAt: at };
    }
    if (!player || !higher || higher.american == null) continue;
    if (omitAfterMs != null && quoteIsOlderThan(higher.updatedAt, now, omitAfterMs)) continue;
    // event_ticker is the Kalshi game (KXMLBHR-26SEP261235NYMWSH); a synthetic
    // player + strike lets the HR ticker parser read clubs, date and ET clock.
    const parsed = eventTicker ? parseKalshiHrTicker(`${eventTicker}-PLAYER-1`) : null;
    if (!parsed) continue;
    const teamRow = teams.get(String(appearance && appearance.team_id || ''));
    const title = game && (game.full_team_names_title || game.title || '');
    const split = String(title || '').split(/\s+@\s+/);
    out.push({
      book: 'underdog_predict',
      market: 'hr',
      player,
      team: canonMlbAbbr(teamRow && (teamRow.abbr || teamRow.abbreviation)) || '',
      away: parsed.away,
      home: parsed.home,
      awayName: split.length === 2 ? split[0].trim() : '',
      homeName: split.length === 2 ? split[1].trim() : '',
      gameKey: parsed.gameKey,
      commence: (game && game.scheduled_at) || parsed.commence,
      yesAmerican: higher.american,
      noAmerican: lower && lower.american != null && !(omitAfterMs != null && quoteIsOlderThan(lower.updatedAt, now, omitAfterMs))
        ? lower.american
        : null,
      updatedAt: higher.updatedAt,
    });
  }
  return out;
}

async function loadUnderdogHrQuotes(deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const cfg = underdogConfig(deps && deps.env);
  const sleepFn = (deps && deps.sleepFn) || sleep;
  const res = await fetchJson(fetchFn, underdogHrLinesUrl(cfg), {
    sleepFn,
    attempts: 3,
    headers: {
      accept: 'application/json',
      'client-type': 'web',
      'client-version': cfg.clientVersion,
      'user-agent': 'aibetbuilder',
    },
  });
  if (!res.ok) return [];
  return quotesFromUnderdogHr(res.body, {
    now: (deps && deps.now) || Date.now(),
    omitAfterMs: deps && deps.omitAfterMs !== undefined ? deps.omitAfterMs : UNDERDOG_BOARD_OMIT_MS,
  });
}

// All three venues for today's games. Venue failures return [] for that
// venue only. `games` are the Odds API events (used for Polymarket slugs).
async function loadExchangeHrQuotes(games, deps) {
  const [kalshi, underdog, polymarket] = await Promise.all([
    loadKalshiHrQuotes(deps).catch(() => []),
    loadUnderdogHrQuotes(deps).catch(() => []),
    loadPolymarketHrQuotes(games, deps).catch(() => []),
  ]);
  return {
    quotes: [...kalshi, ...underdog, ...polymarket],
    counts: { kalshi: kalshi.length, underdog: underdog.length, polymarket: polymarket.length },
  };
}

module.exports = {
  KALSHI_HR_SERIES,
  UNDERDOG_HR_FILTER_ID,
  kalshiHrQuoteFromMarket,
  quotesFromKalshiHrMarkets,
  loadKalshiHrQuotes,
  quotesFromPolymarketHrEvent,
  polymarketHrSlugs,
  loadPolymarketHrQuotes,
  underdogHrLinesUrl,
  quotesFromUnderdogHr,
  loadUnderdogHrQuotes,
  loadExchangeHrQuotes,
};
