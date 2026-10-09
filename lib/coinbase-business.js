// Coinbase Business Checkouts API (USDC) — server-only helpers.
//
// Coinbase Commerce (api.commerce.coinbase.com, X-CC-Api-Key, X-CC-Webhook-Signature)
// was shut down on March 31, 2026 and folded into Coinbase Business. The
// supported replacement is the Checkouts API:
//   POST https://business.coinbase.com/api/v1/checkouts   (Bearer CDP JWT)
//   GET  https://business.coinbase.com/api/v1/checkouts/{id}
// Webhooks are CDP webhook subscriptions signed with X-Hook0-Signature
// (t=<unix>,h=<header names>,v1=<hex HMAC-SHA256>).
// Docs: https://docs.cdp.coinbase.com/coinbase-business/checkout-apis/migrate-from-commerce/overview
//
// Env (never logged, never returned to the browser):
//   COINBASE_CDP_API_KEY_ID       CDP Secret API key id
//   COINBASE_CDP_API_KEY_SECRET   CDP Secret API key secret (Ed25519 base64, or EC PEM)
//   COINBASE_WEBHOOK_SECRET       secret from the webhook subscription response
//                                 (COINBASE_COMMERCE_WEBHOOK_SECRET is accepted as an alias)
'use strict';

const crypto = require('crypto');

const API_HOST = 'business.coinbase.com';
const CHECKOUTS_PATH = '/api/v1/checkouts';
const SIGNATURE_HEADER = 'x-hook0-signature';
const MAX_WEBHOOK_AGE_SEC = 5 * 60;

function readEnv(env) {
  const e = env || process.env;
  const s = (k) => (e[k] == null ? '' : String(e[k]).trim());
  return {
    keyId: s('COINBASE_CDP_API_KEY_ID'),
    keySecret: s('COINBASE_CDP_API_KEY_SECRET'),
    webhookSecret: s('COINBASE_WEBHOOK_SECRET') || s('COINBASE_COMMERCE_WEBHOOK_SECRET'),
  };
}

/** Which pieces are configured (booleans only — safe to return to the browser). */
function configStatus(env) {
  const c = readEnv(env);
  const api = !!(c.keyId && c.keySecret);
  const webhook = !!c.webhookSecret;
  return { api, webhook, ready: api && webhook };
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function privateKeyFrom(secret) {
  const raw = String(secret || '').replace(/\\n/g, '\n').trim();
  if (!raw) throw new Error('missing api key secret');
  if (raw.includes('BEGIN')) {
    return { key: crypto.createPrivateKey(raw), alg: 'ES256' };
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 64 && bytes.length !== 32) throw new Error('api key secret has an unexpected format');
  const seed = bytes.subarray(0, 32);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  return { key: crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }), alg: 'EdDSA' };
}

/** CDP Bearer JWT for one request (valid 120s). */
function buildJwt({ keyId, keySecret, method, host = API_HOST, path, now = Date.now() }) {
  if (!keyId) throw new Error('missing api key id');
  const { key, alg } = privateKeyFrom(keySecret);
  const t = Math.floor(now / 1000);
  const uri = `${String(method).toUpperCase()} ${host}${path}`;
  const header = { alg, typ: 'JWT', kid: keyId, nonce: crypto.randomBytes(16).toString('hex') };
  const claims = { sub: keyId, iss: 'cdp', aud: ['cdp_service'], nbf: t, exp: t + 120, uri, uris: [uri] };
  const signing = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = alg === 'EdDSA'
    ? crypto.sign(null, Buffer.from(signing), key)
    : crypto.sign('sha256', Buffer.from(signing), { key, dsaEncoding: 'ieee-p1363' });
  return `${signing}.${b64url(sig)}`;
}

class CoinbaseError extends Error {
  constructor(message, status) { super(message); this.status = status || 502; }
}

