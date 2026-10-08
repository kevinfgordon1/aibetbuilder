// Combo Locks testers — exchange-key validation helpers (server only).
//
// Secrets passed through here are NEVER logged, echoed, or returned: callers
// get back only { ok, venue, hint, scopes, scopeStatus, warnings } or a
// generic error message. The key itself is stored by the service-role RPC
// combo_exchange_key_put (Supabase Vault).
'use strict';

const crypto = require('crypto');
const { normalizePem } = require('./kalshi-sign');
const pmAuth = require('./polymarket-us-auth');

const VENUES = Object.freeze(['kalshi', 'polymarket_us']);
// Kevin (owner) and his alt trade through the server keys on Railway.
const KEVIN_IDS = Object.freeze([
  '79ae1610-097e-4b46-a622-1e952f18e936',
  '968efed8-54db-48a6-808b-194a7a03a4cb',
]);
const DEFAULT_KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const MAX_SECRET_LEN = 8192;

class KeyError extends Error {
  constructor(message, status = 400, code = 'invalid_key') { super(message); this.status = status; this.code = code; }
}

function keyHint(keyId) {
  const s = String(keyId || '').replace(/\s+/g, '');
  return s.length >= 4 ? s.slice(-4) : '';
}

function maskedLabel(venue, hint) {
  const name = venue === 'kalshi' ? 'Kalshi' : 'Polymarket US';
  return `${name} connected ••••${hint || ''}`;
}

function cleanKeyId(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^[A-Za-z0-9._:\-]{8,128}$/.test(s)) throw new KeyError('That key ID does not look right. Paste the Key ID shown when you created the key.');
  return s;
}

// --- Kalshi -----------------------------------------------------------------

// RSA only: the worker signs with RSA-PSS (Kalshi web-generated keys are RSA).
function parseKalshiPem(raw) {
  const s = String(raw == null ? '' : raw);
  if (!s.trim() || s.length > MAX_SECRET_LEN) throw new KeyError('Paste the full private key file contents (-----BEGIN … PRIVATE KEY-----).');
  const pem = normalizePem(s);
  let key;
  try { key = crypto.createPrivateKey(pem); } catch (_) {
    throw new KeyError('That private key could not be read. Paste the whole .key/.txt file Kalshi gave you, including the BEGIN/END lines.');
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw new KeyError('Please create an RSA key (the default in Kalshi’s web app). Ed25519 keys are not supported yet.');
  }
  return { pem, key };
}

