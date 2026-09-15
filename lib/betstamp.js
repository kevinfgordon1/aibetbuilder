'use strict';

// Server-only Betstamp Pro client. The API key is read from BETSTAMP_API_KEY
// and never returned to the browser. REST + SSE both go through this module.

const REST_BASE = process.env.BETSTAMP_REST_BASE || 'https://api.pro.betstamp.com/api';
const STREAM_BASE = process.env.BETSTAMP_STREAM_BASE || 'https://stream.betstamp.com/v1/markets';

const TRIAL_BOOK_IDS = [100, 200, 300, 250, 613, 642, 150, 365, 191, 193, 194];
const ALLOWED_LEAGUES = new Set(['NFL', 'NCAAF']);
const DEFAULT_BET_TYPES = 'moneyline,spread,total';
const DEFAULT_PERIODS = 'FT';
// Hours ahead of now. Betstamp /fixtures and /markets default to ±24h without this.
const DEFAULT_TIMEDELTA_HOURS = 240;

function readQuery(req) {
  const out = {};
  if (req && req.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      out[k] = Array.isArray(v) ? v.join(',') : v;
    }
  }
  if (req && req.url) {
    try {
      const u = new URL(req.url, 'http://localhost');
      u.searchParams.forEach((v, k) => {
        if (out[k] == null || out[k] === '') out[k] = v;
      });
    } catch (_) { /* ignore */ }
  }
  return out;
}

function parseLeagues(raw) {
  const parts = String(raw == null || raw === '' ? 'NFL' : raw)
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => ALLOWED_LEAGUES.has(s));
  return [...new Set(parts.length ? parts : ['NFL'])];
}

function parseBookIds(raw) {
  if (raw == null || raw === '') return [...TRIAL_BOOK_IDS];
  const ids = String(raw).split(/[,\s]+/).map((s) => Number(s)).filter((n) => TRIAL_BOOK_IDS.includes(n));
  return ids.length ? ids : [...TRIAL_BOOK_IDS];
}

function parseBool(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return null;
}

function parseTimedelta(raw, env) {
  const src = env || process.env;
  const candidate = raw != null && String(raw).trim() !== ''
    ? raw
    : (src && src.BETSTAMP_TIMEDELTA);
  const n = Number(candidate);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEDELTA_HOURS;
  return Math.round(n);
}

// Keep rows with no type (some payloads omit it). Drop tournament/futures when
// type is present and not "match".
function isMatchRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.type == null || String(row.type).trim() === '') return true;
  return String(row.type).trim().toLowerCase() === 'match';
}

function filterMatchRows(rows) {
  return (rows || []).filter(isMatchRow);
}

function buildMarketParams(query, env) {
  query = query || {};
  const leagues = parseLeagues(query.league || query.leagues);
  const bookIds = parseBookIds(query.book_ids);
  const live = parseBool(query.is_live);
  const params = {
    league: leagues.join(','),
    leagues,
    book_ids: bookIds.join(','),
    bookIds,
    bet_types: String(query.bet_types || DEFAULT_BET_TYPES),
    periods: String(query.periods || DEFAULT_PERIODS),
    include_alts: query.include_alts === 'true' ? 'true' : 'false',
    timedelta: String(parseTimedelta(query.timedelta, env)),
  };
  if (live != null) params.is_live = live ? 'true' : 'false';
  const fixtureId = String(query.fixture_id || query.fixtureId || '').trim();
  if (fixtureId) params.fixture_id = fixtureId;
  return params;
}

function filterMarketsToFixture(markets, fixtureId) {
  if (!fixtureId) return markets || [];
  const id = String(fixtureId);
  return (markets || []).filter((m) => m && String(m.fixture_id) === id);
}

