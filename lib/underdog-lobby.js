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
// Phone index is the Team Picks scaffold, then GET /v1/lobbies/content/lines
// for the Moneyline, Spread, and Total Points / Total Runs PickemStats.
// Lines for one match merge onto the same game. A market with no
// odds.prediction quote is omitted. A side whose quote updated_at is older
// than 24 hours (UNDERDOG_BOARD_OMIT_MS) is omitted; a missing timestamp is
// kept. Promo ranking still drops offers older than 1 hour
// (UNDERDOG_STALE_MS) without removing them from this payload. Two-way
// moneylines whose implied probabilities sum outside 0.80–1.22 are omitted
// (Akron −527 / Central Michigan −715). After that, h2h sides with
// |american| >= 2000 are omitted (phone caps +3230 and −10000), and a
// moneyline with only one side left is omitted (Central Michigan +3230
// alone after Miami −1112 was board-omitted). Spreads and totals on that
// game stay. A normal −110 / −110 pair stays. Phone PE only.
// Checked 2026-09-21: TEX @ TENN (match 187129) is Texas -213 / Tennessee
// +170 on both content/lines and match_grouped_lines.
// The scaffold repeats the CFB PickemStat ids for every sport_id. Those
// ids are empty for NFL and MLB, so those sports use the fallbacks.
// Fallbacks are appearance_stat.pickem_stat_id on match_grouped_lines
// (NFL match 178911, MLB match 142331). CFB's ids are what the scaffold
// returns.
//
// Parser lives in lib/underdog-prediction-quote.js (CJS). Do not require
// src/underdogPredictionQuote.js — that file is ESM, and require() of it
// crashes the Vercel function before the handler try/catch.

const { predictionQuotesFromPayload } = require('./underdog-prediction-quote');
const { sanitizeUnderdogPhoneLines, UNDERDOG_BOARD_OMIT_MS } = require('./underdog-freshness');

