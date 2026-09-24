// Polymarket US Retail API request signing.
// Headers: X-PM-Access-Key, X-PM-Timestamp, X-PM-Signature.
// Signature is Ed25519 over `{timestamp}{method}{path}`. Official docs and
// the combo-worker signer use the pathname only (no query). Secret is
// base64; the first 32 bytes are the seed.
// This is NOT CLOB L1 (EIP-712) or L2 (HMAC POLY_* headers).
'use strict';

const crypto = require('crypto');

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function normalizeCred(value) {
  let s = String(value == null ? '' : value).trim();
  if (!s) return '';
  const first = s.charCodeAt(0);
  const last = s.charCodeAt(s.length - 1);
  if ((first === 34 && last === 34) || (first === 39 && last === 39)) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function seedFromSecret(secretKey) {
  const s = normalizeCred(secretKey);
  if (!s) return null;
  const raw = Buffer.from(s, 'base64');
  if (raw.length < 32) return null;
  return raw.subarray(0, 32);
}

function privateKeyFromSecret(secretKey) {
  const seed = seedFromSecret(secretKey);
  if (!seed) return null;
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

function signPath(path) {
  if (path == null) return '/';
  const s = String(path);
  const q = s.indexOf('?');
  return q === -1 ? s : s.slice(0, q);
}

function sign(secretKey, tsMs, method, path, { includeQuery = false } = {}) {
  const key = privateKeyFromSecret(secretKey);
  if (!key) throw new Error('invalid Polymarket secret key');
  const msgPath = includeQuery ? String(path || '/') : signPath(path);
  const msg = String(tsMs) + String(method || '').toUpperCase() + msgPath;
  return crypto.sign(null, Buffer.from(msg, 'utf8'), key).toString('base64');
}

function authHeaders({ keyId, secretKey, method, path, ts = Date.now(), includeQuery = false } = {}) {
  const timestamp = String(ts);
  return {
    'X-PM-Access-Key': normalizeCred(keyId),
    'X-PM-Timestamp': timestamp,
    'X-PM-Signature': sign(secretKey, timestamp, method, path, { includeQuery }),
  };
}

function readPolymarketCreds(env) {
  const e = env || process.env;
  const keyId = normalizeCred(e.POLYMARKET_KEY_ID);
  const secretKey = normalizeCred(e.POLYMARKET_SECRET_KEY);
  const missing = [];
  if (!keyId) missing.push('POLYMARKET_KEY_ID');
  if (!secretKey || !seedFromSecret(secretKey)) missing.push('POLYMARKET_SECRET_KEY');
  return {
    keyId,
    secretKey,
    missing,
    ok: missing.length === 0,
    apiBase: String(e.POLYMARKET_API_BASE || 'https://api.polymarket.us').replace(/\/+$/, ''),
    gatewayBase: String(e.POLYMARKET_GATEWAY_BASE || 'https://gateway.polymarket.us').replace(/\/+$/, ''),
  };
}

function missingKeysError(missing) {
  const names = (missing && missing.length ? missing : ['POLYMARKET_KEY_ID', 'POLYMARKET_SECRET_KEY']).join(' and ');
  return {
    ok: false,
    error: 'Polymarket US API keys are not configured on this server. Add ' + names
      + ' to Vercel (Production + Preview). Same names as Railway combo-worker. Do not use CLOB L1/L2 keys. No Railway deploy is required for this desk.',
    missingEnv: missing && missing.length ? missing : ['POLYMARKET_KEY_ID', 'POLYMARKET_SECRET_KEY'],
  };
}

function redactText(text) {
  return String(text == null ? '' : text)
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

module.exports = {
  normalizeCred,
  seedFromSecret,
  privateKeyFromSecret,
  signPath,
  sign,
  authHeaders,
  readPolymarketCreds,
  missingKeysError,
  redactText,
  PKCS8_ED25519_PREFIX,
};
