// /api/combo-credits — Combo Locks prepaid credits (USDC via Coinbase Business).
//
//   GET  -> { ok, configured, presets }  (booleans only; never a key or secret)
//   POST { amount } -> creates a Coinbase Business checkout for a preset amount,
//          records it in combo_credit_checkouts, returns { ok, url } to redirect to.
//
// Combo Locks allowlist only (COMBO_LOCKS_ACCOUNTS); everyone else gets 403.
// Credits are added by /api/coinbase-webhook after Coinbase confirms payment —
// never here and never from the redirect. No fees are charged anywhere yet.
'use strict';

const lib = require('./combo-probe-lib');
const credits = require('./combo-credits-lib');
const coinbase = require('../lib/coinbase-business');

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, fetchImpl: (...a) => fetch(...a), now: () => Date.now() });
let deps = freshDeps();
function setDeps(patch) { deps = { ...deps, ...patch }; }
function resetDeps() { deps = freshDeps(); }

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

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

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  return body && typeof body === 'object' ? body : null;
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: 'GET or POST' });
  const auth = await requireUser(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  if (!lib.canSeeComboLocks(auth.user)) return json(res, 403, { ok: false, error: 'Not allowed' });

  const env = deps.env || process.env;
  const status = coinbase.configStatus(env);
  const configured = status.ready && !!serviceClient();

  if (req.method === 'GET') {
    return json(res, 200, { ok: true, configured, presets: credits.CREDIT_PRESETS_USD });
  }

  if (!configured) return json(res, 503, { ok: false, code: 'not_configured', error: 'Adding credits is coming soon.' });
  const body = parseBody(req) || {};
  const amount = Number(body.amount);
  if (!credits.isPresetAmount(amount)) return json(res, 400, { ok: false, error: 'Pick one of the listed amounts.' });

  const client = serviceClient();
  const userId = auth.user.id;
  try {
    const since = new Date(deps.now() - 60 * 60 * 1000).toISOString();
    const recent = await client.from('combo_credit_checkouts').select('id').eq('user_id', userId).gte('created_at', since);
    if (recent.error) throw new Error('checkouts lookup failed');
    if ((recent.data || []).length >= credits.MAX_CHECKOUTS_PER_HOUR) {
      return json(res, 429, { ok: false, error: 'Too many checkouts in the last hour. Please try again a bit later.' });
    }

    const origin = credits.siteOrigin(req, env);
    const checkout = await coinbase.createCheckout({
      env,
      fetchImpl: deps.fetchImpl,
      amountUsd: amount,
      description: `aibetbuilder Combo Locks credits ($${amount})`,
      successRedirectUrl: `${origin}/?credits=paid#combo`,
      failRedirectUrl: `${origin}/?credits=failed#combo`,
      metadata: { purpose: 'combo_credits', user_id: userId, amount_usd: amount.toFixed(2) },
    });

    const ins = await client.from('combo_credit_checkouts').insert({
      id: checkout.id,
      user_id: userId,
      amount_usd: amount,
      currency: 'USDC',
      network: checkout.network || 'base',
      status: checkout.status || 'ACTIVE',
      url: checkout.url,
    });
    if (ins.error) throw new Error('checkout record failed');
    return json(res, 200, { ok: true, url: checkout.url, id: checkout.id });
  } catch (err) {
    // Message only; never the request, headers, JWT, or Coinbase body.
    console.error('[combo-credits]', String((err && err.message) || err).slice(0, 200));
    const code = err instanceof coinbase.CoinbaseError ? 502 : 500;
    return json(res, code, { ok: false, error: 'Could not start checkout. Please try again.' });
  }
}

module.exports = handler;
module.exports.setDeps = setDeps;
module.exports.resetDeps = resetDeps;