const DEFAULT_BASE = 'https://api.underdogfantasy.com';
const DEFAULT_CLIENT_VERSION = '20260918170103';
const DEFAULT_PRODUCT = 'fantasy';
// Phone experience. The other id (b34dfd93-d0e8-4da3-8bf4-45c15c548dec)
// returns the sticker (+252), not the phone (+245).
const DEFAULT_STATE_CONFIG_ID = 'f8996742-f10c-4d32-955a-dcbcaa5dc5c0';
const DEFAULT_PRODUCT_EXPERIENCE_ID = '018e1234-5678-9abc-def0-123456789009';
const CACHE_TTL_MS = 45 * 1000;
// Phone responses advertise Cache-Control max-age=30. Faster than that
// restamps the same CDN body. Live games are in this payload (MLB status
// "scoring", e.g. TB @ NYY Bot 6th on 2026-09-22 with odds.prediction).
// ?live=1 uses this TTL. The default board/Promo path stays on 45s.
const UNDERDOG_LIVE_CACHE_MS = 30 * 1000;
// Underdog sport_id values. CFB is college football; the app sport is NCAAF.
const INDEX_SPORTS = new Set(['NFL', 'CFB', 'MLB']);
const SPORT_BY_UNDERDOG_ID = { NFL: 'NFL', CFB: 'NCAAF', MLB: 'MLB' };
// Team Picks market group. Moneyline, Spread, and Total sections are the index.
const TEAM_PICKS_MARKET_GROUP = 'b913095d-468c-4a5f-8a5a-9e48a26575bf';
// Used when the scaffold section is missing or its lines body has no
// prediction games. CFB ids are also what the scaffold returns. The
// scaffold echoes those CFB ids for NFL and MLB, and they are empty there.
const MONEYLINE_FILTER_IDS = {
  NFL: '0251dd94-773d-47ec-878d-8a7349b8b967',
  CFB: 'e669e437-9dc7-48d8-9d93-2aabd5a13d10',
  MLB: '3f157ade-e2af-41ff-a5c6-9e0ca4f8c018',
};
const SPREAD_FILTER_IDS = {
  NFL: '42ae12ae-89ce-49f3-80fa-2dc1ab9338f8',
  CFB: 'dae11c40-9758-4142-af39-79c75d6fcc46',
  MLB: 'f71ad294-b93c-4c62-be04-d123e7640775',
};
// MLB's pill is Total Runs. NFL and CFB are Total Points.
const TOTAL_FILTER_IDS = {
  NFL: '8f654930-4852-4510-babc-58ba0ff9840f',
  CFB: '0fa6fdd2-afb1-4c3a-bb35-98da0b814ef1',
  MLB: 'efa4c7d0-9e4a-46cf-89f3-24005a3b7c94',
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
function gamesFromContentLines(body, fallbackSportId, now = Date.now()) {
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
  return [...byMatch.values()].map((game) => ({
    ...game,
    lines: sanitizeUnderdogPhoneLines(game.lines, now, UNDERDOG_BOARD_OMIT_MS),
  })).filter((game) => game.lines.length);
}

function mergeGames(lists, now = Date.now()) {
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
  return [...byId.values()].map((game) => ({
    ...game,
    lines: sanitizeUnderdogPhoneLines(game.lines, now, UNDERDOG_BOARD_OMIT_MS),
  })).filter((game) => game.lines.length);
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

function pickemFilterFromScaffold(body, titleRe) {
  for (const section of (body && body.sections) || []) {
    if (!section || section.content_type !== 'lines') continue;
    if (!titleRe.test(String(section.title || '').trim())) continue;
    const id = filterIdFromSection(section);
    if (id) return id;
  }
  return null;
}

function moneylineFilterFromScaffold(body) {
  return pickemFilterFromScaffold(body, /^moneyline$/i);
}

function spreadFilterFromScaffold(body) {
  return pickemFilterFromScaffold(body, /^(spread|run line|point spread)$/i);
}

function totalFilterFromScaffold(body) {
  return pickemFilterFromScaffold(body, /^(total points|total runs)$/i);
}

function gamesForMarket(body, sportId, market, now) {
  return gamesFromContentLines(body, sportId, now).map((game) => ({
    ...game,
    lines: (game.lines || []).filter((line) => line && line.market === market),
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

const CORE_MARKETS = [
  { market: 'h2h', discover: moneylineFilterFromScaffold, fallbacks: MONEYLINE_FILTER_IDS },
  { market: 'spreads', discover: spreadFilterFromScaffold, fallbacks: SPREAD_FILTER_IDS },
  { market: 'totals', discover: totalFilterFromScaffold, fallbacks: TOTAL_FILTER_IDS },
];

async function fetchMarketLines(fetchFn, cfg, sportId, filterId, market, now) {
  const res = await fetchJson(fetchFn, contentLinesUrl(cfg, sportId, filterId), requestHeaders(cfg));
  const games = res.ok && res.body ? gamesForMarket(res.body, sportId, market, now) : [];
  return { res, games };
}

async function fetchCoreMarket(fetchFn, cfg, sportId, spec, scaffoldBody, now) {
  const discovered = spec.discover(scaffoldBody);
  const fallback = spec.fallbacks[sportId] || null;
  let saw404 = 0;
  let attempts = 0;
  const take = async (filterId) => {
    if (!filterId) return [];
    attempts += 1;
    const result = await fetchMarketLines(fetchFn, cfg, sportId, filterId, spec.market, now);
    if (result.res.status === 404) saw404 += 1;
    return result.games;
  };
  let games = await take(discovered);
  if (!games.length && fallback && fallback !== discovered) games = await take(fallback);
  return { games, saw404, attempts };
}

async function fetchIndexedLines(fetchFn, cfg, sportId, now) {
  const scaffold = await fetchJson(fetchFn, sportScaffoldUrl(cfg, sportId), requestHeaders(cfg));
  const fetched = await mapPool(CORE_MARKETS, CORE_MARKETS.length, (spec) => (
    fetchCoreMarket(fetchFn, cfg, sportId, spec, scaffold.body, now)
  ));
  let saw404 = 0;
  let attempts = 0;
  const lists = [];
  for (const result of fetched) {
    saw404 += result.saw404;
    attempts += result.attempts;
    lists.push(result.games);
  }
  return { games: mergeGames(lists, now), saw404, attempts };
}

async function fetchUnderdogPhone(deps) {
  const cfg = readConfig(envOf(deps));
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const now = (deps && deps.now) || Date.now();
  const cache = (deps && deps.cache) || defaultCache;
  const live = !!(deps && deps.live);
  const ttl = live ? UNDERDOG_LIVE_CACHE_MS : CACHE_TTL_MS;
  const cacheKey = `${cfg.base}|${cfg.product}|${cfg.stateConfigId}|${cfg.productExperienceId}|h2h-spreads-totals${live ? '|live' : ''}`;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < ttl) {
    return { ...hit.body, cacheStatus: 'HIT' };
  }

  const sports = [...INDEX_SPORTS];
  let attempts = 0;
  let rejected = 0;
  const fetched = await mapPool(sports, sports.length, async (sportId) => {
    const result = await fetchIndexedLines(fetchFn, cfg, sportId, now);
    attempts += result.attempts;
    rejected += result.saw404;
    return result.games;
  });
  const games = mergeGames(fetched, now);
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
  UNDERDOG_LIVE_CACHE_MS,
  DEFAULT_CLIENT_VERSION,
  DEFAULT_PRODUCT_EXPERIENCE_ID,
  DEFAULT_STATE_CONFIG_ID,
  MONEYLINE_FILTER_IDS,
  SPREAD_FILTER_IDS,
  TOTAL_FILTER_IDS,
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
  spreadFilterFromScaffold,
  totalFilterFromScaffold,
  readConfig,
  resetUnderdogPhoneCache,
  sportScaffoldUrl,
};
