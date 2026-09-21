'use strict';

// Server fetch for Underdog phone prices (odds.prediction).
//
// Verified 2026-09-21, match 178911, no user session:
//   GET /v1/lobbies/content/match_grouped_lines
//       ?include_live=true&match_id=178911&match_type=Game&product=fantasy
//       &product_experience_id=018e1234-5678-9abc-def0-123456789009
//       &show_more_picks_cta=false
//       &state_config_id=f8996742-f10c-4d32-955a-dcbcaa5dc5c0
//       &two_box_enabled_surface=false
//   headers: accept, client-type: web, client-version: 20260918170103
//   → 200, Giants odds.prediction +245 / Rams -313.
//
// product_experience_id b34dfd93-d0e8-4da3-8bf4-45c15c548dec returns the
// sticker +252. Do not substitute it.
// /v1/lobbies/scaffolds/matches returns sections only (no americans).
// Do not parse prices from a scaffold body. Do not use Betstamp book 196.
//
// The public /v1/over_under_lines catalog is not the game index. Checked
// 2026-09-21 with include_prediction_markets=true&product=fantasy: 17 NFL,
// 1 CFB (Clemson @ California, match 183024), 5 MLB. sport_id=CFB on that
// URL and on /v2/over_under_lines still returned only 183024. sport_id=NCAAF
// returned an empty body. match_offset does not page.
//
// The phone lobby does. GET /v1/lobbies/content/match_grouped_lines with
// the phone product_experience_id, state_config_id, market_categories[]=core,
// and sport_id returned odds.prediction (fantasy null) for every game:
//   sport_id=CFB  match_limit=400 and 800 → 226 games, 2026-09-24..10-04
//   sport_id=MLB  match_limit=200 → 38 games (the public 5 are included)
//   sport_id=NFL  match_limit=100 → 17 games, Giants odds.prediction +245
// A bad state_config_id is 404. Do not fall back to the sticker experience
// id or to Betstamp book 196.
//
// Parser lives in lib/underdog-prediction-quote.js (CJS). Do not require
// src/underdogPredictionQuote.js — that file is ESM, and require() of it
// crashes the Vercel function before the handler try/catch.

const { predictionQuotesFromPayload } = require('./underdog-prediction-quote');

const DEFAULT_BASE = 'https://api.underdogfantasy.com';
const DEFAULT_CLIENT_VERSION = '20260918170103';
const DEFAULT_PRODUCT = 'fantasy';
// Phone experience. The other id (b34dfd93-d0e8-4da3-8bf4-45c15c548dec)
// returns the sticker (+252), not the phone (+245).
const DEFAULT_STATE_CONFIG_ID = 'f8996742-f10c-4d32-955a-dcbcaa5dc5c0';
const DEFAULT_PRODUCT_EXPERIENCE_ID = '018e1234-5678-9abc-def0-123456789009';
const CACHE_TTL_MS = 45 * 1000;
// Underdog sport_id values. CFB is college football; the app sport is NCAAF.
// sport_id=NCAAF is not a catalog key (empty /v2 body, sport scaffold falls
// back to NFL).
const INDEX_SPORTS = new Set(['NFL', 'CFB', 'MLB']);
const SPORT_BY_UNDERDOG_ID = { NFL: 'NFL', CFB: 'NCAAF', MLB: 'MLB' };
// 400 and 800 both returned the full 226-game CFB slate. A response that
// fills this limit is retried once at the ceiling; match_offset is ignored.
const MATCH_LIMIT = 500;
const MATCH_LIMIT_CEILING = 1000;

const defaultCache = new Map();

function envOf(deps) {
  return (deps && deps.env) || process.env || {};
}

function readConfig(env) {
  const e = env || {};
  return {
    stateConfigId: String(e.UNDERDOG_STATE_CONFIG_ID || DEFAULT_STATE_CONFIG_ID).trim() || DEFAULT_STATE_CONFIG_ID,
    productExperienceId: String(e.UNDERDOG_PRODUCT_EXPERIENCE_ID || DEFAULT_PRODUCT_EXPERIENCE_ID).trim() || DEFAULT_PRODUCT_EXPERIENCE_ID,
    clientVersion: String(e.UNDERDOG_CLIENT_VERSION || DEFAULT_CLIENT_VERSION).trim() || DEFAULT_CLIENT_VERSION,
    product: String(e.UNDERDOG_PRODUCT || DEFAULT_PRODUCT).trim() || DEFAULT_PRODUCT,
    base: String(e.UNDERDOG_API_BASE || DEFAULT_BASE).replace(/\/$/, ''),
  };
}

