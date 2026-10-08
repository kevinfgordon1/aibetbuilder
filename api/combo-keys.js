// /api/combo-keys — a Combo Locks tester connects THEIR OWN exchange key.
//
//   GET     -> { approved, paused, caps, venues: { kalshi, polymarket_us } }
//              masked status only (e.g. "Kalshi connected ••••1234").
//   POST    { venue, key_id, secret } -> verify with the exchange, store via
//              combo_exchange_key_put (Supabase Vault), return masked status.
//   DELETE  ?venue=kalshi|polymarket_us -> remove the key + its Vault secret.
//
// Combo Locks is private: only the hardcoded COMBO_LOCKS_ACCOUNTS (Kevin's two
// accounts + the approved tester) get any answer; everyone else gets 403.
// Only users approved in combo_live_users (can_trade) may connect. Kevin's
// desk keeps using the server keys on Railway, so his accounts are refused.
// The secret is never logged, echoed, or returned; errors are generic.
// Same-origin only (no CORS headers), no caching.
'use strict';

const lib = require('./combo-probe-lib');
const keys = require('./combo-keys-lib');

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, fetchImpl: (...a) => fetch(...a), verifyKey: null });
let deps = freshDeps();
function setDeps(patch) { deps = { ...deps, ...patch }; }
function resetDeps() { deps = freshDeps(); }

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };

async function requireUser(req) {
  const token = lib.readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: 'Server auth is not configured' };
  const { data, error } = await deps.createClient(url, anon, clientOpts).auth.getUser(token);
  const user = data && data.user;
  if (error || !user || !user.id) return { ok: false, status: 401, error: 'Invalid session' };
  return { ok: true, user };
}

function serviceClient() {
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return deps.createClient(url, key, clientOpts);
}

async function loadStatus(client, userId) {
  const [liveQ, keysQ] = await Promise.all([
    client.from('combo_live_users').select('user_id,is_owner,can_trade,paused,max_per_lock_usd,max_per_day_usd').eq('user_id', userId).maybeSingle(),
    client.from('combo_exchange_keys').select('venue,key_hint,scope_status,verified_at,updated_at').eq('user_id', userId),
  ]);
  if (liveQ.error) throw liveQ.error;
  if (keysQ.error) throw keysQ.error;
  const live = liveQ.data || null;
  const isKevin = keys.KEVIN_IDS.includes(String(userId).toLowerCase());
  const byVenue = {};
  for (const r of keysQ.data || []) byVenue[r.venue] = r;
  return {
    ok: true,
    approved: !!(live && live.can_trade !== false) && !isKevin,
    owner: isKevin,
    paused: !!(live && live.paused),
    caps: live && !isKevin ? {
      perLockUsd: live.max_per_lock_usd == null ? null : Number(live.max_per_lock_usd),
      perDayUsd: live.max_per_day_usd == null ? null : Number(live.max_per_day_usd),
    } : null,
    venues: {
      kalshi: keys.publicKeyRow(byVenue.kalshi && { ...byVenue.kalshi, venue: 'kalshi' }),
      polymarket_us: keys.publicKeyRow(byVenue.polymarket_us && { ...byVenue.polymarket_us, venue: 'polymarket_us' }),
    },
  };
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  return body && typeof body === 'object' ? body : null;
}

async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return json(res, 405, { ok: false, error: 'GET, POST or DELETE' });
  const auth = await requireUser(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  if (!lib.canSeeComboLocks(auth.user)) return json(res, 403, { ok: false, error: 'Not allowed' });
  const client = serviceClient();
  if (!client) return json(res, 503, { ok: false, error: 'Server is not configured' });
  const userId = auth.user.id;
  try {
    if (req.method === 'GET') return json(res, 200, await loadStatus(client, userId));

    const status = await loadStatus(client, userId);
    if (status.owner) return json(res, 403, { ok: false, error: 'Your desk trades with the server keys; nothing to connect here.' });

    if (req.method === 'DELETE') {
      const venue = String((req.query && req.query.venue) || (parseBody(req) || {}).venue || '');
      if (!keys.VENUES.includes(venue)) return json(res, 400, { ok: false, error: 'Unknown exchange' });
      const { error } = await client.rpc('combo_exchange_key_delete', { p_user: userId, p_venue: venue });
      if (error) throw error;
      return json(res, 200, await loadStatus(client, userId));
    }

    // POST: connect / replace.
    if (!status.approved) return json(res, 403, { ok: false, error: 'Your account is not approved for Combo Locks trading yet.' });
    const body = parseBody(req);
    if (!body) return json(res, 400, { ok: false, error: 'Expected a JSON body' });
    const venue = String(body.venue || '');
    if (!keys.VENUES.includes(venue)) return json(res, 400, { ok: false, error: 'Unknown exchange' });
    let verified;
    try {
      const verify = deps.verifyKey || keys.verifyKey;
      verified = await verify(venue, { keyId: body.key_id, secret: body.secret, env: deps.env || process.env, fetchImpl: deps.fetchImpl });
    } catch (e) {
      if (e instanceof keys.KeyError) return json(res, e.status, { ok: false, error: e.message, code: e.code });
      throw new Error('verify failed');
    }
    const { error } = await client.rpc('combo_exchange_key_put', {
      p_user: userId,
      p_venue: venue,
      p_key_id: verified.keyId,
      p_secret: verified.secret,
      p_hint: verified.hint,
      p_scopes: verified.scopes,
      p_scope_status: verified.scopeStatus,
    });
    if (error) throw new Error('store failed');
    const out = await loadStatus(client, userId);
    return json(res, 200, { ...out, warnings: verified.warnings || [] });
  } catch (err) {
    // Never include request data in logs: message only, no body.
    console.error('[combo-keys]', req.method, String((err && err.message) || err).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Something went wrong. Nothing was shared; please try again.' });
  }
}

handler.config = { maxDuration: 20 };
module.exports = handler;
module.exports.config = { maxDuration: 20 };
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
module.exports._loadStatus = loadStatus;