function kalshiHeaders(keyId, key, method, signPath, ts = Date.now()) {
  const msg = String(ts) + method + signPath;
  const sig = crypto.sign('sha256', Buffer.from(msg, 'utf8'), {
    key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');
  return { 'KALSHI-ACCESS-KEY': keyId, 'KALSHI-ACCESS-TIMESTAMP': String(ts), 'KALSHI-ACCESS-SIGNATURE': sig, Accept: 'application/json' };
}

// Decide whether a Kalshi key's scopes are acceptable for a tester.
// Needs read + write::trade (quotes/orders/RFQs); must NOT carry the broad
// `write` scope or write::transfer (moving money), and must not be locked to a
// sub-account (restricted keys cannot open the RFQ WebSocket).
function assessKalshiKey(entry, regionExpTs, nowSec = Math.floor(Date.now() / 1000)) {
  const warnings = [];
  if (!entry) {
    return { ok: true, scopes: [], scopeStatus: 'unverified', warnings: ['Kalshi did not list this key’s scopes; it is flagged for owner review.'] };
  }
  const scopes = Array.isArray(entry.scopes) ? entry.scopes.map(String) : [];
  if (scopes.includes('write::transfer') || scopes.includes('write')) {
    throw new KeyError('This key can move money (Kalshi “Write”/transfer permission). Delete it and create a new key with only Read + Trade.', 400, 'transfer_scope');
  }
  if (!scopes.includes('write::trade')) throw new KeyError('This key cannot trade. Create a key with Read + Trade permissions.', 400, 'missing_trade');
  if (!scopes.includes('read')) throw new KeyError('This key cannot read your portfolio. Create a key with Read + Trade permissions.', 400, 'missing_read');
  const extra = scopes.filter((s) => !['read', 'write::trade', 'read::portfolio_balance'].includes(s));
  if (extra.length) throw new KeyError('This key has extra permissions. Create a key with only Read + Trade.', 400, 'extra_scope');
  if (entry.subaccount != null) {
    throw new KeyError('This key is locked to a sub-account, which Kalshi blocks from RFQ quoting. Create an unrestricted Read + Trade key.', 400, 'subaccount_key');
  }
  if (regionExpTs != null && Number(regionExpTs) < nowSec) {
    throw new KeyError('Kalshi says your location check for API trading has lapsed. Re-verify your location in the Kalshi app, then try again.', 400, 'attestation_lapsed');
  }
  if (regionExpTs == null) warnings.push('Kalshi has no API location check on file for this account yet; sports trading may be refused until you complete it in the Kalshi app.');
  return { ok: true, scopes, scopeStatus: 'ok', warnings };
}

async function verifyKalshiKey({ keyId, secret, env = process.env, fetchImpl = fetch }) {
  const id = cleanKeyId(keyId);
  const { pem, key } = parseKalshiPem(secret);
  const base = String(env.KALSHI_API_BASE || DEFAULT_KALSHI_BASE).replace(/\/+$/, '');
  const url = `${base}/api_keys`;
  const signPath = new URL(url).pathname;
  let res;
  try {
    res = await fetchImpl(url, { method: 'GET', headers: kalshiHeaders(id, key, 'GET', signPath), signal: AbortSignal.timeout(8000) });
  } catch (_) {
    throw new KeyError('Could not reach Kalshi to check the key. Try again in a minute.', 502, 'venue_unreachable');
  }
  if (res.status === 401 || res.status === 403) throw new KeyError('Kalshi rejected this key ID + private key pair. Check you pasted the matching pair.', 400, 'venue_rejected');
  if (!res.ok) throw new KeyError(`Kalshi returned ${res.status} while checking the key. Try again shortly.`, 502, 'venue_error');
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  const list = body && Array.isArray(body.api_keys) ? body.api_keys : [];
  const entry = list.find((k) => k && String(k.api_key_id) === id) || null;
  const a = assessKalshiKey(entry, body ? body.api_key_region_expiration_ts : null);
  return { venue: 'kalshi', keyId: id, secret: pem, hint: keyHint(id), ...a };
}

// --- Polymarket US ----------------------------------------------------------

// The Retail API has no scope settings and no deposit/withdraw endpoints, so
// a valid key can trade + read but not move funds. We confirm the pair works
// with a read-only call and mark scopes unverified (nothing to introspect).
async function verifyPolymarketKey({ keyId, secret, env = process.env, fetchImpl = fetch }) {
  const id = cleanKeyId(keyId);
  const sec = String(secret == null ? '' : secret).trim();
  if (!sec || sec.length > MAX_SECRET_LEN) throw new KeyError('Paste the Secret Key shown when you created the Polymarket US key.');
  try {
    if (!pmAuth.privateKeyFromSecret(sec)) throw new Error('bad');
  } catch (_) {
    throw new KeyError('That Polymarket US secret key could not be read. Paste it exactly as shown (base64).');
  }
  const base = String(env.POLYMARKET_API_BASE || 'https://api.polymarket.us').replace(/\/+$/, '');
  const path = '/v1/portfolio/positions';
  let res;
  try {
    res = await fetchImpl(base + path, {
      method: 'GET',
      headers: { ...pmAuth.authHeaders({ keyId: id, secretKey: sec, method: 'GET', path }), Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (_) {
    throw new KeyError('Could not reach Polymarket US to check the key. Try again in a minute.', 502, 'venue_unreachable');
  }
  if (res.status === 401 || res.status === 403) throw new KeyError('Polymarket US rejected this key ID + secret. Check you pasted the matching pair.', 400, 'venue_rejected');
  if (!res.ok) throw new KeyError(`Polymarket US returned ${res.status} while checking the key. Try again shortly.`, 502, 'venue_error');
  return {
    venue: 'polymarket_us', keyId: id, secret: sec, hint: keyHint(id),
    ok: true, scopes: ['retail_api'], scopeStatus: 'unverified',
    warnings: ['Polymarket US keys have no permission settings; the Retail API cannot move funds. RFQ quoting needs Polymarket to enable RFQ access on your account.'],
  };
}

function verifyKey(venue, args) {
  if (venue === 'kalshi') return verifyKalshiKey(args);
  if (venue === 'polymarket_us') return verifyPolymarketKey(args);
  throw new KeyError('Unknown exchange.');
}

// Public shape of a stored key row (no key id, no secret, no vault id).
function publicKeyRow(row) {
  if (!row) return { connected: false };
  return {
    connected: true,
    hint: row.key_hint || '',
    label: maskedLabel(row.venue, row.key_hint),
    scopeStatus: row.scope_status || 'unverified',
    verifiedAt: row.verified_at || null,
    updatedAt: row.updated_at || null,
  };
}

module.exports = {
  VENUES, KEVIN_IDS, KeyError, keyHint, maskedLabel, cleanKeyId, parseKalshiPem,
  assessKalshiKey, verifyKalshiKey, verifyPolymarketKey, verifyKey, publicKeyRow, kalshiHeaders,
};
