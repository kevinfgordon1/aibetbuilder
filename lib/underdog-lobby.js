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
// sticker (+252, and Ole Miss +129). Do not substitute it. Phone PE on
// the lines feed is Ole Miss +127.
// /v1/lobbies/scaffolds/matches returns sections only (no americans).
// Do not parse prices from a scaffold body. Do not use Betstamp book 196.
//
// The public over_under_lines catalog is not the game index. Checked
// 2026-09-21: v1 and v2 with include_prediction_markets=true&product=fantasy
// returned 17 NFL, 1 CFB (Clemson @ California, 183024), and 6 MLB.
//
// Phone index is the Moneyline section of the Team Picks scaffold, then
// GET /v1/lobbies/content/lines for that PickemStat. Phone PE only.
// Checked 2026-09-21: TEX @ TENN (match 187129) is Texas -213 / Tennessee
// +170 on both content/lines and match_grouped_lines.
//   CFB scaffold Moneyline e669e437-9dc7-48d8-9d93-2aabd5a13d10 → 226 games
//   MLB fallback 3f157ade-e2af-41ff-a5c6-9e0ca4f8c018 → 38 markets,
//       16 unique matchup titles (series games share a title)
//   NFL fallback 0251dd94-773d-47ec-878d-8a7349b8b967 → 17 games,
//       Giants +245 / Rams -313
// The scaffold repeats the CFB Moneyline id for every sport_id. That id
// returns an empty body for NFL and MLB, so those sports use the fallbacks.
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
const INDEX_SPORTS = new Set(['NFL', 'CFB', 'MLB']);
const SPORT_BY_UNDERDOG_ID = { NFL: 'NFL', CFB: 'NCAAF', MLB: 'MLB' };
// Team Picks market group. Its Moneyline section is the bulk index.
const TEAM_PICKS_MARKET_GROUP = 'b913095d-468c-4a5f-8a5a-9e48a26575bf';
// Used when the scaffold Moneyline section is missing or its lines body
// has no prediction games. CFB's id is also what the scaffold returns.
// MLB is the phone-PE lines feed (the shared CFB id is empty for MLB).
// NFL is appearance_stat.pickem_stat_id on match 178911; the scaffold
// echoes the CFB id, which is empty for NFL.
const MONEYLINE_FILTER_IDS = {
  NFL: '0251dd94-773d-47ec-878d-8a7349b8b967',
  CFB: 'e669e437-9dc7-48d8-9d93-2aabd5a13d10',
  MLB: '3f157ade-e2af-41ff-a5c6-9e0ca4f8c018',
};

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

function asRecord(value) {
  if (!value || typeof value !== 'object') return {};
  if (!Array.isArray(value)) return value;
  const out = {};
  for (const item of value) {
    if (item && item.id != null) out[item.id] = item;
  }
  return out;
}

function recordGet(record, id) {
  if (id == null) return null;
  return record[id] || record[String(id)] || null;
}

// One content/lines body is a single PickemStat (moneyline, or spread, or
// total). Group odds.prediction quotes onto the match the appearance points at.
function gamesFromContentLines(body, fallbackSportId) {
  const games = asRecord(body && body.games);
  const appearances = asRecord(body && body.appearances);
  const lines = asRecord(body && body.over_under_lines);
  const byMatch = new Map();
  for (const line of Object.values(lines)) {
    const stat = line && line.over_under && line.over_under.appearance_stat;
    const appearance = recordGet(appearances, stat && stat.appearance_id);
    const matchId = appearance && appearance.match_id;
    const game = recordGet(games, matchId);
    if (!game || game.id == null) continue;
    const sportId = String(game.sport_id || fallbackSportId || '').toUpperCase();
    if (!INDEX_SPORTS.has(sportId)) continue;
    const sport = SPORT_BY_UNDERDOG_ID[sportId];
    if (!sport) continue;
    const status = String(game.status || '').toLowerCase();
    if (status === 'closed' || status === 'final' || status === 'complete') continue;
    const teams = splitMatchup(game.full_team_names_title || game.title);
    if (!teams) continue;
    const parsed = linesFromContent({ over_under_lines: { line } });
    if (!parsed.length) continue;
    const key = String(game.id);
    let row = byMatch.get(key);
    if (!row) {
      row = {
        matchId: game.id,
        sport,
        away: teams.away,
        home: teams.home,
        scheduledAt: game.scheduled_at || null,
        lines: [],
      };
      byMatch.set(key, row);
    }
    for (const quote of parsed) row.lines.push(quote);
  }
  return [...byMatch.values()];
}

