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

// Kalshi keys: RSA (signed with RSA-PSS/SHA-256) or Ed25519 (Kalshi's default
// in the web app; signed with plain Ed25519). Both are accepted by the API.
const KALSHI_KEY_TYPES = Object.freeze(['rsa', 'ed25519']);

function pkcs8Armor(raw) {
  const body = String(raw || '').replace(/-----[^-]+-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (!body) return '';
  return `-----BEGIN PRIVATE KEY-----\n${(body.match(/.{1,64}/g) || []).join('\n')}\n-----END PRIVATE KEY-----\n`;
}

function parseKalshiPem(raw) {
  const s = String(raw == null ? '' : raw);
  if (!s.trim() || s.length > MAX_SECRET_LEN) throw new KeyError('Paste the full private key file contents (-----BEGIN … PRIVATE KEY-----).');
  let pem = normalizePem(s);
  let key = null;
  try { key = crypto.createPrivateKey(pem); } catch (_) { key = null; }
  // Body pasted without BEGIN/END lines: normalizePem assumes RSA; an Ed25519
  // key is PKCS#8, so retry with the generic PRIVATE KEY armor.
  if (!key && !s.trim().startsWith('-----BEGIN')) {
    const alt = pkcs8Armor(s);
    try { key = crypto.createPrivateKey(alt); pem = alt; } catch (_) { key = null; }
  }
  if (!key) {
    throw new KeyError('That private key could not be read. Paste the whole private key file Kalshi gave you, including the BEGIN/END lines.');
  }
  if (!KALSHI_KEY_TYPES.includes(key.asymmetricKeyType)) {
    throw new KeyError('That is not a Kalshi API key. Create a new key in Kalshi (Ed25519 or RSA both work) and paste its private key.');
  }
  return { pem, key };
}

function kalshiSignature(key, msg) {
  const data = Buffer.from(msg, 'utf8');
  if (key.asymmetricKeyType === 'ed25519') return crypto.sign(null, data, key).toString('base64');
  return crypto.sign('sha256', data, {
    key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');
}

function kalshiHeaders(keyId, key, method, signPath, ts = Date.now()) {
  const msg = String(ts) + method + signPath;
  return { 'KALSHI-ACCESS-KEY': keyId, 'KALSHI-ACCESS-TIMESTAMP': String(ts), 'KALSHI-ACCESS-SIGNATURE': kalshiSignature(key, msg), Accept: 'application/json' };
}

// Kalshi scopes (GET /api_keys). Kalshi's Create API key screen:
//   Broad:     "Read all data" = read        "Full access" = write
//   Granular:  read::portfolio_balance, read::block_trade_accept (both implied by read)
//              "Trade" = write::trade        "Transfers" = write::transfer
//              "Accept block trades" = write::block_trade_accept
//   (API-only: write::fcm_risk.)  Older keys list the same strings (read / write).
// Accepted tester keys (Oct 9 2026, Kevin):
//   Full access:  read + write. Includes every write group (trade, transfer).
//   Granular:     read + write::trade + write::transfer (any read::* is fine).
// Either one turns on auto-funding: combo-worker moves the tester's OWN money
// from Exchange 0 (Default) to Exchange 1 (Combos), up to their cap. Kalshi's
// public API has no withdraw or send-to-another-user endpoint, so neither
// scope can move money off the tester's own account through the API.
//   read + write::trade (no Transfers): still accepted and trades, but
//   auto-funding is off and the tester sees a reconnect note.
// Refused: missing Read or Trade; on granular keys
// write::fcm_risk or any other write::* (Full access already includes them, so
// they are only redundant there); unknown scope strings; sub-account keys.
// write::block_trade_accept is accepted too: Kalshi can expand Full access into granular scopes.
const GRANULAR_OK = Object.freeze(['read', 'write::trade', 'write::transfer', 'write::block_trade_accept']);

function normScopes(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => String(s == null ? '' : s).trim().toLowerCase())
    .filter(Boolean);
}

function classifyKalshiScopes(list) {
  const scopes = normScopes(list);
  const full = scopes.includes('write');
  const known = (s) => s === 'read' || s === 'write' || /^read::[a-z0-9_]+$/.test(s) || /^write::[a-z0-9_]+$/.test(s);
  const extra = full
    ? scopes.filter((s) => !known(s))
    : scopes.filter((s) => !GRANULAR_OK.includes(s) && !/^read::[a-z0-9_]+$/.test(s));
  const missing = [];
  if (!scopes.includes('read')) missing.push('read');
  if (!full && !scopes.includes('write::trade')) missing.push('write::trade');
  const autoFund = full || scopes.includes('write::transfer');
  return { scopes, full, extra, missing, autoFund };
}

// Stored scopes -> does this key let the worker fund the tester's Combos balance?
function kalshiAutoFund(scopes) {
  const s = normScopes(scopes);
  return s.includes('write') || s.includes('write::transfer');
}

const SCOPE_WORDS = {
  write: 'Full access',
  'write::transfer': 'Transfers',
  'write::block_trade_accept': 'Accept block trades',
  'write::fcm_risk': 'FCM risk',
};
const KEY_FIX = 'Create a new key in Kalshi with Full access (simplest), or with Read all data, Trade and Transfers checked, and connect that one.';
const NO_TRANSFER_NOTE = 'Auto-funding is off for this key. To have the site fill your Combos balance for you, reconnect with a key that has Transfers or Full access. Your trades keep working meanwhile.';

// Decide whether a Kalshi key's scopes are acceptable for a tester.
// Also refuses keys locked to a sub-account (restricted keys cannot open the
// RFQ WebSocket) and lapsed location checks.
function assessKalshiKey(entry, regionExpTs, nowSec = Math.floor(Date.now() / 1000)) {
  const warnings = [];
  if (!entry) {
    return { ok: true, scopes: [], scopeStatus: 'unverified', autoFund: false, warnings: ['Kalshi did not list this key’s scopes; it is flagged for owner review. Auto-funding stays off until it is confirmed.'] };
  }
  const c = classifyKalshiScopes(entry.scopes);
  const words = (list) => list.map((s) => SCOPE_WORDS[s] || s).join(' and ');
  if (c.extra.length) throw new KeyError(`This key has extra permissions we don’t use (${words(c.extra)}). ${KEY_FIX}`, 400, 'extra_scope');
  if (c.missing.includes('write::trade')) throw new KeyError(`This key can’t trade (Trade is unchecked). ${KEY_FIX}`, 400, 'missing_trade');
  if (c.missing.includes('read')) throw new KeyError(`This key can’t read your account (Read all data is unchecked). ${KEY_FIX}`, 400, 'missing_read');
  if (entry.subaccount != null) {
    throw new KeyError('This key is locked to a sub-account, which Kalshi blocks from RFQ quoting. Create a new key with Full access (or Read all data, Trade and Transfers) and leave the sub-account blank.', 400, 'subaccount_key');
  }
  if (regionExpTs != null && Number(regionExpTs) < nowSec) {
    throw new KeyError('Kalshi says your location check for API trading has lapsed. Re-verify your location in the Kalshi app, then try again.', 400, 'attestation_lapsed');
  }
  if (regionExpTs == null) warnings.push('Kalshi has no API location check on file for this account yet; sports trading may be refused until you complete it in the Kalshi app.');
  if (!c.autoFund) warnings.push(NO_TRANSFER_NOTE);
  return { ok: true, scopes: c.scopes, scopeStatus: 'ok', autoFund: c.autoFund, warnings };
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
  let a;
  try {
    a = assessKalshiKey(entry, body ? body.api_key_region_expiration_ts : null);
  } catch (e) {
    // Scope names + key type only (never the key id or secret) so a rejected
    // key can be diagnosed later.
    if (e instanceof KeyError) console.warn('[combo-keys] kalshi key refused', e.code, JSON.stringify(normScopes(entry && entry.scopes)), key.asymmetricKeyType);
    throw e;
  }
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
    // Kalshi only: the key can move the tester's own money into Combos.
    ...(row.venue === 'kalshi' ? { autoFund: (row.scope_status === 'ok') && kalshiAutoFund(row.scopes) } : {}),
    verifiedAt: row.verified_at || null,
    updatedAt: row.updated_at || null,
  };
}

module.exports = {
  VENUES, KEVIN_IDS, KeyError, keyHint, maskedLabel, cleanKeyId, parseKalshiPem,
  assessKalshiKey, classifyKalshiScopes, kalshiAutoFund, NO_TRANSFER_NOTE, kalshiSignature, verifyKalshiKey, verifyPolymarketKey, verifyKey, publicKeyRow, kalshiHeaders,
};
