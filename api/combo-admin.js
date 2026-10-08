// /api/combo-admin — owner-only "All users" view for Combo Locks testers.
//
//   GET  -> { users: [...] } one row per user who is in combo_live_users or
//           owns any lock: email, owner/approved/paused, caps, kill switch,
//           masked key status per venue (never key ids or secrets), lock /
//           order / fill counts (combo_admin_user_stats RPC). P/L is computed
//           in the page from the owner's RLS reads with the statement math.
//   POST { action: 'pause' | 'resume', user_id }
//           pause  = combo_live_users.paused + kill switch engaged (the worker
//                    stops quoting that user within one refresh).
//           resume = clears the owner pause only; the user re-arms their own
//                    kill switch.
//        { action: 'caps', user_id, max_per_lock_usd, max_per_day_usd }
//
// Approving a tester (adding to combo_live_users) is deliberately not here.
'use strict';

const lib = require('./combo-probe-lib');
const keysLib = require('./combo-keys-lib');

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
  if (!lib.isComboOwner(user)) return { ok: false, status: 403, error: 'Not allowed' };
  return { ok: true, user };
}

function serviceClient() {
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return deps.createClient(url, key, clientOpts);
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const capOrNull = (v) => (v == null || v === '' ? null : Number(v));

async function listEmails(client, ids) {
  const out = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data } = await client.auth.admin.getUserById(id);
      out[id] = (data && data.user && data.user.email) || null;
    } catch (_) { out[id] = null; }
  }));
  return out;
}

async function buildUsers(client) {
  const [liveQ, keysQ, settingsQ, statsQ] = await Promise.all([
    client.from('combo_live_users').select('user_id,is_owner,can_trade,paused,paused_at,max_per_lock_usd,max_per_day_usd,note,added_at'),
    client.from('combo_exchange_keys').select('user_id,venue,key_hint,scope_status,verified_at,updated_at'),
    client.from('combo_settings').select('user_id,kill_switch,updated_at'),
    // Aggregates in SQL (service role only): locks, orders (30d), fills.
    client.rpc('combo_admin_user_stats'),
  ]);
  for (const q of [liveQ, keysQ, settingsQ, statsQ]) if (q.error) throw q.error;
  const users = new Map();
  const get = (id) => {
    if (!users.has(id)) {
      users.set(id, {
        user_id: id, email: null, is_owner: false, approved: false, can_trade: false, paused: false, paused_at: null,
        caps: { perLockUsd: null, perDayUsd: null }, kill_switch: true, kill_switch_at: null,
        keys: { kalshi: { connected: false }, polymarket_us: { connected: false } },
        locks: { active: 0, total: 0 }, orders: { last30d: 0 }, fills: { count: 0, contracts: 0, todayContracts: 0 },
        note: null, in_live_users: false,
      });
    }
    return users.get(id);
  };
  for (const r of liveQ.data || []) {
    const u = get(r.user_id);
    Object.assign(u, {
      in_live_users: true, is_owner: !!r.is_owner, can_trade: r.can_trade !== false, paused: !!r.paused, paused_at: r.paused_at || null,
      approved: r.can_trade !== false, note: r.note || null,
      caps: { perLockUsd: capOrNull(r.max_per_lock_usd), perDayUsd: capOrNull(r.max_per_day_usd) },
    });
  }
  for (const st of statsQ.data || []) {
    if (!st.user_id) continue;
    const u = get(st.user_id);
    u.locks = { active: num(st.locks_active), total: num(st.locks_total) };
    u.orders = { last30d: num(st.orders_30d) };
    u.fills = { count: num(st.fills_count), contracts: num(st.fills_contracts), todayContracts: num(st.fills_today_contracts) };
  }
  for (const k of keysQ.data || []) {
    if (!k.user_id) continue;
    get(k.user_id).keys[k.venue] = keysLib.publicKeyRow(k);
  }
  for (const s of settingsQ.data || []) {
    if (!users.has(s.user_id)) continue;
    const u = users.get(s.user_id);
    u.kill_switch = s.kill_switch !== false;
    u.kill_switch_at = s.updated_at || null;
  }
  const ids = [...users.keys()];
  const emails = await listEmails(client, ids);
  const list = ids.map((id) => {
    const u = users.get(id);
    u.email = emails[id] || null;
    const kevin = keysLib.KEVIN_IDS.includes(id);
    // Kevin's desk trades with the server keys on Railway.
    u.desk = kevin ? 'server_keys' : 'own_keys';
    u.trading = u.approved && !u.paused && !u.kill_switch && (kevin || u.keys.kalshi.connected);
    return u;
  });
  list.sort((a, b) => (b.is_owner - a.is_owner) || (b.in_live_users - a.in_live_users) || String(a.email || a.user_id).localeCompare(String(b.email || b.user_id)));
  return list;
}

