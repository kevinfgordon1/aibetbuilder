// ─────────────────────────────────────────────────────────────────────────
// api/kalshi-verify.js — ONE-OFF, READ-ONLY access check for the Kalshi combo
// auto-quoter. Confirms (a) the API key authenticates, and (b) whether the
// account can see the RFQ / communications system. DELETE after use.
//
// SAFETY: issues only signed GET requests. Never POSTs, never creates an RFQ or
// quote, never places/cancels anything. Returns booleans + HTTP status codes
// only — no balances, positions, or account details.
//
// Secrets: the PRIVATE KEY comes from a Vercel env var (never source/chat). The
// public Key ID is hardcoded below (it is public and safe). The endpoint reads
// the private key from whichever of these env var names exists:
//   Kalshi_combo_key | KALSHI_PRIVATE_KEY | KALSHI_COMBO_API_KEY | KALSHI_COMBO_KEY
// CJS (api/package.json commonjs).
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const crypto = require('crypto');

const BASE = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
const PREFIX = '/trade-api/v2';
const KEY_ID = process.env.KALSHI_KEY_ID || '78b2dafe-3b8b-46b4-b416-456376016448'; // public

function getPem() {
  const names = ['Kalshi_combo_key', 'KALSHI_PRIVATE_KEY', 'KALSHI_COMBO_API_KEY', 'KALSHI_COMBO_KEY'];
  for (const n of names) {
    const raw = process.env[n];
    if (raw) { const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw; return { pem, raw, name: n }; }
  }
  return { pem: '', raw: '', name: null };
}
// Safe diagnostics only — NEVER exposes key material (header lines + shape only).
function diag(raw) {
  const t = (raw || '').trim();
  return {
    length: raw ? raw.length : 0,
    startsWithBegin: t.startsWith('-----BEGIN'),
    endsWithEnd: t.endsWith('KEY-----'),
    looksLikeUuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F-]+$/.test(t),
    hasRealNewlines: (raw || '').includes('\n'),
    hasEscapedNewlines: (raw || '').includes('\\n'),
    firstChars: t.slice(0, 11),   // e.g. "-----BEGIN " (public header) or start of a UUID
  };
}

function sign(pem, tsMs, method, signPath) {
  const msg = String(tsMs) + method.toUpperCase() + signPath;
  return crypto.sign('sha256', Buffer.from(msg, 'utf8'), {
    key: pem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');
}

async function probe(pem, endpoint) {
  const signPath = PREFIX + endpoint, ts = Date.now();
  let headers;
  try {
    headers = {
      'KALSHI-ACCESS-KEY': KEY_ID,
      'KALSHI-ACCESS-TIMESTAMP': String(ts),
      'KALSHI-ACCESS-SIGNATURE': sign(pem, ts, 'GET', signPath),
      'accept': 'application/json',
    };
  } catch (e) { return { endpoint, error: 'signing_failed: ' + (e && e.message || e) }; }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(BASE + endpoint, { method: 'GET', headers, signal: ctrl.signal });
    clearTimeout(t);
    return { endpoint, status: res.status, ok: res.ok }; // status only — no body/balance
  } catch (e) { return { endpoint, error: 'request_failed: ' + (e && e.message || e) }; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Optional lock: only enforced if KALSHI_VERIFY_TOKEN is set in env.
  if (process.env.KALSHI_VERIFY_TOKEN) {
    const token = (req.query && req.query.token) || '';
    if (token !== process.env.KALSHI_VERIFY_TOKEN) { res.status(401).json({ error: 'bad_token' }); return; }
  }
  const { pem, raw, name } = getPem();
  const config = { keyIdPresent: !!KEY_ID, privateKeyEnvVar: name, privateKeyLooksPem: /BEGIN [A-Z ]*PRIVATE KEY/.test(pem), diagnostics: diag(raw) };
  if (!pem) { res.status(200).json({ config, error: 'no_private_key_env', note: 'set your private key in a Vercel env var (e.g. Kalshi_combo_key)' }); return; }

  const endpoints = ['/portfolio/balance', '/communications/rfqs', '/communications/quotes', '/portfolio/fills'];
  const results = [];
  for (const e of endpoints) results.push(await probe(pem, e));

  const balance = results.find(r => r.endpoint === '/portfolio/balance');
  const rfqs = results.find(r => r.endpoint === '/communications/rfqs');
  const verdict = {
    authWorks: !!(balance && balance.ok),
    canSeeRfqSystem: !!(rfqs && rfqs.ok),
    rfqStatus: rfqs && (rfqs.status || rfqs.error),
  };
  res.status(200).json({ config, verdict, results });
};
