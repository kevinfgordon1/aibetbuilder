'use strict';

// First-party NFL player touchdown quotes for the New Odds Board.
// Kalshi public REST, Polymarket US gateway event payloads, Underdog phone
// lines. No sportsbook. Poll with backoff, and keep a short in-process cache
// so a 45s board refresh does not re-download the multi-megabyte event bodies.

const {
  TAKER_FEE_RATE,
  parseKalshiTdTicker,
  playerNameFromKalshiTitle,
  pairKeyFromSlug,
  slugFromGameKey,
  asUnitProb,
  parseAmerican,
  boardYesAmerican,
  noAskAmericanFromYesBid,
  thresholdFromLine,
  teamDisplayName,
  boardFromQuotes,
  quoteIsOlderThan,
  ENABLED_TD_MARKETS,
  selectPlayerTdQuotes,
} = require('./player-td');
const { UNDERDOG_BOARD_OMIT_MS } = require('./underdog-freshness');

const KALSHI_REST = 'https://api.elections.kalshi.com/trade-api/v2';
const POLY_GATEWAY = 'https://gateway.polymarket.us';
const UNDERDOG_BASE = 'https://api.underdogfantasy.com';
const UNDERDOG_CLIENT_VERSION = '20260918170103';
const UNDERDOG_PRODUCT = 'fantasy';
const UNDERDOG_STATE_CONFIG_ID = 'f8996742-f10c-4d32-955a-dcbcaa5dc5c0';
const UNDERDOG_PRODUCT_EXPERIENCE_ID = '018e1234-5678-9abc-def0-123456789009';
const UNDERDOG_TD_FILTER_ID = '8ccbe039-9d73-4513-ac40-200d2eb5f09e';

// First TD is its own series. Anytime and 2+ share KXNFLTD (ticker suffix).
const KALSHI_SERIES_BY_MARKET = Object.freeze({
  anytime: ['KXNFLTD'],
  two: ['KXNFLTD'],
  first: ['KXNFLFIRSTTD'],
});

function kalshiSeriesForMarkets(markets) {
  const out = [];
  for (const market of markets || []) {
    for (const series of KALSHI_SERIES_BY_MARKET[market] || []) {
      if (!out.includes(series)) out.push(series);
    }
  }
  return out;
}

const KALSHI_SERIES = Object.freeze(kalshiSeriesForMarkets(ENABLED_TD_MARKETS));
const BOARD_CACHE_MS = 45 * 1000;
const MAX_POLY_GAMES = 16;
const POLY_CONCURRENCY = 2;

const boardCache = { at: 0, body: null };

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function valuesOf(node) {
  if (!node) return [];
  if (Array.isArray(node)) return node;
  if (typeof node === 'object') return Object.values(node);
  return [];
}

async function readBody(res) {
  if (!res) return null;
  if (typeof res.json === 'function' && res._jsonUsed !== true) {
    try {
      const body = await res.json();
      return body;
    } catch (_) { /* text fallback */ }
  }
  const text = typeof res.text === 'function' ? await res.text() : '';
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

async function fetchJson(fetchFn, url, { headers, attempts = 4, sleepFn = sleep } = {}) {
  let wait = 400;
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    let res;
    try {
      res = await fetchFn(url, { headers: headers || { accept: 'application/json' } });
    } catch (err) {
      last = err;
      if (i === attempts - 1) break;
      await sleepFn(wait);
      wait *= 2;
      continue;
    }
    const status = res && res.status ? res.status : 0;
    if (status === 429 || status === 502 || status === 503 || status === 504) {
      last = new Error(`HTTP ${status}`);
      if (i === attempts - 1) break;
      await sleepFn(wait);
      wait *= 2;
      continue;
    }
    const body = await readBody(res);
    return { ok: status >= 200 && status < 300, status, body };
  }
  return { ok: false, status: 0, body: null, error: last };
}

