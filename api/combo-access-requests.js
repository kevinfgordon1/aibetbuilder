// /api/combo-access-requests — Kevin reviews Combo Locks beta requests.
//
//   GET  -> { requests: [{ user_id, email, status, created_at }] }
//   POST { user_id } -> status = approved
//
// Both of Kevin's accounts may call this (email + auth uid). Approving
// opens the Combo Locks page through hasApprovedComboAccess. It does not
// insert combo_live_users and does not change lock rules.
'use strict';

const lib = require('./combo-probe-lib');

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, now: () => Date.now() });
let deps = freshDeps();
function setDeps(patch) { deps = { ...deps, ...patch }; }
function resetDeps() { deps = freshDeps(); }

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

async function requireReviewer(req) {
  const token = lib.readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: 'Server auth is not configured' };
  const { data, error } = await deps.createClient(url, anon, clientOpts).auth.getUser(token);
  const user = data && data.user;
  if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
  if (!lib.canReviewComboAccess(user)) return { ok: false, status: 403, error: 'Not allowed' };
  return { ok: true, user };
}

function serviceClient() {
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return deps.createClient(url, key, clientOpts);
}

function sortRequests(rows) {
  return [...(rows || [])].sort((a, b) => {
    const ap = a.status === 'pending' ? 0 : 1;
    const bp = b.status === 'pending' ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

async function listRequests(client) {
  const q = await client.from('combo_locks_access_requests').select('user_id,email,status,created_at').limit(500);
  if (q.error) {
    const msg = String(q.error.message || q.error);
    if (/combo_locks_access_requests|schema cache|does not exist|42P01/i.test(msg)) {
      return { ok: false, status: 503, error: 'Beta access requests are not set up yet. Run sql/20261103_combo_locks_access_requests.sql in the Supabase SQL editor.' };
    }
    throw q.error;
  }
  return { ok: true, requests: sortRequests(q.data) };
}

async function approve(client, userId) {
  if (!UUID_RE.test(userId)) return { ok: false, status: 400, error: 'user_id required' };
  const { data: row, error } = await client.from('combo_locks_access_requests').select('user_id,email,status').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!row) return { ok: false, status: 404, error: 'No access request from that user.' };
  if (row.status !== 'approved') {
    const { error: upErr } = await client.from('combo_locks_access_requests').update({ status: 'approved' }).eq('user_id', userId);
    if (upErr) throw upErr;
  }
  return { ok: true };
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: 'GET or POST' });
  if (req.method === 'POST' && require('./combo-view-as-lib').blockViewAsWrite(req, res)) return;
  const auth = await requireReviewer(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  const client = serviceClient();
  if (!client) return json(res, 503, { ok: false, error: 'SUPABASE_SERVICE_KEY is not configured' });
  try {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
      if (!body || typeof body !== 'object') return json(res, 400, { ok: false, error: 'Expected a JSON body' });
      const r = await approve(client, String(body.user_id || '').toLowerCase());
      if (!r.ok) return json(res, r.status || 400, { ok: false, error: r.error });
    }
    const listed = await listRequests(client);
    if (!listed.ok) return json(res, listed.status || 503, { ok: false, error: listed.error });
    return json(res, 200, { ok: true, requests: listed.requests });
  } catch (err) {
    console.error('[combo-access-requests]', String((err && err.message) || err).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Could not load access requests' });
  }
}

handler.config = { maxDuration: 15 };
module.exports = handler;
module.exports.config = { maxDuration: 15 };
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