async function act(client, owner, body) {
  const userId = String(body.user_id || '').toLowerCase();
  if (!UUID_RE.test(userId)) return { ok: false, status: 400, error: 'user_id required' };
  const { data: row, error: rowErr } = await client.from('combo_live_users').select('user_id,is_owner').eq('user_id', userId).maybeSingle();
  if (rowErr) throw rowErr;
  if (body.action === 'pause' || body.action === 'resume') {
    if (userId === lib.OWNER_USER_ID) return { ok: false, status: 400, error: 'Use your own kill switch for your desk.' };
    const pausing = body.action === 'pause';
    if (pausing) {
      // Kill switch first: the user is stopped even if they have no live-users row.
      const { error: kErr } = await client.from('combo_settings').upsert({ user_id: userId, kill_switch: true, updated_at: new Date(deps.now()).toISOString() }, { onConflict: 'user_id' });
      if (kErr) throw kErr;
    }
    if (row) {
      const patch = pausing
        ? { paused: true, paused_at: new Date(deps.now()).toISOString(), paused_by: owner.id }
        : { paused: false, paused_at: null, paused_by: null };
      const { error } = await client.from('combo_live_users').update(patch).eq('user_id', userId);
      if (error) throw error;
    }
    return { ok: true };
  }
  if (body.action === 'caps') {
    if (!row) return { ok: false, status: 404, error: 'User is not in combo_live_users' };
    const parse = (v) => {
      if (v == null || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100000) throw Object.assign(new Error('bad cap'), { userFacing: true });
      return Math.round(n * 100) / 100;
    };
    let perLock; let perDay;
    try { perLock = parse(body.max_per_lock_usd); perDay = parse(body.max_per_day_usd); } catch (_) {
      return { ok: false, status: 400, error: 'Caps must be dollar amounts between 0 and 100000 (blank = no cap).' };
    }
    if (!keysLib.KEVIN_IDS.includes(userId) && (perLock == null || perDay == null)) {
      return { ok: false, status: 400, error: 'Testers must have both a per-lock and a per-day cap.' };
    }
    const { error } = await client.from('combo_live_users').update({ max_per_lock_usd: perLock, max_per_day_usd: perDay }).eq('user_id', userId);
    if (error) throw error;
    return { ok: true };
  }
  return { ok: false, status: 400, error: 'Unknown action' };
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: 'GET or POST' });
  const auth = await requireOwner(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  const client = serviceClient();
  if (!client) return json(res, 503, { ok: false, error: 'SUPABASE_SERVICE_KEY is not configured' });
  try {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
      if (!body || typeof body !== 'object') return json(res, 400, { ok: false, error: 'Expected a JSON body' });
      const r = await act(client, auth.user, body);
      if (!r.ok) return json(res, r.status || 400, { ok: false, error: r.error });
    }
    return json(res, 200, { ok: true, users: await buildUsers(client) });
  } catch (err) {
    console.error('[combo-admin]', String((err && err.message) || err).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Admin request failed' });
  }
}

handler.config = { maxDuration: 20 };
module.exports = handler;
module.exports.config = { maxDuration: 20 };
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
module.exports._buildUsers = buildUsers;
module.exports._act = act;
