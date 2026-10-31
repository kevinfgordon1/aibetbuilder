'use strict';

// Server fetch for Underdog phone prices (odds.prediction).
//
// Phone product experience is b34dfd93-d0e8-4da3-8bf4-45c15c548dec.
// Re-verified 2026-10-27 ~5:20 PM ET against Kevin's phone, no user session:
//   GET /v1/lobbies/content/match_grouped_lines?match_id=183236 (TROY @ JMU)
//       &product_experience_id=b34dfd93-…  → Troy +1070 / JMU −1250 (phone)
//       &product_experience_id=018e1234-…  → Troy +835 / JMU −1667, a
//         separate over_under_line set last repriced Oct 26 7:58 PM ET.
//   BKN @ BOS (212004): b34dfd93 +490 / −625 (phone) vs 018e1234 +456 / −667.
// 018e1234-5678-9abc-def0-123456789009 (the old default, a placeholder-
// looking id) now serves a frozen/wider book: 136 of 148 CFB moneyline
// sides differed and it carried moneylines for only 74 of 115 CFB games.
// The 2026-09-21 note that b34dfd93 was the "sticker" is no longer true.
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
const { confirmUnderdogLinesWithKalshi, fetchKalshiGameAsks } = require('./underdog-kalshi-confirm');
const { underdogPredictFeePerContract } = require('./underdog-predict-fee');

