// Signed Novig v3 HTTP client for the Live Trading Desk.
// Trading / trading::read key only. Catalog books may use public routes when useful.
'use strict';

const { signedHeaders, locationErrorText, normalizePem, loadPrivateKey } = require('./novig-auth');

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
  // Canonical order for signing: sort by name then value (encode after build for sign).
  const pairs = [];
  usp.forEach((value, name) => { pairs.push([name, value]); });
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([n, v]) => encodeURIComponent(n).replace(/%20/g, '+') + '=' + encodeURIComponent(v).replace(/%20/g, '+')).join('&');
}

function parseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

function httpError(method, path, statusCode, json, text) {
  const code = json && (json.code || json.error_code || json.errorCode);
  const raw = json && typeof json === 'object'
    ? (json.message || json.error || json.reason || '')
    : '';
  let msg = String(raw || text || '').slice(0, 400);
  if (Number(statusCode) === 451 || /GEOLOCATION|RESTRICTED_|ANONYMIZED_NETWORK/i.test(String(code || ''))) {
    msg = locationErrorText(code, msg);
  }
  const err = new Error('Novig ' + method + ' ' + path + ' ' + statusCode + (msg ? ' ' + msg : ''));
  err.statusCode = statusCode;
  err.code = code || null;
  err.publicMessage = msg;
  err.rateLimited = Number(statusCode) === 429 || code === 'RATE_LIMIT_EXCEEDED';
  err.locationBlocked = Number(statusCode) === 451;
  return err;
}

function createNovigClient({
  keyId,
  privateKey,
  privateKeyPem,
  apiBase = 'https://api.novig.com',
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  const origin = String(apiBase || 'https://api.novig.com').replace(/\/$/, '');
  const key = privateKey || loadPrivateKey(normalizePem(privateKeyPem));
  if (!keyId || !key) throw new Error('Novig client needs keyId and private key');

  async function request(method, path, { query, body, publicRoute = false } = {}) {
    const qsObj = query || null;
    // Build query in a stable way for both URL and signature.
    let qs = '';
    if (qsObj) {
      const entries = [];
      for (const [k, v] of Object.entries(qsObj)) {
        if (v == null || v === '') continue;
        if (Array.isArray(v)) v.forEach((item) => { if (item != null && item !== '') entries.push([String(k), String(item)]); });
        else entries.push([String(k), String(v)]);
      }
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
      // For the URL, use standard encoding; signing uses NOVIG canonicalization from the raw query string we put after ?.
      qs = entries.map(([n, v]) => {
        const encN = encodeURIComponent(n).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
        const encV = encodeURIComponent(v).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
        return encN + '=' + encV;
      }).join('&');
    }
    const rawBody = body == null ? '' : JSON.stringify(body);
    const headers = { accept: 'application/json' };
    if (rawBody) headers['content-type'] = 'application/json';
    if (!publicRoute) {
      Object.assign(headers, signedHeaders({
        keyId,
        privateKey: key,
        method,
        path,
        query: qs,
        body: rawBody,
        nowMs: now(),
      }));
    }
    const url = origin + path + (qs ? '?' + qs : '');
    const res = await fetchImpl(url, {
      method,
      headers,
      body: rawBody || undefined,
    });
    const text = await res.text();
    const json = parseBody(text);
    return { statusCode: res.status, json, text, headers: res.headers };
  }

  async function okJson(method, path, opts) {
    const res = await request(method, path, opts);
    if (res.statusCode === 304) return null;
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw httpError(method, path, res.statusCode, res.json, res.text);
    }
    return res.json;
  }

  return {
    request,
    echo: (body) => okJson('POST', '/v3/echo', { body: body || { ping: true } }),
    listMarkets: (query) => okJson('GET', '/v3/catalog/markets', { query }),
    getMarket: (id) => okJson('GET', '/v3/catalog/markets/' + encodeURIComponent(id)),
    getBook: (id, query) => okJson('GET', '/v3/catalog/markets/' + encodeURIComponent(id) + '/book', { query }),
    listEvents: (query) => okJson('GET', '/v3/catalog/events', { query }),
    // Public fallbacks (no key) for slate when useful
    publicListMarkets: (query) => okJson('GET', '/v3/public/catalog/markets', { query, publicRoute: true }),
    publicListEvents: (query) => okJson('GET', '/v3/public/catalog/events', { query, publicRoute: true }),
    publicGetBook: (id, query) => okJson('GET', '/v3/public/catalog/markets/' + encodeURIComponent(id) + '/book', { query, publicRoute: true }),
    // Answers { seq, open: OpenOrder[] } (OrdersSnapshot). Use openOrdersFrom() to read it.
    listOpenOrders: () => okJson('GET', '/v3/account/orders'),
    getOrder: (orderId) => okJson('GET', '/v3/orders/' + encodeURIComponent(orderId)),
    getEvent: (eventId) => okJson('GET', '/v3/catalog/events/' + encodeURIComponent(eventId)),
    listPositions: () => okJson('GET', '/v3/portfolio/positions'),
    listFills: (query) => okJson('GET', '/v3/portfolio/fills', { query }),
    placeOrder: (body) => okJson('POST', '/v3/orders', { body }),
    cancelOrder: (orderId) => okJson('DELETE', '/v3/orders/' + encodeURIComponent(orderId)),
    cancelAll: (filter) => okJson('DELETE', '/v3/orders', { body: filter || {} }),
    getBalance: () => okJson('GET', '/v3/account/subaccounts/' + encodeURIComponent(keyId) + '/balance'),
    wsUrl() {
      const u = new URL(origin);
      u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
      u.pathname = '/v3/ws';
      u.search = '';
      u.hash = '';
      return u.toString();
    },
  };
}

// GET /v3/account/orders answers an OrdersSnapshot: { seq, open: [...] }.
// Older code read .items / .orders, which do not exist, and counted 0.
function openOrdersFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.open)) return payload.open;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.orders)) return payload.orders;
  return [];
}

module.exports = {
  createNovigClient,
  openOrdersFrom,
  queryString,
  httpError,
};
