// Signed Polymarket US Retail HTTP client (api.polymarket.us).
// Public market metadata uses gateway.polymarket.us and is not signed.
// No WebSocket, no CLOB. Callers inject fetchImpl in tests.
'use strict';

const { authHeaders, redactText } = require('./polymarket-us-auth');

function queryString(query) {
  if (!query || typeof query !== 'object') return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item == null || item === '') continue;
        usp.append(k, String(item));
      }
      continue;
    }
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? '?' + s : '';
}

function queryHasKeys(query) {
  return queryString(query) !== '';
}

function parseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

function httpError(method, path, statusCode, json, text) {
  const raw = json && typeof json === 'object'
    ? (json.message || json.error || json.reason || json.code || '')
    : '';
  const msg = redactText(raw || text || '');
  const err = new Error('Polymarket ' + method + ' ' + path + ' ' + statusCode + (msg ? ' ' + msg : ''));
  err.statusCode = statusCode;
  err.publicMessage = msg;
  return err;
}

function createPolymarketUsClient({
  keyId,
  secretKey,
  apiBase = 'https://api.polymarket.us',
  gatewayBase = 'https://gateway.polymarket.us',
  fetchImpl = fetch,
} = {}) {
  const origin = String(apiBase || 'https://api.polymarket.us').replace(/\/$/, '');
  const gateway = String(gatewayBase || 'https://gateway.polymarket.us').replace(/\/$/, '');
  let signModeLatched = null;

  async function requestOnce(method, path, { query, body, signMode } = {}) {
    const qs = queryString(query);
    const fullPath = path + qs;
    const includeQuery = signMode === 'path+query';
    const signedPath = includeQuery ? fullPath : path;
    const headers = {
      ...authHeaders({
        keyId,
        secretKey,
        method,
        path: signedPath,
        includeQuery,
      }),
      accept: 'application/json',
      'content-type': 'application/json',
    };
    const res = await fetchImpl(origin + fullPath, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      ok: res.ok,
      text,
      json: parseBody(text),
      signMode,
      signedPath,
    };
  }

  async function request(method, path, { query, body, signMode } = {}) {
    const mode = signMode || signModeLatched || 'path';
    const res = await requestOnce(method, path, { query, body, signMode: mode });
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (!signModeLatched) signModeLatched = mode;
      return res;
    }
    if (
      res.statusCode === 401
      && queryHasKeys(query)
      && !signMode
      && signModeLatched !== 'path+query'
      && mode === 'path'
    ) {
      const retry = await requestOnce(method, path, { query, body, signMode: 'path+query' });
      if (retry.statusCode >= 200 && retry.statusCode < 300) {
        signModeLatched = 'path+query';
        return retry;
      }
      return retry;
    }
    return res;
  }

  async function okJson(method, path, opts) {
    const res = await request(method, path, opts);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw httpError(method, path, res.statusCode, res.json, res.text);
    }
    return res.json;
  }

  async function getNflLeagueEventsText() {
    const path = '/v2/leagues/nfl/events?limit=80&active=true&closed=false';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetchImpl(gateway + path, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.status < 200 || res.status >= 300) {
        throw httpError('GET', path, res.status, parseBody(text), text);
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getMarketBySlug(slug) {
    const path = '/v1/market/slug/' + encodeURIComponent(slug);
    try {
      const pub = await fetchImpl(gateway + path, { method: 'GET', headers: { accept: 'application/json' } });
      const pubText = await pub.text();
      if (pub.status >= 200 && pub.status < 300) {
        const json = parseBody(pubText);
        const market = (json && json.market) || json;
        if (market && (market.marketSides || market.slug)) return market;
      }
    } catch (_) { /* public gateway down — fall through to signed Retail */ }
    const res = await request('GET', path);
    if (res.statusCode === 404) return null;
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw httpError('GET', path, res.statusCode, res.json, res.text);
    }
    return (res.json && res.json.market) || res.json;
  }

  return {
    request,
    getMarketBySlug,
    getNflLeagueEventsText,
    listPositions: (query) => okJson('GET', '/v1/portfolio/positions', { query }),
    listActivities: (query) => okJson('GET', '/v1/portfolio/activities', { query }),
    listOpenOrders: (query) => okJson('GET', '/v1/orders/open', { query }),
    getOrder: (orderId) => okJson('GET', '/v1/order/' + encodeURIComponent(orderId)),
    createOrder: (body) => okJson('POST', '/v1/orders', { body }),
    cancelOrder: (orderId, marketSlug) => okJson('POST', '/v1/order/' + encodeURIComponent(orderId) + '/cancel', {
      body: { marketSlug },
    }),
  };
}

module.exports = {
  queryString,
  createPolymarketUsClient,
};