function kalshiQuoteFromMarket(market, nowMs) {
  if (!market) return null;
  const parsed = parseKalshiTdTicker(market.ticker || market.event_ticker);
  if (!parsed || parsed.market === 'three') return null;
  const yesAsk = asUnitProb(market.yes_ask_dollars != null ? market.yes_ask_dollars : market.yes_ask);
  const yesBid = asUnitProb(market.yes_bid_dollars != null ? market.yes_bid_dollars : market.yes_bid);
  const player = playerNameFromKalshiTitle(market.title, market.yes_sub_title);
  if (!player || yesAsk == null) return null;
  const fee = TAKER_FEE_RATE.kalshi;
  return {
    book: 'kalshi',
    market: parsed.market,
    player,
    team: '',
    away: parsed.away,
    home: parsed.home,
    gameKey: parsed.gameKey,
    commence: market.occurrence_datetime || null,
    yesAmerican: boardYesAmerican(yesAsk, fee),
    noAmerican: yesBid == null ? null : noAskAmericanFromYesBid(yesBid, fee),
    updatedAt: market.updated_time || new Date(nowMs || Date.now()).toISOString(),
    ticker: market.ticker,
  };
}

function quotesFromKalshiMarkets(body) {
  const markets = body && Array.isArray(body.markets) ? body.markets : [];
  const out = [];
  for (const market of markets) {
    const quote = kalshiQuoteFromMarket(market);
    if (quote && quote.yesAmerican != null) out.push(quote);
  }
  return out;
}

