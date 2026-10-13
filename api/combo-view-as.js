// /api/combo-view-as — owner-only, read-only "View as" for Combo Locks.
//
//   GET  -> { users: [{ id, email, label }] } who Kevin can view as.
//   POST { view_as: <user id>, queries: [...] } -> { results: [...] }
//        Each query is either a recorded SELECT ({ table, select, filters,
//        order, limit, single }) or { kind: 'rpc', name: 'combo_my_fee_status' }.
//        Masked key status comes from GET /api/combo-keys with the view-as header.
//
// The signed-in user must be the Combo Locks owner; the target must be a Combo
// Locks account. Every SELECT is pinned to the target server-side (see
// combo-view-as-lib.js). Nothing here writes.
'use strict';

const lib = require('./combo-probe-lib');
const viewAs = require('./combo-view-as-lib');

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient });
let deps = freshDeps();
function setDeps(patch) { deps = { ...deps, ...patch }; }
function resetDeps() { deps = freshDeps(); }
const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

async function requireOwner(req) {
  const token = lib.readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: 'Server auth is not configured' };
  const { data, error } = await deps.createClient(url, anon, clientOpts).auth.getUser(token);
  const user = data && data.user;
  if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
  if (!lib.isComboOwner(user)) return { ok: false, status: 403, error: 'Only the owner can view as another user' };
  return { ok: true, user };
}

function serviceClient() {
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return deps.createClient(url, key, clientOpts);
}

async function liveUserIds(client) {
  const { data, error } = await client.from('combo_live_users').select('user_id');
  if (error) throw error;
  return (data || []).map((r) => r.user_id);
}

const NAMES = {
  'kmguido97@gmail.com': 'Kenny',
  'c.w.higgins1@gmail.com': 'Chris (Higgins)',
  'gmoneyvikes@gmail.com': 'gmoneyvikes',
  'kev120909@gmail.com': 'Kevin (you)',
  'kevin.f.gordon1@gmail.com': 'Kevin (2nd account)',
};

async function listUsers(client) {
  const ids = [...viewAs.viewableIds(await liveUserIds(client))];
  const known = new Map(lib.COMBO_LOCKS_ACCOUNTS.map((a) => [a.id, a.email]));
  const users = await Promise.all(ids.map(async (id) => {
    let email = known.get(id) || null;
    if (!email) {
      try { const { data } = await client.auth.admin.getUserById(id); email = (data && data.user && data.user.email) || null; } catch (_) { email = null; }
    }
    return { id, email, label: (email && NAMES[email]) || email || id.slice(0, 8), owner: id === lib.OWNER_USER_ID };
  }));
  users.sort((a, b) => (b.owner - a.owner) || String(a.label).localeCompare(String(b.label)));
  return users;
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  return body && typeof body === 'object' ? body : null;
}

async function runOne(client, spec, targetId, parlayIdsP) {
  try {
    if (spec && spec.kind === 'rpc') {
      if (spec.name !== 'combo_my_fee_status') return { data: null, error: { message: 'rpc not viewable' } };
      const r = await client.rpc('combo_fee_status_for_worker', { uids: [targetId] });
      return { data: r.data || null, error: r.error ? { message: String(r.error.message || r.error) } : null };
    }
    const s = viewAs.sanitizeQuery(spec);
    if (!s.ok) return { data: null, error: { message: s.error } };
    const parlayIds = s.plan.scope === 'parlay' ? await parlayIdsP() : [];
    return await viewAs.runPlan(client, s.plan, targetId, parlayIds);
  } catch (e) {
    return { data: null, error: { message: String((e && e.message) || e).slice(0, 200) } };
  }
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: 'GET or POST' });
  const auth = await requireOwner(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  const client = serviceClient();
  if (!client) return json(res, 503, { ok: false, error: 'Server is not configured' });
  try {
    if (req.method === 'GET') return json(res, 200, { ok: true, users: await listUsers(client) });
    const body = parseBody(req);
    if (!body) return json(res, 400, { ok: false, error: 'Expected a JSON body' });
    const gate = viewAs.authorizeViewAs(auth.user, body.view_as, await liveUserIds(client));
    if (!gate.ok) return json(res, gate.status, { ok: false, error: gate.error });
    const queries = Array.isArray(body.queries) ? body.queries : [];
    if (queries.length > viewAs.MAX_QUERIES) return json(res, 400, { ok: false, error: 'Too many queries' });
    let idsPromise = null;
    const parlayIdsP = () => {
      if (!idsPromise) {
        idsPromise = client.from('combo_parlays').select('id').eq('user_id', gate.targetId).limit(10000)
          .then((r) => { if (r.error) throw r.error; return (r.data || []).map((p) => p.id); });
      }
      return idsPromise;
    };
    const results = await Promise.all(queries.map((q) => runOne(client, q, gate.targetId, parlayIdsP)));
    return json(res, 200, { ok: true, view_as: gate.targetId, results });
  } catch (e) {
    console.error('[combo-view-as]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Something went wrong' });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 30 };
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