function mergeGames(lists) {
  const byId = new Map();
  for (const game of lists.flat()) {
    if (!game) continue;
    const key = String(game.matchId);
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, { ...game, lines: [...(game.lines || [])] });
      continue;
    }
    for (const line of game.lines || []) {
      const id = `${line.market}|${line.name}|${line.point ?? ''}|${line.choice ?? ''}|${line.american}`;
      const exists = prev.lines.some((item) => `${item.market}|${item.name}|${item.point ?? ''}|${item.choice ?? ''}|${item.american}` === id);
      if (!exists) prev.lines.push(line);
    }
  }
  return [...byId.values()].filter((game) => game.lines.length);
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

function sportScaffoldUrl(cfg, sportId) {
  const params = new URLSearchParams({
    filter_id: TEAM_PICKS_MARKET_GROUP,
    filter_type: 'MarketGroup',
    include_prediction_markets: 'true',
    market_view: 'compact',
    product: cfg.product,
    product_experience_id: cfg.productExperienceId,
    sport_id: String(sportId),
    state_config_id: cfg.stateConfigId,
  });
  return `${cfg.base}/v1/lobbies/scaffolds/sports?${params}`;
}

function contentLinesUrl(cfg, sportId, filterId) {
  const params = new URLSearchParams({
    filter_id: String(filterId),
    filter_type: 'PickemStat',
    include_live: 'true',
    product: cfg.product,
    product_experience_id: cfg.productExperienceId,
    show_mass_option_markets: 'false',
    sport_id: String(sportId),
    state_config_id: cfg.stateConfigId,
  });
  return `${cfg.base}/v1/lobbies/content/lines?${params}`;
}

function filterIdFromSection(section) {
  const source = section && section.data_source;
  const url = source && (source.url || source.path) || '';
  const id = /filter_id=([0-9a-f-]{36})/i.exec(url);
  const type = /filter_type=([^&]+)/i.exec(url);
  if (!id) return null;
  if (type && !/^PickemStat$/i.test(decodeURIComponent(type[1]))) return null;
  return id[1];
}

// Moneyline section only. Spread and total pills are a different feed.
function moneylineFilterFromScaffold(body) {
  for (const section of (body && body.sections) || []) {
    if (!section || section.content_type !== 'lines') continue;
    if (!/^moneyline$/i.test(String(section.title || '').trim())) continue;
    const id = filterIdFromSection(section);
    if (id) return id;
  }
  return null;
}

function moneylineGames(body, sportId) {
  return gamesFromContentLines(body, sportId).map((game) => ({
    ...game,
    lines: (game.lines || []).filter((line) => line && line.market === 'h2h'),
  })).filter((game) => game.lines.length);
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

async function fetchMoneyline(fetchFn, cfg, sportId, filterId) {
  const res = await fetchJson(fetchFn, contentLinesUrl(cfg, sportId, filterId), requestHeaders(cfg));
  const games = res.ok && res.body ? moneylineGames(res.body, sportId) : [];
  return { res, games };
}

async function fetchIndexedLines(fetchFn, cfg, sportId) {
  const scaffold = await fetchJson(fetchFn, sportScaffoldUrl(cfg, sportId), requestHeaders(cfg));
  const discovered = moneylineFilterFromScaffold(scaffold.body);
  const fallback = MONEYLINE_FILTER_IDS[sportId] || null;
  let saw404 = 0;
  let attempts = 0;
  const take = async (filterId) => {
    if (!filterId) return [];
    attempts += 1;
    const result = await fetchMoneyline(fetchFn, cfg, sportId, filterId);
    if (result.res.status === 404) saw404 += 1;
    return result.games;
  };
  let games = await take(discovered);
  if (!games.length && fallback && fallback !== discovered) games = await take(fallback);
  return { games, saw404, attempts };
}

async function fetchUnderdogPhone(deps) {
  const cfg = readConfig(envOf(deps));
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const now = (deps && deps.now) || Date.now();
  const cache = (deps && deps.cache) || defaultCache;
  const cacheKey = `${cfg.base}|${cfg.product}|${cfg.stateConfigId}|${cfg.productExperienceId}|lines`;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { ...hit.body, cacheStatus: 'HIT' };
  }

  const sports = [...INDEX_SPORTS];
  let attempts = 0;
  let rejected = 0;
  const fetched = await mapPool(sports, sports.length, async (sportId) => {
    const result = await fetchIndexedLines(fetchFn, cfg, sportId);
    attempts += result.attempts;
    rejected += result.saw404;
    return result.games;
  });
  const games = mergeGames(fetched);
  const configRejected = attempts > 0 && rejected === attempts;
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
  MONEYLINE_FILTER_IDS,
  INDEX_SPORTS,
  SPORT_BY_UNDERDOG_ID,
  TEAM_PICKS_MARKET_GROUP,
  contentLinesUrl,
  fetchUnderdogPhone,
  gamesFromContentLines,
  indexGames,
  linesFromContent,
  matchGroupedLinesUrl,
  moneylineFilterFromScaffold,
  readConfig,
  resetUnderdogPhoneCache,
  sportScaffoldUrl,
};