const DEFAULT_BASE = 'https://api.underdogfantasy.com';
const DEFAULT_CLIENT_VERSION = '20260918170103';
const DEFAULT_PRODUCT = 'fantasy';
// Phone experience (matches the phone, re-verified 2026-10-27). The old
// id 018e1234-5678-9abc-def0-123456789009 serves a stale/wider book.
const DEFAULT_STATE_CONFIG_ID = 'f8996742-f10c-4d32-955a-dcbcaa5dc5c0';
const DEFAULT_PRODUCT_EXPERIENCE_ID = 'b34dfd93-d0e8-4da3-8bf4-45c15c548dec';
const LEGACY_PRODUCT_EXPERIENCE_ID = '018e1234-5678-9abc-def0-123456789009';
const CACHE_TTL_MS = 45 * 1000;
// Underdog's Cloudflare edge answers with Cache-Control max-age=30,
// s-maxage=30, stale-while-revalidate=60 on the same URL, so a plain GET can
// hand back a body up to ~90s old. Measured 2026-10-01 during PIT @ CLE:
// the origin repriced a live market every ~3–10s, but the plain URL showed a
// change only 5–30s after its updated_at (3.4x fewer changes seen over 150s).
// A throwaway query param (_cb) is a different edge cache key, so it always
// reaches the origin (cf-cache-status MISS, price 0.2–4s old). Live games are
// in this payload (MLB status "scoring", NFL "scoring" at halftime).
// ?live=1 busts the edge cache with a UNDERDOG_LIVE_BUST_MS bucket (shared by
// every caller in that window, so origin load stays bounded) and keeps its
// own in-memory result for UNDERDOG_LIVE_CACHE_MS. The default board/Promo
// path stays on 45s and the normal edge-cached URL.
const UNDERDOG_LIVE_CACHE_MS = 5 * 1000;
const UNDERDOG_LIVE_BUST_MS = 5 * 1000;
// ?fresh=1 is for the odds relay only: ONE shared poller per league that
// fans the result out over SSE. It gets a 1s bust bucket (every 2s relay poll
// is a fresh Cloudflare MISS instead of a copy up to 5s old) and a 1s memory
// cache so a stray second caller cannot double the origin load.
const UNDERDOG_FRESH_CACHE_MS = 1000;
const UNDERDOG_FRESH_BUST_MS = 1000;
// Scaffold bodies only carry the PickemStat filter ids (Moneyline / Spread /
// Total). Re-fetching them on every live poll was 1 of every 4 requests.
const SCAFFOLD_CACHE_TTL_MS = 5 * 60 * 1000;
const defaultScaffoldCache = new Map();
// Underdog sport_id values. CFB is college football; the app sport is NCAAF.
// CBB is men's college basketball; the app sport is NCAAB (sport_id NCAAB /
// NCAAMB are 404 on Underdog; checked 2026-10-30).
// MLB only with MLB_ENABLED=1 (Kevin Oct 30 2026, season over).
const INDEX_SPORTS = new Set(['NFL', 'CFB', 'MLB', 'NHL', 'NBA', 'CBB'].filter((s) => s !== 'MLB' || require('./mlb-switch').mlbOn()));
const SPORT_BY_UNDERDOG_ID = { NFL: 'NFL', CFB: 'NCAAF', MLB: 'MLB', NHL: 'NHL', NBA: 'NBA', CBB: 'NCAAB' };
// Team Picks market group. Moneyline, Spread, and Total sections are the index.
const TEAM_PICKS_MARKET_GROUP = 'b913095d-468c-4a5f-8a5a-9e48a26575bf';
// Used when the scaffold section is missing or its lines body has no
// prediction games. CFB ids are also what the scaffold returns. The
// scaffold echoes those CFB ids for NFL and MLB, and they are empty there.
const MONEYLINE_FILTER_IDS = {
  NFL: '0251dd94-773d-47ec-878d-8a7349b8b967',
  CFB: 'e669e437-9dc7-48d8-9d93-2aabd5a13d10',
  MLB: '3f157ade-e2af-41ff-a5c6-9e0ca4f8c018',
  // NHL pills (checked live 2026-09-30, Kalshi KXNHLGAME / KXNHLSPREAD /
  // KXNHLTOTAL). The NHL scaffold has no per-pill lines sections, so these
  // ids are the only path: puck line is always +/-1.5, total is Total Goals.
  NHL: 'b8e09d03-dac1-44e1-9830-98cdc85e0d93',
  // NBA pills (checked live 2026-10-27 on match_grouped_lines, BKN @ BOS
  // match 212004). Like NHL, the NBA scaffold has no per-pill lines
  // sections. Spread is "Margin of Victory", total is Total Points.
  NBA: '90b34c5b-48d1-45d9-95dc-22cf0040a482',
  // CBB pills (checked live 2026-10-30 ~10 PM ET on match_grouped_lines with
  // market_categories[]=core: 123 games, VILL @ ND match 209889; the CBB
  // scaffold has no per-pill lines sections). Spread is "Spread", total is
  // "Total Points" (7 games each on Oct 30, more as the season opens).
  CBB: '1cf0e3f3-2cb4-4445-968e-b651d4919720',
};
const SPREAD_FILTER_IDS = {
  NFL: '42ae12ae-89ce-49f3-80fa-2dc1ab9338f8',
  CFB: 'dae11c40-9758-4142-af39-79c75d6fcc46',
  MLB: 'f71ad294-b93c-4c62-be04-d123e7640775',
  NHL: '20aa9a25-f18b-45ee-ac34-369d6d672804',
  NBA: '43642591-6015-44fd-8459-ecd2b3ddb6c6',
  CBB: 'ec20a18f-28bc-4232-8561-3ba918668a66',
};
// MLB's pill is Total Runs, NHL's is Total Goals. NFL and CFB are Total Points.
const TOTAL_FILTER_IDS = {
  NFL: '8f654930-4852-4510-babc-58ba0ff9840f',
  CFB: '0fa6fdd2-afb1-4c3a-bb35-98da0b814ef1',
  MLB: 'efa4c7d0-9e4a-46cf-89f3-24005a3b7c94',
  NHL: 'a4e2704d-0790-4aa9-aca4-c805102e9d34',
  NBA: '187d7a65-ed66-4b6e-a7e9-3efefa7ce8ca',
  CBB: '9483471c-6041-423d-9da6-93a0625cac42',
};

// Moneylines come from the sport's grouped game list — the same
// match_grouped_lines call Underdog's own lobby makes — with a high
// match_limit (the lobby default is 100 for CFB and 30 elsewhere, and
// there is no next page: CFB had 115 games on 2026-10-27, so 100 cut the
// late Saturday games). CFB uses the Team Picks MarketGroup (what the CFB
// scaffold asks for); NFL/NBA/NHL/MLB use market_categories[]=core (the
// MarketGroup list is empty for them). The per-sport Moneyline PickemStat
// pill (MONEYLINE_FILTER_IDS) is the fallback when the grouped list has
// no moneylines. Spreads and totals stay on their pills.
const GROUPED_MATCH_LIMIT = 250;
const GROUPED_MARKET_GROUP_SPORTS = new Set(['CFB']);