async function call({ env, fetchImpl, method, path, body, idempotencyKey }) {
  const c = readEnv(env);
  if (!c.keyId || !c.keySecret) throw new CoinbaseError('Coinbase is not configured', 503);
  const jwt = buildJwt({ keyId: c.keyId, keySecret: c.keySecret, method, path });
  const headers = { Authorization: `Bearer ${jwt}`, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const f = fetchImpl || fetch;
  const r = await f(`https://${API_HOST}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch (_) { data = null; }
  if (!r.ok) {
    // Status only: Coinbase error bodies can echo request data.
    throw new CoinbaseError(`Coinbase ${method} ${path.split('/').slice(0, 4).join('/')} failed (${r.status})`, 502);
  }
  return data || {};
}

/** Create a USDC checkout. Returns { id, url, status, expiresAt }. */
async function createCheckout({ env, fetchImpl, amountUsd, description, successRedirectUrl, failRedirectUrl, metadata, idempotencyKey, expiresInMin = 60 }) {
  const body = {
    amount: Number(amountUsd).toFixed(2),
    currency: 'USDC',
    network: 'base',
    description,
    expiresAt: new Date(Date.now() + expiresInMin * 60 * 1000).toISOString(),
    successRedirectUrl,
    failRedirectUrl,
    metadata: metadata || {},
  };
  const data = await call({ env, fetchImpl, method: 'POST', path: CHECKOUTS_PATH, body, idempotencyKey: idempotencyKey || crypto.randomUUID() });
  if (!data.id || !data.url) throw new CoinbaseError('Coinbase returned no checkout url', 502);
  return { id: String(data.id), url: String(data.url), status: data.status || 'ACTIVE', expiresAt: data.expiresAt || null, network: data.network || 'base' };
}

async function getCheckout({ env, fetchImpl, id }) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id || ''))) throw new CoinbaseError('bad checkout id', 400);
  return call({ env, fetchImpl, method: 'GET', path: `${CHECKOUTS_PATH}/${id}` });
}

function headerValue(headers, name) {
  if (!headers) return '';
  const want = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === want) {
      const v = headers[k];
      return Array.isArray(v) ? v.join(',') : String(v == null ? '' : v);
    }
  }
  return '';
}

/**
 * Verify X-Hook0-Signature: v1 = hex(HMAC_SHA256(secret, `${t}.${h}.${headerValues}.${rawBody}`)),
 * where headerValues are the listed request headers joined with '.'.
 * Returns { ok, reason }. Constant-time compare; rejects stale timestamps.
 */
function verifyWebhookSignature({ rawBody, headers, secret, nowMs = Date.now(), maxAgeSec = MAX_WEBHOOK_AGE_SEC }) {
  if (!secret) return { ok: false, reason: 'not_configured' };
  const sigHeader = headerValue(headers, SIGNATURE_HEADER);
  if (!sigHeader) return { ok: false, reason: 'missing_signature' };
  const parts = {};
  for (const el of sigHeader.split(',')) {
    const i = el.indexOf('=');
    if (i > 0) parts[el.slice(0, i).trim()] = el.slice(i + 1).trim();
  }
  const t = parts.t;
  const h = parts.h == null ? '' : parts.h;
  const v1 = parts.v1;
  if (!t || !/^\d+$/.test(t) || !v1 || !/^[0-9a-f]+$/i.test(v1)) return { ok: false, reason: 'malformed_signature' };
  const headerValues = h ? h.split(' ').map((n) => headerValue(headers, n)).join('.') : '';
  const signed = `${t}.${h}.${headerValues}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signed, 'utf8').digest();
  const provided = Buffer.from(v1, 'hex');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return { ok: false, reason: 'bad_signature' };
  const age = Math.floor(nowMs / 1000) - Number(t);
  if (age > maxAgeSec || age < -maxAgeSec) return { ok: false, reason: 'stale' };
  return { ok: true };
}

/** Test helper: build a valid header for a body. */
function signForTest({ rawBody, secret, headers = {}, headerNames = ['content-type'], t = Math.floor(Date.now() / 1000) }) {
  const h = headerNames.join(' ');
  const values = headerNames.map((n) => headerValue(headers, n)).join('.');
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${h}.${values}.${rawBody}`, 'utf8').digest('hex');
  return `t=${t},h=${h},v1=${v1}`;
}

module.exports = {
  API_HOST,
  CHECKOUTS_PATH,
  SIGNATURE_HEADER,
  CoinbaseError,
  readEnv,
  configStatus,
  buildJwt,
  createCheckout,
  getCheckout,
  verifyWebhookSignature,
  signForTest,
  headerValue,
};