function requestHeaders(cfg) {
  return {
    accept: 'application/json',
    'client-type': 'web',
    'client-version': cfg.clientVersion,
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

function listedGames(body) {
  const games = body && body.games;
  if (!games) return [];
  if (Array.isArray(games)) return games;
  if (typeof games === 'object') return Object.values(games);
  return [];
}

function indexGames(body, fallbackSportId) {
  const out = [];
  for (const game of listedGames(body)) {
    if (!game || game.id == null) continue;
    const sportId = String(game.sport_id || fallbackSportId || '').toUpperCase();
    if (!INDEX_SPORTS.has(sportId)) continue;
    const sport = SPORT_BY_UNDERDOG_ID[sportId];
    if (!sport) continue;
    const status = String(game.status || '').toLowerCase();
    if (status === 'closed' || status === 'final' || status === 'complete') continue;
    const teams = splitMatchup(game.full_team_names_title || game.title);
    if (!teams) continue;
    out.push({
      matchId: game.id,
      sport,
      away: teams.away,
      home: teams.home,
      scheduledAt: game.scheduled_at || null,
    });
  }
  return out;
}

function lineRecord(body) {
  const raw = body && body.over_under_lines;
  if (!raw || typeof raw !== 'object') return {};
  if (Array.isArray(raw)) {
    const out = {};
    for (const line of raw) {
      if (line && line.id != null) out[line.id] = line;
    }
    return out;
  }
  return raw;
}

// Sport-lobby bodies list every game in `games` and point each match_group
// at that game's over_under_line ids. Lines are odds.prediction only when
// the phone experience id was used; linesFromContent drops anything else.
function gamesWithLines(body, fallbackSportId) {
  const indexed = indexGames(body, fallbackSportId);
  if (!indexed.length) return [];
  const byId = new Map(indexed.map((game) => [String(game.matchId), game]));
  const lines = lineRecord(body);
  const groups = body && Array.isArray(body.match_groups) ? body.match_groups : [];
  const used = new Set();
  const out = [];
  const pushGame = (game, payload) => {
    const parsed = linesFromContent(payload);
    if (!parsed.length) return;
    out.push({ ...game, lines: parsed });
  };
  for (const group of groups) {
    if (!group || group.id == null) continue;
    const game = byId.get(String(group.id));
    if (!game) continue;
    used.add(String(group.id));
    const ids = Array.isArray(group.over_under_line_ids) ? group.over_under_line_ids : [];
    const subset = {};
    for (const id of ids) {
      if (lines[id]) subset[id] = lines[id];
    }
    pushGame(game, { over_under_lines: subset });
  }
  if (indexed.length === 1 && !used.has(String(indexed[0].matchId))) {
    pushGame(indexed[0], body);
  }
  return out;
}

function matchGroupedLinesUrl(cfg, matchId) {
  const params = new URLSearchParams({
    include_live: 'true',
    match_id: String(matchId),
    match_type: 'Game',
    product: cfg.product,
    product_experience_id: cfg.productExperienceId,
    show_more_picks_cta: 'false',
    state_config_id: cfg.stateConfigId,
    two_box_enabled_surface: 'false',
  });
  return `${cfg.base}/v1/lobbies/content/match_grouped_lines?${params}`;
}

function sportLobbyUrl(cfg, sportId, matchLimit = MATCH_LIMIT) {
  const params = new URLSearchParams({
    include_live: 'true',
    match_limit: String(matchLimit),
    product: cfg.product,
    product_experience_id: cfg.productExperienceId,
    show_more_picks_cta: 'false',
    sport_id: String(sportId),
    state_config_id: cfg.stateConfigId,
    two_box_enabled_surface: 'false',
  });
  params.append('market_categories[]', 'core');
  return `${cfg.base}/v1/lobbies/content/match_grouped_lines?${params}`;
}

function widerMatchLimit(count, limit) {
  if (count >= limit && limit < MATCH_LIMIT_CEILING) return MATCH_LIMIT_CEILING;
  return null;
}

function positiveLimit(raw, fallback) {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return fallback;
}

async function fetchSportLobby(fetchFn, cfg, sportId, firstLimit) {
  const first = await fetchJson(fetchFn, sportLobbyUrl(cfg, sportId, firstLimit), requestHeaders(cfg));
  const wider = widerMatchLimit(listedGames(first.body).length, firstLimit);
  if (!first.ok || !first.body || wider == null) return first;
  const next = await fetchJson(fetchFn, sportLobbyUrl(cfg, sportId, wider), requestHeaders(cfg));
  if (!next.ok || !next.body) return first;
  if (listedGames(next.body).length < listedGames(first.body).length) return first;
  return next;
}

function linesFromContent(body) {
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
  const firstLimit = positiveLimit(deps && deps.matchLimit, MATCH_LIMIT);
  const cacheKey = `${cfg.base}|${cfg.product}|${cfg.stateConfigId}|${cfg.productExperienceId}|${firstLimit}`;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { ...hit.body, cacheStatus: 'HIT' };
  }

  const sports = [...INDEX_SPORTS];
  let rejected = 0;
  const fetched = await mapPool(sports, sports.length, async (sportId) => {
    const res = await fetchSportLobby(fetchFn, cfg, sportId, firstLimit);
    if (res.status === 404) {
      rejected += 1;
      return [];
    }
    if (!res.ok || !res.body) return [];
    return gamesWithLines(res.body, sportId);
  });
  const games = fetched.flat();
  const configRejected = sports.length > 0 && rejected === sports.length;
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
  DEFAULT_PRODUCT_EXPERIENCE_ID,
  DEFAULT_STATE_CONFIG_ID,
  INDEX_SPORTS,
  MATCH_LIMIT,
  MATCH_LIMIT_CEILING,
  SPORT_BY_UNDERDOG_ID,
  fetchUnderdogPhone,
  gamesWithLines,
  indexGames,
  linesFromContent,
  matchGroupedLinesUrl,
  readConfig,
  resetUnderdogPhoneCache,
  sportLobbyUrl,
  widerMatchLimit,
};
