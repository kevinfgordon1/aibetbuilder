// Minimal Kalshi RSA-PSS signer for Combo Locks Probe.
// Same message + padding as combo-worker kalshi-auth.js (timestamp + METHOD +
// /trade-api/v2/... path, no query). Do not clone the worker HTTP pool.
//
// Env (same names as Railway combo-worker):
//   KALSHI_KEY_ID
//   Kalshi_combo_key  or  KALSHI_PRIVATE_KEY
'use strict';

const crypto = require('crypto');

function normalizePem(raw) {
  const src = raw == null ? '' : String(raw);
  let v = src.includes('\\n') ? src.replace(/\\n/g, '\n') : src;
  const t = v.trim();
  if (!t) return '';
  if (t.startsWith('-----BEGIN')) return t.endsWith('-----') ? t + '\n' : t;
  const body = t.replace(/[^A-Za-z0-9+/=]/g, '');
  if (!body) return '';
  const wrapped = (body.match(/.{1,64}/g) || []).join('\n');
  return `-----BEGIN RSA PRIVATE KEY-----\n${wrapped}\n-----END RSA PRIVATE KEY-----\n`;
}

function readKalshiCreds(env) {
  const e = env || process.env;
  const keyId = String(e.KALSHI_KEY_ID || '').trim();
  const pem = normalizePem(e.Kalshi_combo_key || e.KALSHI_PRIVATE_KEY || '');
  const missing = [];
  if (!keyId) missing.push('KALSHI_KEY_ID');
  if (!pem) missing.push('Kalshi_combo_key');
  return { keyId, pem, missing, ok: missing.length === 0 };
}

function signPathOf(urlOrPath) {
  try {
    if (/^https?:\/\//i.test(urlOrPath)) {
      return new URL(urlOrPath).pathname;
    }
  } catch (_) { /* fall through */ }
  const raw = String(urlOrPath || '');
  const noQuery = raw.split('?')[0];
  return noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
}

function isForbiddenKalshiPath(path) {
  const p = String(path || '').toLowerCase();
  return p.includes('/accept') || p.includes('/confirm');
}

function sign(pem, tsMs, method, signPath) {
  const msg = String(tsMs) + String(method || '').toUpperCase() + signPath;
  return crypto.sign('sha256', Buffer.from(msg, 'utf8'), {
    key: pem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');
}

function authHeaders({ keyId, pem, method, signPath, ts }) {
  const useTs = ts != null ? ts : Date.now();
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': String(useTs),
    'KALSHI-ACCESS-SIGNATURE': sign(pem, useTs, method, signPath),
  };
}

function isTimestampExpired(statusCode, text) {
  if (Number(statusCode) !== 401) return false;
  return /timestamp[_\s-]*expired|header[_\s-]*timestamp/i.test(String(text || ''));
}

async function signedFetch(url, {
  method = 'GET',
  headers = {},
  body,
  keyId,
  pem,
  fetchImpl = fetch,
} = {}) {
  const signPath = signPathOf(url);
  if (isForbiddenKalshiPath(signPath)) {
    throw new Error('Probe never accepts or confirms a quote');
  }
  const upper = String(method || 'GET').toUpperCase();
  if (upper !== 'GET' && upper !== 'POST' && upper !== 'DELETE') {
    throw new Error(`Probe forbids ${upper} ${signPath}`);
  }
  const run = async () => {
    const auth = authHeaders({ keyId, pem, method: upper, signPath });
    return fetchImpl(url, {
      method: upper,
      headers: {
        accept: 'application/json',
        ...(body != null ? { 'content-type': 'application/json' } : {}),
        ...headers,
        ...auth,
      },
      body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
  };
  let res = await run();
  if (res && Number(res.status) === 401) {
    let peek = '';
    try {
      peek = typeof res.clone === 'function' ? await res.clone().text() : '';
    } catch (_) { peek = ''; }
    if (isTimestampExpired(res.status, peek)) res = await run();
  }
  return res;
}

module.exports = {
  normalizePem,
  readKalshiCreds,
  signPathOf,
  isForbiddenKalshiPath,
  sign,
  authHeaders,
  isTimestampExpired,
  signedFetch,
};