function restUrl(path, params) {
  const u = new URL(String(path).replace(/^\//, ''), REST_BASE.endsWith('/') ? REST_BASE : REST_BASE + '/');
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '' || k === 'leagues' || k === 'bookIds') continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function streamUrl(params) {
  const u = new URL(STREAM_BASE);
  for (const [k, v] of Object.entries(params || {})) {
    // timedelta is a REST list-window param; live SSE is current ticks only.
    if (v == null || v === '' || k === 'leagues' || k === 'bookIds' || k === 'timedelta') continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function apiKey(env) {
  const src = env || process.env;
  const key = src.BETSTAMP_API_KEY;
  return key && String(key).trim() ? String(key).trim() : '';
}

function redact(text) {
  return String(text || '')
    .replace(/[A-Za-z0-9_\-]{24,}/g, '[redacted]')
    .slice(0, 400);
}

function asList(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys || []) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

async function betstampFetch(url, { key, fetchFn = fetch, timeoutMs = 15000, accept } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, {
      signal: ctrl.signal,
      headers: {
        Accept: accept || 'application/json',
        'X-API-KEY': key,
      },
    });
    return r;
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(path, params, deps) {
  const url = restUrl(path, params);
  const r = await betstampFetch(url, deps);
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
  if (!r.ok) {
    const err = new Error(redact((json && (json.error || json.message)) || `Betstamp ${path} ${r.status}`));
    err.status = r.status;
    throw err;
  }
  return json;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSnapshot(query, deps = {}) {
  const key = apiKey(deps.env);
  if (!key) {
    const err = new Error('BETSTAMP_API_KEY is not set');
    err.status = 503;
    err.missingKey = true;
    throw err;
  }
  const params = buildMarketParams(query, deps.env);
  const fetchOpts = { key, fetchFn: deps.fetchFn, timeoutMs: deps.timeoutMs };
  const markets = [];
  const fixtures = [];
  const teams = [];
  const leagues = params.leagues;
  const fixtureId = params.fixture_id || '';
  const queryEcho = {
    league: params.league,
    book_ids: params.book_ids,
    bet_types: params.bet_types,
    periods: params.periods,
    is_live: params.is_live ?? null,
    include_alts: params.include_alts,
    timedelta: params.timedelta,
  };
  // One-fixture alt pull: markets only. Do not fan out fixtures/teams or other
  // games — the board already has the row and must stay mains-only.
  if (fixtureId) {
    const league = leagues[0];
    const p = { ...params, league, fixture_id: fixtureId };
    const mkt = await fetchJson('markets', p, fetchOpts);
    markets.push(...filterMarketsToFixture(
      filterMatchRows(asList(mkt, ['markets', 'data'])),
      fixtureId,
    ));
    return {
      ok: true,
      source: 'betstamp',
      fetchedAt: new Date().toISOString(),
      query: { ...queryEcho, fixture_id: fixtureId },
      markets,
      fixtures,
      teams,
    };
  }
  // Stay under Betstamp ~4 RPS: one league at a time, 3 GETs, then a short gap.
  for (let i = 0; i < leagues.length; i++) {
    const league = leagues[i];
    const p = { ...params, league };
    const [mkt, fix, team] = await Promise.all([
      fetchJson('markets', p, fetchOpts),
      fetchJson('fixtures', { league, timedelta: params.timedelta }, fetchOpts),
      fetchJson('teams', { league }, fetchOpts),
    ]);
    markets.push(...filterMatchRows(asList(mkt, ['markets', 'data'])));
    fixtures.push(...filterMatchRows(asList(fix, ['fixtures', 'data'])));
    teams.push(...asList(team, ['teams', 'data']));
    if (i < leagues.length - 1) await sleep(deps.gapMs != null ? deps.gapMs : 280);
  }
  return {
    ok: true,
    source: 'betstamp',
    fetchedAt: new Date().toISOString(),
    query: queryEcho,
    markets,
    fixtures,
    teams,
  };
}

function parseSseChunk(buffer) {
  const parts = String(buffer || '').split('\n\n');
  const rest = parts.pop() ?? '';
  const events = [];
  for (const block of parts) {
    if (!block.trim()) continue;
    let event = null;
    const dataLines = [];
    const comments = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line) continue;
      if (line.startsWith(':')) {
        comments.push(line.slice(1).trim());
        continue;
      }
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    events.push({ event, dataLines, comments });
  }
  return { events, rest };
}

function wrapSseEvent(block, ingestTs) {
  let out = '';
  for (const c of block.comments || []) out += `: ${c}\n`;
  if (block.event) out += `event: ${block.event}\n`;
  if (block.dataLines && block.dataLines.length) {
    const raw = block.dataLines.join('\n');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = { raw }; }
    out += `data: ${JSON.stringify({ ingest_ts: ingestTs, payload: parsed })}\n`;
  }
  return out + '\n';
}

module.exports = {
  REST_BASE,
  STREAM_BASE,
  TRIAL_BOOK_IDS,
  ALLOWED_LEAGUES,
  DEFAULT_TIMEDELTA_HOURS,
  readQuery,
  parseLeagues,
  parseBookIds,
  parseBool,
  parseTimedelta,
  isMatchRow,
  filterMatchRows,
  buildMarketParams,
  filterMarketsToFixture,
  restUrl,
  streamUrl,
  apiKey,
  redact,
  asList,
  fetchSnapshot,
  parseSseChunk,
  wrapSseEvent,
  betstampFetch,
};