async function loadKalshiTdQuotes(deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const base = (deps && deps.kalshiBase) || KALSHI_REST;
  const sleepFn = (deps && deps.sleepFn) || sleep;
  const out = [];
  for (const series of KALSHI_SERIES) {
    let cursor = '';
    for (let page = 0; page < 6; page += 1) {
      const url = `${base}/markets?series_ticker=${encodeURIComponent(series)}&status=open&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await fetchJson(fetchFn, url, { sleepFn, attempts: deps && deps.attempts ? deps.attempts : 4 });
      if (!res.ok || !res.body) break;
      out.push(...quotesFromKalshiMarkets(res.body));
      cursor = String(res.body.cursor || '');
      if (!cursor) break;
    }
  }
  return out;
}

function polyProb(quote) {
  if (!quote) return null;
  if (typeof quote === 'number' || typeof quote === 'string') return asUnitProb(quote);
  return asUnitProb(quote.value != null ? quote.value : quote.price);
}

function quotesFromPolymarketEvent(body) {
  const event = body && body.event ? body.event : body;
  if (!event) return [];
  const slug = pairKeyFromSlug(event.slug || event.ticker);
  if (!slug) return [];
  const teamById = new Map();
  let awayName = teamDisplayName(slug.away);
  let homeName = teamDisplayName(slug.home);
  for (const team of event.teams || []) {
    if (!team) continue;
    const abbr = String(team.displayAbbreviation || team.abbreviation || '').toUpperCase();
    if (team.id != null) teamById.set(String(team.id), abbr);
    const name = team.name || '';
    if (abbr && abbr.toUpperCase() === slug.away && name) awayName = name;
    if (abbr && abbr.toUpperCase() === slug.home && name) homeName = name;
  }
  const out = [];
  const fee = TAKER_FEE_RATE.polymarket;
  for (const market of event.markets || []) {
    const kind = market && (market.sportsMarketType || market.marketType);
    let tdMarket = null;
    if (kind === 'football_player_touchdowns') {
      const meta = market.metadata || {};
      tdMarket = thresholdFromLine(market.line, meta.lineLabel);
    } else if (kind === 'football_player_first_touchdown') {
      tdMarket = 'first';
    } else {
      continue;
    }
    if (!tdMarket || tdMarket === 'three') continue;
    const meta = market.metadata || {};
    const player = meta.playerName || '';
    if (!player) continue;
    const yesAsk = polyProb(market.bestAskQuote);
    const yesBid = polyProb(market.bestBidQuote);
    if (yesAsk == null) continue;
    const team = teamById.get(String(meta.teamId == null ? '' : meta.teamId)) || '';
    out.push({
      book: 'polymarket',
      market: tdMarket,
      player,
      team,
      away: slug.away,
      home: slug.home,
      awayName,
      homeName,
      gameKey: slug.gameKey,
      commence: event.startTime || event.startDate || market.gameStartTime || null,
      yesAmerican: boardYesAmerican(yesAsk, fee),
      noAmerican: yesBid == null ? null : noAskAmericanFromYesBid(yesBid, fee),
      updatedAt: market.updatedAt || event.updatedAt || null,
    });
  }
  return out;
}

function underdogConfig(env) {
  const e = env || {};
  return {
    base: String(e.UNDERDOG_API_BASE || UNDERDOG_BASE).replace(/\/$/, ''),
    clientVersion: String(e.UNDERDOG_CLIENT_VERSION || UNDERDOG_CLIENT_VERSION).trim() || UNDERDOG_CLIENT_VERSION,
    product: String(e.UNDERDOG_PRODUCT || UNDERDOG_PRODUCT).trim() || UNDERDOG_PRODUCT,
    stateConfigId: String(e.UNDERDOG_STATE_CONFIG_ID || UNDERDOG_STATE_CONFIG_ID).trim() || UNDERDOG_STATE_CONFIG_ID,
    productExperienceId: String(e.UNDERDOG_PRODUCT_EXPERIENCE_ID || UNDERDOG_PRODUCT_EXPERIENCE_ID).trim() || UNDERDOG_PRODUCT_EXPERIENCE_ID,
    filterId: String(e.UNDERDOG_TD_FILTER_ID || UNDERDOG_TD_FILTER_ID).trim() || UNDERDOG_TD_FILTER_ID,
  };
}

function underdogLinesUrl(cfg) {
  const params = new URLSearchParams({
    filter_id: cfg.filterId,
    filter_type: 'PickemStat',
    include_live: 'true',
    product: cfg.product,
    product_experience_id: cfg.productExperienceId,
    show_mass_option_markets: 'false',
    sport_id: 'NFL',
    state_config_id: cfg.stateConfigId,
  });
  return `${cfg.base}/v1/lobbies/content/lines?${params}`;
}

function indexById(node) {
  const map = new Map();
  for (const item of valuesOf(node)) {
    if (item && item.id != null) map.set(String(item.id), item);
  }
  return map;
}

function quotesFromUnderdogTd(body, { now = Date.now(), omitAfterMs = UNDERDOG_BOARD_OMIT_MS } = {}) {
  if (!body) return [];
  const games = indexById(body.games);
  const appearances = indexById(body.appearances);
  const teams = indexById(body.teams);
  const out = [];
  for (const line of valuesOf(body.over_under_lines)) {
    const overUnder = line && line.over_under;
    const stat = overUnder && overUnder.appearance_stat;
    const display = `${(stat && stat.display_stat) || ''} ${(stat && stat.stat) || ''}`.toLowerCase();
    // Underdog has no separate anytime market. Rush + Rec TDs 0.5 is that price.
    if (!/rush\s*\+\s*rec/.test(display) && String(stat && stat.stat || '') !== 'rush_rec_tds') continue;
    const tdMarket = thresholdFromLine(line.stat_value, '');
    if (!tdMarket || tdMarket === 'three') continue;
    const appearance = appearances.get(String(stat && stat.appearance_id || ''));
    const game = games.get(String(appearance && appearance.match_id || ''));
    let higher = null;
    let lower = null;
    let player = '';
    let eventTicker = '';
    let updatedAt = line.updated_at || null;
    for (const opt of (line && line.options) || []) {
      if (!opt) continue;
      const choice = String(opt.choice || '').toLowerCase();
      const american = parseAmerican(opt.odds && opt.odds.prediction && opt.odds.prediction.american);
      if (!player) player = opt.selection_header || '';
      if (opt.event_ticker) eventTicker = opt.event_ticker;
      if (choice === 'higher' || choice === 'over' || choice === 'yes') {
        higher = { american, updatedAt: opt.updated_at || updatedAt };
      } else if (choice === 'lower' || choice === 'under' || choice === 'no') {
        lower = { american, updatedAt: opt.updated_at || updatedAt };
      }
    }
    if (!player || !higher || higher.american == null) continue;
    if (omitAfterMs != null && quoteIsOlderThan(higher.updatedAt, now, omitAfterMs)) continue;
    // event_ticker is the game (KXNFLTD-26SEP27NYJDET). A synthetic -1
    // suffix lets the game-token parser read the clubs and the date.
    const teamsParsed = eventTicker ? parseKalshiTdTicker(`${eventTicker}-PLAYER-1`) : null;
    if (!teamsParsed) continue;
    const title = game && (game.full_team_names_title || game.title || '');
    const split = String(title || '').split(/\s+@\s+/);
    const teamRow = teams.get(String(appearance && appearance.team_id || ''));
    const teamAbbr = teamRow && (teamRow.abbr || teamRow.abbreviation || '');
    out.push({
      book: 'underdog_predict',
      market: tdMarket,
      player,
      team: teamAbbr,
      away: teamsParsed.away,
      home: teamsParsed.home,
      awayName: split.length === 2 ? split[0].trim() : teamDisplayName(teamsParsed.away),
      homeName: split.length === 2 ? split[1].trim() : teamDisplayName(teamsParsed.home),
      gameKey: teamsParsed.gameKey,
      commence: (game && game.scheduled_at) || null,
      yesAmerican: higher.american,
      noAmerican: lower && lower.american != null && !(omitAfterMs != null && quoteIsOlderThan(lower.updatedAt, now, omitAfterMs))
        ? lower.american
        : null,
      updatedAt: higher.updatedAt,
    });
  }
  return out;
}

async function loadUnderdogTdQuotes(deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const cfg = underdogConfig(deps && deps.env);
  const sleepFn = (deps && deps.sleepFn) || sleep;
  const res = await fetchJson(fetchFn, underdogLinesUrl(cfg), {
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
  return quotesFromUnderdogTd(res.body, {
    now: (deps && deps.now) || Date.now(),
    omitAfterMs: deps && deps.omitAfterMs != null ? deps.omitAfterMs : UNDERDOG_BOARD_OMIT_MS,
  });
}

async function mapPool(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(list[index], index);
    }
  }
  const workers = [];
  const n = Math.max(1, Math.min(limit, list.length));
  for (let i = 0; i < n; i += 1) workers.push(worker());
  await Promise.all(workers);
  return out;
}

async function loadPolymarketTdQuotes(gameKeys, deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const base = (deps && deps.polymarketBase) || POLY_GATEWAY;
  const sleepFn = (deps && deps.sleepFn) || sleep;
  const maxGames = deps && deps.maxGames != null ? deps.maxGames : MAX_POLY_GAMES;
  const slugs = [];
  const seen = new Set();
  for (const key of gameKeys || []) {
    const slug = slugFromGameKey(key);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
    if (slugs.length >= maxGames) break;
  }
  const batches = await mapPool(slugs, POLY_CONCURRENCY, async (slug) => {
    const url = `${base}/v1/events/slug/${encodeURIComponent(slug)}`;
    const res = await fetchJson(fetchFn, url, { sleepFn, attempts: 2 });
    if (!res.ok || !res.body) return [];
    return quotesFromPolymarketEvent(res.body);
  });
  return batches.flat();
}

async function loadExchangeTdQuotes(deps) {
  const now = (deps && deps.now) || Date.now();
  const [kalshi, underdog] = await Promise.all([
    loadKalshiTdQuotes(deps).catch(() => []),
    loadUnderdogTdQuotes({ ...deps, now }).catch(() => []),
  ]);
  const near = selectPlayerTdQuotes([...kalshi, ...underdog], now);
  const keys = new Set();
  for (const quote of near) {
    if (quote && quote.gameKey) keys.add(quote.gameKey);
  }
  let polymarket = [];
  try {
    polymarket = await loadPolymarketTdQuotes([...keys], deps);
  } catch (_) {
    polymarket = [];
  }
  return selectPlayerTdQuotes(
    [...near, ...polymarket].filter((quote) => quote && quote.yesAmerican != null),
    now,
  );
}

async function loadPlayerTdBoard(deps) {
  const now = (deps && deps.now) || Date.now();
  const ttl = deps && deps.cacheMs != null ? deps.cacheMs : BOARD_CACHE_MS;
  const cache = (deps && deps.cache) || boardCache;
  if (cache.body && ttl > 0 && now - cache.at < ttl) {
    return { ...cache.body, cached: true };
  }
  const quotes = await loadExchangeTdQuotes({ ...deps, now });
  const body = {
    ok: true,
    league: 'NFL',
    fetchedAt: new Date(now).toISOString(),
    games: boardFromQuotes(quotes),
    quotes,
  };
  cache.at = now;
  cache.body = body;
  return { ...body, cached: false };
}

function resetPlayerTdBoardCache() {
  boardCache.at = 0;
  boardCache.body = null;
}

module.exports = {
  KALSHI_SERIES,
  kalshiSeriesForMarkets,
  UNDERDOG_TD_FILTER_ID,
  BOARD_CACHE_MS,
  underdogLinesUrl,
  underdogConfig,
  quotesFromKalshiMarkets,
  quotesFromPolymarketEvent,
  quotesFromUnderdogTd,
  loadKalshiTdQuotes,
  loadUnderdogTdQuotes,
  loadPolymarketTdQuotes,
  loadExchangeTdQuotes,
  loadPlayerTdBoard,
  resetPlayerTdBoardCache,
};
