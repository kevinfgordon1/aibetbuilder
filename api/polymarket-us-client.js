// Signed Polymarket US Retail HTTP client (api.polymarket.us).
// Public market metadata uses gateway.polymarket.us and is not signed.
// No WebSocket, no CLOB. Callers inject fetchImpl in tests.
//
// When POLY_RELAY_URL and POLY_RELAY_SECRET are both set, api.polymarket.us
// and gateway.polymarket.us requests go to that Railway origin with the same
// method, body, and X-PM-* headers. Signing stays here (Ed25519 over
// timestamp + METHOD + path). A relay 502/503/504, a relay-owned 401/403,
// or a network failure retries that one request directly.
'use strict';

const { authHeaders, redactText } = require('./polymarket-us-auth');

const RELAY_HOSTS = new Set(['api.polymarket.us', 'gateway.polymarket.us']);

function readRelayConfig(env) {
  const source = env || process.env;
  let url = String(source.POLY_RELAY_URL || '').trim().replace(/\/+$/, '');
  let secret = String(source.POLY_RELAY_SECRET || '').trim();
  if ((secret.startsWith('"') && secret.endsWith('"')) || (secret.startsWith("'") && secret.endsWith("'"))) {
    secret = secret.slice(1, -1).trim();
  }
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim().replace(/\/+$/, '');
  }
  if (!url || !secret) return null;
  return { origin: url, secret };
}

function headerMap(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => { out[key] = value; });
    return out;
  }
  return Object.assign(out, headers);
}

function relayOwnedReason(status, text) {
  if (status !== 401 && status !== 403) return '';
  let json = null;
  try { json = JSON.parse(text); } catch (_) { return ''; }
  if (!json || json.ok !== false || typeof json.error !== 'string') return '';
  if (status === 401 && json.error === 'unauthorized') return '401 unauthorized';
  if (status === 403 && json.error === 'upstream_not_allowed') return '403 upstream_not_allowed';
  return '';
}

function replayResponse(status, text, headers) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text: async () => text,
  };
}

function warnFallback(method, host, path, reason) {
  console.warn(
    '[poly-relay] falling back to direct Polymarket after '
    + reason + ' (' + method + ' ' + host + path + ')',
  );
}

function createRelayFetch(directFetch, env) {
  const call = typeof directFetch === 'function' ? directFetch : fetch;
  return async function relayFetch(url, init) {
    const cfg = readRelayConfig(env);
    let parsed;
    try { parsed = new URL(String(url)); } catch (_) { return call(url, init); }
    if (!cfg || !RELAY_HOSTS.has(parsed.hostname)) return call(url, init);

    const headers = headerMap(init && init.headers);
    headers['X-Poly-Relay-Secret'] = cfg.secret;
    headers['X-Poly-Relay-Host'] = parsed.hostname;
    const method = (init && init.method) || 'GET';
    const relayInit = {
      method,
      headers,
      body: init && init.body,
      signal: init && init.signal,
    };
    const relayUrl = cfg.origin + parsed.pathname + parsed.search;
    let res;
    try {
      res = await call(relayUrl, relayInit);
    } catch (_) {
      warnFallback(method, parsed.hostname, parsed.pathname, 'network');
      return call(url, init);
    }

    const status = Number(res && res.status);
    if (status === 502 || status === 503 || status === 504) {
      warnFallback(method, parsed.hostname, parsed.pathname, 'status ' + status);
      return call(url, init);
    }
    if (status === 401 || status === 403) {
      let text = '';
      try {
        text = typeof res.text === 'function' ? await res.text() : '';
      } catch (_) {
        warnFallback(method, parsed.hostname, parsed.pathname, 'unreadable ' + status);
        return call(url, init);
      }
      const why = relayOwnedReason(status, text);
      if (why) {
        warnFallback(method, parsed.hostname, parsed.pathname, why);
        return call(url, init);
      }
      return replayResponse(status, text, res.headers);
    }
    return res;
  };
}

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
  fetchImpl: directFetch = fetch,
} = {}) {
  const fetchImpl = createRelayFetch(directFetch);
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

  async function getMarketBbo(slug) {
    const path = '/v1/markets/' + encodeURIComponent(slug) + '/bbo';
    try {
      const pub = await fetchImpl(gateway + path, { method: 'GET', headers: { accept: 'application/json' } });
      const pubText = await pub.text();
      if (pub.status >= 200 && pub.status < 300) {
        const json = parseBody(pubText);
        if (json && (json.marketData || json.bestBid || json.bestAsk)) return json;
      }
    } catch (_) { /* public gateway down — fall through to signed Retail */ }
    const res = await request('GET', path);
    if (res.statusCode === 404) return null;
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw httpError('GET', path, res.statusCode, res.json, res.text);
    }
    return res.json;
  }

  return {
    request,
    getMarketBySlug,
    getMarketBbo,
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
  createRelayFetch,
  createPolymarketUsClient,
};
