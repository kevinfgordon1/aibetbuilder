'use strict';

// Server fetch for Underdog phone prices (odds.prediction).
//
// Game moneylines are not on the anonymous /v1/over_under_lines catalog
// (that feed fills futures and leaves game ML prediction null). The phone
// quote is the lobby scaffold captured for match 178911:
//   GET /v1/lobbies/scaffolds/matches
//       ?include_prediction_markets=true&market_view=compact
//       &match_id=…&match_type=Game&product=fantasy
//       &state_config_id=…
// A real state_config_id is looked up without a user session (a fake UUID
// 404s, it does not 401). Minting that id via /v1/geo_comply/license still
// returns upgrade_required, so the id is stored in the environment. Do not
// invent a phone price from Betstamp book 196.
//
// Client-Version YYYYMMDDHHMM (default 202609211200) passes the scaffold
// version gate. Geo license still rejects that shape, so this process
// cannot refresh state_config_id by itself.

const { predictionQuotesFromPayload } = require('../src/underdogPredictionQuote.js');

const DEFAULT_BASE = 'https://api.underdogfantasy.com';
const DEFAULT_CLIENT_VERSION = '202609211200';
const DEFAULT_PRODUCT = 'fantasy';
const CACHE_TTL_MS = 45 * 1000;
const INDEX_SPORTS = new Set(['NFL', 'CFB']);

const defaultCache = new Map();

function envOf(deps) {
  return (deps && deps.env) || process.env || {};
}

function readConfig(env) {
  const e = env || {};
  return {
    stateConfigId: String(e.UNDERDOG_STATE_CONFIG_ID || '').trim(),
    productExperienceId: String(e.UNDERDOG_PRODUCT_EXPERIENCE_ID || '').trim(),
    clientVersion: String(e.UNDERDOG_CLIENT_VERSION || DEFAULT_CLIENT_VERSION).trim() || DEFAULT_CLIENT_VERSION,
    product: String(e.UNDERDOG_PRODUCT || DEFAULT_PRODUCT).trim() || DEFAULT_PRODUCT,
    base: String(e.UNDERDOG_API_BASE || DEFAULT_BASE).replace(/\/$/, ''),
  };
}

function requestHeaders(cfg) {
  return {
    Accept: 'application/json',
    'Client-Version': cfg.clientVersion,
    'Client-Type': 'web',
    'User-Agent': 'aibetbuilder/underdog-predict',
  };
}

async function fetchJson(fetchFn, url, headers) {
  const res = await fetchFn(url, { headers });
  const text = typeof res.text === 'function' ? await res.text() : '';
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch (_) { body = null; }
  }
  const status = res && res.status ? res.status : 0;
  return { status, ok: !!(res && res.ok), body };
}

function splitMatchup(title) {
  const parts = String(title || '').split(/\s+@\s+/);
  if (parts.length !== 2) return null;
  const away = parts[0].trim();
  const home = parts[1].trim();
  if (!away || !home) return null;
  return { away, home };
}

function indexGames(body) {
  const games = body && Array.isArray(body.games) ? body.games : [];
  const out = [];
  for (const game of games) {
    if (!game || game.id == null) continue;
    const sportId = String(game.sport_id || '').toUpperCase();
    if (!INDEX_SPORTS.has(sportId)) continue;
    const status = String(game.status || '').toLowerCase();
    if (status === 'closed' || status === 'final' || status === 'complete') continue;
    const teams = splitMatchup(game.full_team_names_title || game.title);
    if (!teams) continue;
    out.push({
      matchId: game.id,
      sport: sportId === 'CFB' ? 'NCAAF' : sportId,
      away: teams.away,
      home: teams.home,
      scheduledAt: game.scheduled_at || null,
    });
  }
  return out;
}

function scaffoldUrl(cfg, matchId) {
  const params = new URLSearchParams({
    include_prediction_markets: 'true',
    market_view: 'compact',
    match_id: String(matchId),
    match_type: 'Game',
    product: cfg.product,
    state_config_id: cfg.stateConfigId,
  });
  if (cfg.productExperienceId) params.set('product_experience_id', cfg.productExperienceId);
  return `${cfg.base}/v1/lobbies/scaffolds/matches?${params}`;
}

function linesFromScaffold(body) {
  const quotes = predictionQuotesFromPayload(body);
  const lines = [];
  for (const quote of quotes) {
    if (!quote || quote.american == null || quote.market === 'future' || !quote.market) continue;
    lines.push({
      market: quote.market,
      name: quote.name,
      american: quote.american,
      probability: quote.probability,
      point: quote.point,
      choice: quote.choice,
      updatedAt: quote.updatedAt || null,
    });
  }
  return lines;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchUnderdogPhone(deps) {
  const cfg = readConfig(envOf(deps));
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const now = (deps && deps.now) || Date.now();
  const cache = (deps && deps.cache) || defaultCache;
  const cacheKey = `${cfg.base}|${cfg.product}|${cfg.stateConfigId}|${cfg.productExperienceId}`;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { ...hit.body, cacheStatus: 'HIT' };
  }

  if (!cfg.stateConfigId) {
    const body = {
      ok: true,
      missingConfig: true,
      configRejected: false,
      games: [],
      error: 'UNDERDOG_STATE_CONFIG_ID is not set',
    };
    return { ...body, cacheStatus: 'MISS' };
  }

  const indexUrl = `${cfg.base}/v1/over_under_lines?include_prediction_markets=true&product=fantasy`;
  const index = await fetchJson(fetchFn, indexUrl, requestHeaders(cfg));
  const catalog = indexGames(index.body);
  let rejected = 0;
  const fetched = catalog.length
    ? await mapPool(catalog, 4, async (game) => {
      const res = await fetchJson(fetchFn, scaffoldUrl(cfg, game.matchId), requestHeaders(cfg));
      if (res.status === 404) {
        rejected += 1;
        return null;
      }
      if (!res.ok || !res.body) return null;
      const lines = linesFromScaffold(res.body);
      if (!lines.length) return null;
      return { ...game, lines };
    })
    : [];
  const games = fetched.filter(Boolean);
  const configRejected = catalog.length > 0 && rejected === catalog.length;
  const body = {
    ok: !configRejected,
    missingConfig: false,
    configRejected,
    games,
    error: configRejected ? 'UNDERDOG_STATE_CONFIG_ID was not found' : null,
  };
  cache.set(cacheKey, { at: now, body });
  return { ...body, cacheStatus: 'MISS' };
}

function resetUnderdogPhoneCache(cache = defaultCache) {
  cache.clear();
}

module.exports = {
  CACHE_TTL_MS,
  DEFAULT_CLIENT_VERSION,
  fetchUnderdogPhone,
  indexGames,
  linesFromScaffold,
  readConfig,
  resetUnderdogPhoneCache,
  scaffoldUrl,
};
