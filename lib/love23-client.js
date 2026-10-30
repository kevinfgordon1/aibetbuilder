'use strict';

// love23 (DGS) Player API client. READ-ONLY BY CONSTRUCTION.
//
// Only the paths in READ_PATHS can be requested. Anything under /v1/wagers/
// (compile or send) is refused before a request is built, so this module can
// never place, price or validate a bet. Recommendations only.
//
// Credentials come from env LOVE23_USERNAME / LOVE23_PASSWORD (set by Kevin).
// Tokens live in memory only and are never returned to callers or logged.
//
// Schedule polling: callers may ask as often as they like; the client serves
// a cached copy for SCHEDULE_TTL_MS (default 30s) and backs off exponentially
// (30s, 60s, 120s ... max 5 min) on 429 / 5xx / network errors, serving the
// last good payload marked stale meanwhile.

const DEFAULT_BASE = 'https://api.love23.bet';
const SCHEDULE_TTL_MS = 30 * 1000;
const ACCOUNT_TTL_MS = 30 * 1000;
const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
const REFRESH_EARLY_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

const AUTH_PATHS = new Set(['/v1/auth/login', '/v1/auth/refresh', '/v1/auth/logout']);
const READ_PATHS = [
  /^\/v1\/health$/,
  /^\/v1\/players\/me$/,
  /^\/v1\/players\/balance$/,
  /^\/v1\/players\/openbets(\?mode=\d+)?$/,
  /^\/v1\/players\/settled(\?mode=\d+)?$/,
  /^\/v1\/players\/readback\/[\d,]+$/,
  /^\/v1\/sports\/leagues(\?route_id=\d+)?$/,
  /^\/v1\/sports\/schedule\?leagueIds=[\d,]+(&route_id=\d+)?$/,
];

class Love23Error extends Error {
  constructor(message, { status = 0, transient = false } = {}) {
    super(message);
    this.name = 'Love23Error';
    this.status = status;
    this.transient = transient;
  }
}

function assertAllowedPath(method, path) {
  const p = String(path || '');
  if (/\/wagers\//i.test(p) || /\/proxy\//i.test(p)) {
    throw new Love23Error('love23 client is read-only: wager/proxy endpoints are blocked');
  }
  if (method === 'POST') {
    if (!AUTH_PATHS.has(p)) throw new Love23Error(`love23 client: POST not allowed for ${p}`);
    return;
  }
  if (method !== 'GET' || !READ_PATHS.some((re) => re.test(p))) {
    throw new Love23Error(`love23 client: ${method} not allowed for ${p}`);
  }
}

function readCreds(env = process.env) {
  const username = String(env.LOVE23_USERNAME || '').trim();
  const password = String(env.LOVE23_PASSWORD || '');
  if (!username || !password) return null;
  return { username, password };
}