// Price sanity: odds.prediction carries both an American and the contract
// probability. The phone price is probability + UDX fee; a print that
// disagrees by more than PRICE_SUSPECT_PTS points of implied probability
// is flagged priceSuspect (never restamped fresh by Kalshi, so it ages out
// on its own clock); a print paying more than PRICE_REJECT_PTS above its
// probability (phantom value) is dropped. Probability is
// a whole-cent field, so rounding alone is under ~1 point.
// (2026-10-27 old experience: Troy +835 at probability 8 → 2.2 points.)
const PRICE_SUSPECT_PTS = 1.5;
const PRICE_REJECT_PTS = 3.0;

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

function underdogIsLive(status) {
  const s = String(status || '').toLowerCase();
  return s === 'scoring' || s === 'live' || s === 'inprogress' || s === 'in_progress' || s === 'in-play' || s === 'inplay';
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
      status,
      live: underdogIsLive(status),
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
// kalshiAsks (optional, from fetchKalshiGameAsks): an aged h2h side whose
// price still equals Kalshi's yes ask is restamped before the age gates.
function gamesFromContentLines(body, fallbackSportId, now = Date.now(), kalshiAsks = null) {
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
    const parsed = kalshiAsks
      ? confirmUnderdogLinesWithKalshi(
        linesFromContent({ over_under_lines: { line } }, { withSide: true }),
        kalshiAsks,
        { away: teams.away, home: teams.home, scheduledAt: game.scheduled_at || null },
      )
      : linesFromContent({ over_under_lines: { line } });
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
        status,
        live: underdogIsLive(status),
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

function groupedLinesUrl(cfg, sportId, bust) {
  const params = new URLSearchParams({
    include_live: 'true',
    match_limit: String(GROUPED_MATCH_LIMIT),
    product: cfg.product,
    product_experience_id: cfg.productExperienceId,
    show_more_picks_cta: 'false',
    sport_id: String(sportId),
    state_config_id: cfg.stateConfigId,
  });
  if (GROUPED_MARKET_GROUP_SPORTS.has(String(sportId))) {
    params.set('filter_id', TEAM_PICKS_MARKET_GROUP);
    params.set('filter_type', 'MarketGroup');
  } else {
    params.append('market_categories[]', 'core');
  }
  if (bust != null) params.set('_cb', String(bust));
  return `${cfg.base}/v1/lobbies/content/match_grouped_lines?${params}`;
}

function contentLinesUrl(cfg, sportId, filterId, bust) {
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
  if (bust != null) params.set('_cb', String(bust));
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

function gamesForMarket(body, sportId, market, now, kalshiAsks) {
  return gamesFromContentLines(body, sportId, now, kalshiAsks).map((game) => ({
    ...game,
    lines: (game.lines || []).filter((line) => line && line.market === market),
  })).filter((game) => game.lines.length);
}

function impliedFromAmerican(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
}

// Signed points of implied probability between the printed American and
// probability + UDX fee (+ = the print pays less than its probability says).
function priceDriftFromProbabilityPts(american, probability) {
  const p = Number(probability);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  const implied = impliedFromAmerican(american);
  if (implied == null) return null;
  const phone = p + underdogPredictFeePerContract(p);
  return Math.round((implied - phone) * 1000) / 10;
}

function linesFromContent(body, opts) {
  const withSide = !!(opts && opts.withSide);
  const quotes = predictionQuotesFromPayload(body, { withSide });
  const lines = [];
  for (const quote of quotes) {
    if (!quote || quote.american == null || quote.market === 'future' || !quote.market) continue;
    const drift = priceDriftFromProbabilityPts(quote.american, quote.probability);
    // Only a print that pays MORE than its probability (phantom value) is
    // dropped; one that pays less is only flagged (seen on thin favorites,
    // e.g. Ohio -715 at probability 82 on 2026-10-27).
    if (drift != null && drift < -PRICE_REJECT_PTS) continue;
    const suspect = drift != null && Math.abs(drift) > PRICE_SUSPECT_PTS;
    lines.push({
      market: quote.market,
      name: quote.name,
      american: quote.american,
      probability: quote.probability,
      point: quote.point,
      choice: quote.choice,
      updatedAt: quote.updatedAt || null,
      ...(quote.status ? { status: quote.status } : {}),
      ...(suspect ? { priceSuspect: true, priceDriftPts: drift } : {}),
      ...(withSide && quote.eventTicker ? { eventTicker: quote.eventTicker } : {}),
      ...(withSide && quote.sideCode ? { sideCode: quote.sideCode } : {}),
      ...(withSide && quote.sideName ? { sideName: quote.sideName } : {}),
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
  { market: 'h2h', grouped: true, discover: moneylineFilterFromScaffold, fallbacks: MONEYLINE_FILTER_IDS },
  { market: 'spreads', discover: spreadFilterFromScaffold, fallbacks: SPREAD_FILTER_IDS },
  { market: 'totals', discover: totalFilterFromScaffold, fallbacks: TOTAL_FILTER_IDS },
];

async function fetchMarketLines(fetchFn, cfg, sportId, filterId, market, now, bust, kalshiAsks) {
  const res = await fetchJson(fetchFn, contentLinesUrl(cfg, sportId, filterId, bust), requestHeaders(cfg));
  const asks = market === 'h2h' && kalshiAsks ? await kalshiAsks : null;
  const games = res.ok && res.body ? gamesForMarket(res.body, sportId, market, now, asks) : [];
  return { res, games };
}

async function fetchGroupedMoneylines(fetchFn, cfg, sportId, now, bust, kalshiAsks) {
  const res = await fetchJson(fetchFn, groupedLinesUrl(cfg, sportId, bust), requestHeaders(cfg));
  const asks = kalshiAsks ? await kalshiAsks : null;
  const games = res.ok && res.body ? gamesForMarket(res.body, sportId, 'h2h', now, asks) : [];
  return { res, games };
}

async function fetchCoreMarket(fetchFn, cfg, sportId, spec, scaffoldBody, now, bust, kalshiAsks) {
  if (spec.grouped) {
    const grouped = await fetchGroupedMoneylines(fetchFn, cfg, sportId, now, bust, kalshiAsks);
    if (grouped.games.length) return { games: grouped.games, saw404: 0, attempts: 1, via: 'grouped' };
    const pill = await fetchCoreMarket(fetchFn, cfg, sportId, { ...spec, grouped: false }, scaffoldBody, now, bust, kalshiAsks);
    return {
      games: pill.games,
      saw404: pill.saw404 + (grouped.res.status === 404 ? 1 : 0),
      attempts: pill.attempts + 1,
      via: 'pill',
    };
  }
  const discovered = spec.discover(scaffoldBody);
  const fallback = spec.fallbacks[sportId] || null;
  let saw404 = 0;
  let attempts = 0;
  const take = async (filterId) => {
    if (!filterId) return [];
    attempts += 1;
    const result = await fetchMarketLines(fetchFn, cfg, sportId, filterId, spec.market, now, bust, kalshiAsks);
    if (result.res.status === 404) saw404 += 1;
    return result.games;
  };
  let games = await take(discovered);
  if (!games.length && fallback && fallback !== discovered) games = await take(fallback);
  return { games, saw404, attempts };
}

async function fetchScaffold(fetchFn, cfg, sportId, now, scaffoldCache) {
  const key = `${cfg.base}|${cfg.product}|${cfg.stateConfigId}|${cfg.productExperienceId}|${sportId}`;
  const hit = scaffoldCache && scaffoldCache.get(key);
  if (hit && now - hit.at < SCAFFOLD_CACHE_TTL_MS) return hit.res;
  const res = await fetchJson(fetchFn, sportScaffoldUrl(cfg, sportId), requestHeaders(cfg));
  if (scaffoldCache && res.ok && res.body) scaffoldCache.set(key, { at: now, res });
  return res;
}

async function fetchIndexedLines(fetchFn, cfg, sportId, now, bust, scaffoldCache, kalshiAsks) {
  const scaffold = await fetchScaffold(fetchFn, cfg, sportId, now, scaffoldCache);
  const fetched = await mapPool(CORE_MARKETS, CORE_MARKETS.length, (spec) => (
    fetchCoreMarket(fetchFn, cfg, sportId, spec, scaffold.body, now, bust, kalshiAsks)
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

// ?sport=NCAAF,NFL narrows a poll to those leagues (app names, mapped to
// Underdog's sport ids). Unknown names are ignored; none valid = all sports.
function underdogSportsFromDeps(deps) {
  const raw = deps && deps.sports;
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const want = new Set();
  for (const item of list) {
    const name = String(item || '').trim().toUpperCase();
    if (!name) continue;
    const id = Object.keys(SPORT_BY_UNDERDOG_ID).find((k) => k === name || SPORT_BY_UNDERDOG_ID[k] === name);
    if (id) want.add(id);
  }
  return want.size ? [...INDEX_SPORTS].filter((id) => want.has(id)) : null;
}

async function fetchUnderdogPhone(deps) {
  const cfg = readConfig(envOf(deps));
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const now = (deps && deps.now) || Date.now();
  const cache = (deps && deps.cache) || defaultCache;
  const live = !!(deps && deps.live);
  // Live polls reuse the filter ids; the 45s default path keeps its fresh scaffold.
  const scaffoldCache = (deps && deps.scaffoldCache) || (live ? defaultScaffoldCache : null);
  const fresh = live && !!(deps && deps.fresh);
  const only = underdogSportsFromDeps(deps);
  const ttl = fresh ? UNDERDOG_FRESH_CACHE_MS : (live ? UNDERDOG_LIVE_CACHE_MS : CACHE_TTL_MS);
  const cacheKey = `${cfg.base}|${cfg.product}|${cfg.stateConfigId}|${cfg.productExperienceId}|h2h-spreads-totals${live ? '|live' : ''}${fresh ? '|fresh' : ''}${only ? `|${only.join(',')}` : ''}`;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < ttl) {
    return { ...hit.body, cacheStatus: 'HIT', fetchedAt: hit.at };
  }

  const bustMs = fresh ? UNDERDOG_FRESH_BUST_MS : UNDERDOG_LIVE_BUST_MS;
  const bust = live ? Math.floor(now / bustMs) : null;
  const sports = only || [...INDEX_SPORTS];
  // Kalshi yes asks confirm aged-but-unchanged moneylines (see
  // lib/underdog-kalshi-confirm.js). Read in parallel with Underdog. Tests
  // that inject fetchFn opt in with deps.kalshiFetchFn; deps.kalshiConfirm
  // === false turns it off.
  const kalshiFetchFn = (deps && deps.kalshiFetchFn) || ((deps && deps.fetchFn) ? null : fetch);
  const kalshiAsks = kalshiFetchFn && !(deps && deps.kalshiConfirm === false)
    ? fetchKalshiGameAsks(kalshiFetchFn, sports, now, deps && deps.kalshiCache).catch(() => null)
    : null;
  let attempts = 0;
  let rejected = 0;
  const fetched = await mapPool(sports, sports.length, async (sportId) => {
    const result = await fetchIndexedLines(fetchFn, cfg, sportId, now, bust, scaffoldCache, kalshiAsks);
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
  if (configRejected && scaffoldCache) scaffoldCache.clear();
  cache.set(cacheKey, { at: now, body });
  return { ...body, cacheStatus: 'MISS', fetchedAt: now };
}

function resetUnderdogPhoneCache(cache = defaultCache, scaffoldCache = defaultScaffoldCache) {
  cache.clear();
  scaffoldCache.clear();
}

module.exports = {
  CACHE_TTL_MS,
  UNDERDOG_LIVE_CACHE_MS,
  UNDERDOG_LIVE_BUST_MS,
  UNDERDOG_FRESH_CACHE_MS,
  UNDERDOG_FRESH_BUST_MS,
  DEFAULT_CLIENT_VERSION,
  DEFAULT_PRODUCT_EXPERIENCE_ID,
  DEFAULT_STATE_CONFIG_ID,
  GROUPED_MATCH_LIMIT,
  LEGACY_PRODUCT_EXPERIENCE_ID,
  PRICE_REJECT_PTS,
  PRICE_SUSPECT_PTS,
  MONEYLINE_FILTER_IDS,
  SPREAD_FILTER_IDS,
  TOTAL_FILTER_IDS,
  INDEX_SPORTS,
  SPORT_BY_UNDERDOG_ID,
  TEAM_PICKS_MARKET_GROUP,
  contentLinesUrl,
  fetchUnderdogPhone,
  groupedLinesUrl,
  priceDriftFromProbabilityPts,
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
