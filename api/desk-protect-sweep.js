// Adverse Protect poll target for Combo Locks.
// POST /api/desk-protect-sweep
// Header X-Desk-Protect-Secret = DESK_PROTECT_SWEEP_SECRET, or ADMIN_API_SECRET
// when the dedicated name is unset. Body { op: "sweep", mode: "adverse-only" }.
// Same cancel / re-rest as the desk. The secret cannot place or cancel.
// Armed rests only (desk rests are armed by default; an order switched off is
// not in the registry, so it is never touched).
'use strict';

const crypto = require('crypto');
const auth = require('./polymarket-us-auth');
const { createPolymarketUsClient } = require('./polymarket-us-client');
const { createSupabaseProtectStore } = require('../lib/desk-protect-registry');
const { runProtectSweep } = require('../lib/desk-protect-sweep');
const { sendProtectPing } = require('../lib/desk-protect-notify');
const { watcherEventsFromActions } = require('../lib/desk-protect-events');

const MIN_SECRET_LEN = 16;

function headerValue(headers, name) {
  if (!headers) return '';
  const direct = headers[name] || headers[name.toLowerCase()];
  if (direct) return Array.isArray(direct) ? String(direct[0]) : String(direct);
  const found = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return found ? String(headers[found]) : '';
}

function cleanSecret(raw) {
  const s = String(raw || '').trim();
  if (s.length < MIN_SECRET_LEN) return '';
  if (/[\r\n]/.test(s)) return '';
  return s;
}

function acceptedSecrets(env = process.env) {
  const dedicated = cleanSecret(env.DESK_PROTECT_SWEEP_SECRET);
  const admin = cleanSecret(env.ADMIN_API_SECRET);
  if (dedicated && admin && dedicated !== admin) return [dedicated, admin];
  if (dedicated) return [dedicated];
  if (admin) return [admin];
  return [];
}

function safeEqual(provided, secret) {
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sweepAuthorized(req, env = process.env) {
  const provided = cleanSecret(headerValue(req && req.headers, 'x-desk-protect-secret')
    || headerValue(req && req.headers, 'x-admin-secret'));
  if (!provided) return false;
  return acceptedSecrets(env).some((secret) => safeEqual(provided, secret));
}

let sharedStore = null;
function defaultStore() {
  if (!sharedStore) sharedStore = createSupabaseProtectStore();
  return sharedStore;
}

const defaults = {
  creds: () => auth.readPolymarketCreds(process.env),
  protectStore: defaultStore,
  notify: (text) => sendProtectPing(text),
  now: () => Date.now(),
  runSweep: runProtectSweep,
  clientFromCreds(creds) {
    return createPolymarketUsClient({
      keyId: creds.keyId,
      secretKey: creds.secretKey,
      apiBase: creds.apiBase,
      gatewayBase: creds.gatewayBase,
      fetchImpl: deps.fetchImpl,
    });
  },
  fetchImpl: (...args) => fetch(...args),
  authorized: sweepAuthorized,
};

let deps = { ...defaults };

function resetDeps() {
  sharedStore = null;
  deps = { ...defaults };
}

function setDeps(patch) {
  deps = { ...deps, ...patch };
}

// Underlying message for the 502 body and the Vercel log, so a missing table,
// bad import, or Polymarket error is visible to the poller. Secrets and
// credentials are not in these messages; clip length just in case.
function sweepErrorDetail(err) {
  const raw = err && (err.message || err.code) ? String(err.message || err.code) : String(err || 'unknown error');
  return raw.replace(/\s+/g, ' ').trim().slice(0, 300) || 'unknown error';
}

function json(res, status, body) {
  res.status(status).json(body);
}

function parseBody(req) {
  const raw = req && req.body;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw) {
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }
  return {};
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  if (!deps.authorized(req)) {
    json(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }
  const body = parseBody(req);
  const op = String(body.op || '').trim().toLowerCase();
  const mode = String(body.mode || 'adverse-only').trim().toLowerCase();
  if (op !== 'sweep' || mode !== 'adverse-only') {
    json(res, 400, { ok: false, error: 'Adverse sweep only.' });
    return;
  }
  const creds = deps.creds();
  if (!creds.ok) {
    json(res, 503, auth.missingKeysError(creds.missing));
    return;
  }
  try {
    const swept = await deps.runSweep({
      client: deps.clientFromCreds(creds),
      store: deps.protectStore(),
      notify: deps.notify,
      now: deps.now,
    });
    if (!swept || swept.ok === false) {
      json(res, (swept && swept.status) || 503, { ok: false, error: (swept && swept.error) || 'Sweep failed' });
      return;
    }
    const events = watcherEventsFromActions(swept.actions, body.ackedIds);
    json(res, 200, { ok: true, events });
  } catch (err) {
    const status = err && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
    const detail = sweepErrorDetail(err);
    console.error('[desk-protect-sweep] sweep failed:', detail);
    json(res, status, { ok: false, error: 'Sweep failed', detail });
  }
}

handler.config = { maxDuration: 15 };
module.exports = handler;
module.exports.config = { maxDuration: 15 };
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
module.exports._sweepAuthorized = sweepAuthorized;
module.exports._sweepErrorDetail = sweepErrorDetail;