function isTransient(status) {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function createLove23Client({
  creds = () => readCreds(process.env),
  base = (process.env.LOVE23_API_BASE || DEFAULT_BASE).replace(/\/+$/, ''),
  fetchImpl = (...a) => fetch(...a),
  now = () => Date.now(),
  scheduleTtlMs = SCHEDULE_TTL_MS,
} = {}) {
  let session = null; // { access, refresh, accessExp, refreshExp }
  const cache = new Map(); // key -> { at, data }
  const backoff = new Map(); // key -> { until, n, error }

  async function rawFetch(method, path, { body, token } = {}) {
    assertAllowedPath(method, path);
    const headers = { accept: 'application/json', 'user-agent': 'aibetbuilder-love23/1.0' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      throw new Love23Error(`love23 network error on ${path.split('?')[0]}`, { status: 0, transient: true });
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!res.ok) {
      const detail = data && typeof data.detail === 'string' ? data.detail : '';
      throw new Love23Error(`love23 ${res.status} on ${path.split('?')[0]}${detail ? ': ' + detail.slice(0, 120) : ''}`, { status: res.status, transient: isTransient(res.status) });
    }
    return data;
  }

  function storeSession(d) {
    const t = now();
    session = {
      access: d.access_token,
      refresh: d.refresh_token,
      accessExp: t + Math.max(60, Number(d.expires_in) || 3600) * 1000,
      refreshExp: t + Math.max(60, Number(d.refresh_expires_in) || 86400) * 1000,
    };
  }

  async function login() {
    const c = creds();
    if (!c) throw new Love23Error('LOVE23_USERNAME / LOVE23_PASSWORD are not set', { status: 503 });
    const d = await rawFetch('POST', '/v1/auth/login', { body: { username: c.username, password: c.password } });
    if (!d || !d.access_token) throw new Love23Error('love23 login returned no token');
    storeSession(d);
  }

  async function token() {
    const t = now();
    if (session && session.accessExp - REFRESH_EARLY_MS > t) return session.access;
    if (session && session.refresh && session.refreshExp - REFRESH_EARLY_MS > t) {
      try {
        const d = await rawFetch('POST', '/v1/auth/refresh', { body: { refresh_token: session.refresh } });
        if (d && d.access_token) { storeSession({ refresh_token: session.refresh, refresh_expires_in: (session.refreshExp - t) / 1000, ...d }); return session.access; }
      } catch (e) {
        if (e.transient) throw e;
        session = null; // rotated or revoked -> full login
      }
    }
    await login();
    return session.access;
  }

  async function authed(path) {
    let tok = await token();
    try {
      return await rawFetch('GET', path, { token: tok });
    } catch (e) {
      if (e.status !== 401) throw e;
      session = null; // another device logged in, or token revoked
      tok = await token();
      return rawFetch('GET', path, { token: tok });
    }
  }

  async function cachedGet(key, path, ttlMs) {
    const t = now();
    const hit = cache.get(key);
    if (hit && t - hit.at < ttlMs) return { data: hit.data, fetchedAt: hit.at, stale: false, cached: true };
    const bo = backoff.get(key);
    if (bo && bo.until > t) {
      if (hit) return { data: hit.data, fetchedAt: hit.at, stale: true, cached: true, backoffUntil: bo.until, error: bo.error };
      throw new Love23Error(`love23 backing off until ${new Date(bo.until).toISOString()}: ${bo.error}`, { status: 503, transient: true });
    }
    try {
      const data = await authed(path);
      cache.set(key, { at: now(), data });
      backoff.delete(key);
      return { data, fetchedAt: now(), stale: false, cached: false };
    } catch (e) {
      if (!e.transient) throw e;
      const n = (bo ? bo.n : 0) + 1;
      const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
      backoff.set(key, { until: now() + wait, n, error: e.message });
      if (hit) return { data: hit.data, fetchedAt: hit.at, stale: true, cached: true, backoffUntil: now() + wait, error: e.message };
      throw e;
    }
  }

  function leaguePath(ids) {
    const list = (ids || []).map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x) && x > 0);
    if (!list.length) throw new Love23Error('no league ids');
    return `/v1/sports/schedule?leagueIds=${list.join(',')}&route_id=0`;
  }

  return {
    schedule: (ids) => cachedGet('schedule:' + (ids || []).join(','), leaguePath(ids), scheduleTtlMs),
    leagues: () => cachedGet('leagues', '/v1/sports/leagues?route_id=0', 10 * 60 * 1000),
    balance: () => cachedGet('balance', '/v1/players/balance', ACCOUNT_TTL_MS),
    profile: () => cachedGet('me', '/v1/players/me', 10 * 60 * 1000),
    openBets: () => cachedGet('openbets', '/v1/players/openbets?mode=0', ACCOUNT_TTL_MS),
    settled: () => cachedGet('settled', '/v1/players/settled?mode=0', ACCOUNT_TTL_MS),
    hasSession: () => !!session,
    logout: async () => {
      if (!session) return false;
      const tok = session.access;
      session = null;
      try { await rawFetch('POST', '/v1/auth/logout', { body: {}, token: tok }); return true; } catch (_) { return false; }
    },
    _reset: () => { session = null; cache.clear(); backoff.clear(); },
  };
}

module.exports = {
  createLove23Client,
  assertAllowedPath,
  readCreds,
  Love23Error,
  isTransient,
  SCHEDULE_TTL_MS,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
};
