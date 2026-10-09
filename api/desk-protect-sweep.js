// Adverse Protect poll target for Combo Locks.
// POST /api/desk-protect-sweep
// Header X-Desk-Protect-Secret = DESK_PROTECT_SWEEP_SECRET, or ADMIN_API_SECRET
// when the dedicated name is unset. Body { op: "sweep", mode: "adverse-only" }.
// Same cancel / re-rest as the desk. The secret cannot place or cancel.
// Armed rests only (desk rests are armed by default; an order switched off is
// not in the registry, so it is never touched).
// Polymarket US rests and Novig rests (market_slug novig:<uuid>) are swept in
// the same call. Novig uses the desk trading key (NOVIG_DESK_*) only.
'use strict';

const crypto = require('crypto');
const auth = require('./polymarket-us-auth');
const { createPolymarketUsClient } = require('./polymarket-us-client');
const { createSupabaseProtectStore } = require('../lib/desk-protect-registry');
const { runProtectSweep } = require('../lib/desk-protect-sweep');
const { sendProtectPing } = require('../lib/desk-protect-notify');
const { watcherEventsFromActions } = require('../lib/desk-protect-events');
const { readNovigDeskCreds } = require('./novig-auth');
const { createNovigClient } = require('./novig-client');
const { runNovigProtectSweep } = require('../lib/desk-protect-sweep-novig');

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
  novigCreds: () => readNovigDeskCreds(process.env),
  runNovigSweep: runNovigProtectSweep,
  novigClientFromCreds(creds) {
    return createNovigClient({
      keyId: creds.keyId,
      privateKey: creds.privateKey,
      apiBase: creds.apiBase,
      fetchImpl: deps.fetchImpl,
    });
  },
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
  const novigCreds = deps.novigCreds ? deps.novigCreds() : { ok: false };
  if (!creds.ok && !novigCreds.ok) {
    json(res, 503, auth.missingKeysError(creds.missing));
    return;
  }
  const runs = [];
  if (creds.ok) {
    runs.push({
      venue: 'polymarket-us',
      promise: Promise.resolve().then(() => deps.runSweep({
        client: deps.clientFromCreds(creds),
        store: deps.protectStore(),
        notify: deps.notify,
        now: deps.now,
      })),
    });
  }
  if (novigCreds.ok) {
    runs.push({
      venue: 'novig',
      promise: Promise.resolve().then(() => deps.runNovigSweep({
        client: deps.novigClientFromCreds(novigCreds),
        store: deps.protectStore(),
        notify: deps.notify,
        now: deps.now,
      })),
    });
  }
  const settled = await Promise.allSettled(runs.map((r) => r.promise));
  const actions = [];
  const errors = {};
  let firstFail = null;
  let okCount = 0;
  settled.forEach((result, i) => {
    const venue = runs[i].venue;
    if (result.status === 'rejected') {
      const err = result.reason;
      const detail = sweepErrorDetail(err);
      console.error('[desk-protect-sweep] ' + venue + ' sweep failed:', detail);
      errors[venue] = detail;
      if (!firstFail) {
        const status = err && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
        firstFail = { status, body: { ok: false, error: 'Sweep failed', detail } };
      }
      return;
    }
    const swept = result.value;
    if (!swept || swept.ok === false) {
      errors[venue] = (swept && swept.error) || 'Sweep failed';
      if (!firstFail) firstFail = { status: (swept && swept.status) || 503, body: { ok: false, error: (swept && swept.error) || 'Sweep failed' } };
      return;
    }
    okCount += 1;
    for (const a of swept.actions || []) actions.push(a);
  });
  if (!okCount && firstFail) {
    json(res, firstFail.status, firstFail.body);
    return;
  }
  const events = watcherEventsFromActions(actions, body.ackedIds);
  const out = { ok: true, events };
  if (Object.keys(errors).length) out.errors = errors;
  json(res, 200, out);
}

handler.config = { maxDuration: 15 };
module.exports = handler;
module.exports.config = { maxDuration: 15 };
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
module.exports._sweepAuthorized = sweepAuthorized;
module.exports._sweepErrorDetail = sweepErrorDetail;
