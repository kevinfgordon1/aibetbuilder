'use strict';
// /api/combo-leg-fairs — saves each Combo Lock leg's placement fair price (combo_lock_leg_fairs).
//
//  POST (user session): right after the Combo Locks page adds a lock. Saves `at_lock` for the caller's own open
//    locks whose first game hasn't started and that have nothing saved yet (so it also catches a lock whose
//    previous save failed). Never touches anyone else's locks.
//  GET ?cron=1 (Vercel cron, Authorization: Bearer <CRON_SECRET>), every 5 min: for every open lock
//    - first game within the next 20 min → refresh `pregame` (the last refresh before kickoff is the kickoff price);
//    - not started and nothing saved yet → `at_lock` with src 'first-seen' (locks added by other paths).
//
// Price = rootForPrices.legFair, the same inverse bet fair the "What to root for" sheet uses (1 − fee-included
// $500 VWAP to buy the opposite side, best of Kalshi / Polymarket US / Novig). Nothing here changes how locks
// are quoted or hedged; combo-worker never reads this table. Writes only combo_lock_leg_fairs. Read-only
// everywhere else (combo_parlays select, public Kalshi orderbooks, odds-relay boards).
const lib = require('./combo-probe-lib');
const rootFor = require('./root-for.js');

const CAPS = Object.freeze({ locks: 400, firstSeenPerRun: 150 });
const COLS = 'id,user_id,legs,starts_at';
function defaultCreateClient(...args) { const { createClient } = require('@supabase/supabase-js'); return createClient(...args); }
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, fetch: (...a) => fetch(...a), now: () => Date.now() });
let deps = freshDeps();
const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
function json(res, status, body) { res.setHeader('Cache-Control', 'no-store'); res.status(status).json(body); }

let ST = null;
async function stored() { if (!ST) ST = await import('../src/rootForStored.js'); return ST; }

/** Open, unstarted locks (one user, or everyone when userId is null). */
async function openLocks(client, userId, nowMs) {
  let q = client.from('combo_parlays').select(COLS)
    .is('archived_at', null).is('merged_into_id', null).is('settled_at', null).is('underlying_settled_at', null)
    .or(`starts_at.is.null,starts_at.gt.${new Date(nowMs).toISOString()}`).limit(CAPS.locks);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q; if (error) throw error;
  return (data || []).filter((p) => Array.isArray(p.legs) && p.legs.some((l) => l && l.ticker));
}
async function existingRows(client, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await client.from('combo_lock_leg_fairs').select('parlay_id,at_lock_at,pregame_at').in('parlay_id', ids.slice(i, i + 200));
    if (error) throw error; for (const r of data || []) out[r.parlay_id] = r;
  }
  return out;
}

/** Plan + write. mode 'add-lock' (at_lock only) or 'cron' (pregame in window + first-seen at_lock). */
async function capture(client, locks, mode, nowMs) {
  const S = await stored();
  const have = await existingRows(client, locks.map((p) => p.id));
  const inWindow = (p) => { const t = Date.parse(p.starts_at); return Number.isFinite(t) && t > nowMs && t - nowMs <= S.CAPTURE_WINDOW_MS; };
  let firstSeen = 0;
  const plan = [];
  for (const p of locks) {
    const needLock = !(have[p.id] && have[p.id].at_lock_at);
    const needPre = mode === 'cron' && inWindow(p);
    if (needLock && mode === 'cron' && !needPre) { if (firstSeen >= CAPS.firstSeenPerRun) continue; firstSeen += 1; }
    if (needLock || needPre) plan.push({ p, needLock, needPre });
  }
  if (!plan.length) return { planned: 0, written: 0 };
  const M = await rootFor._helpers.loadMods();
  const env = deps.env || process.env;
  const mk = await rootFor._helpers.loadMarkets(M, plan.map((x) => x.p), env, deps.fetch, deps.now);
  const px = { kalshiBooks: mk.kalshiBooks, relay: mk.relay, now: deps.now(), kalshiAt: mk.kalshiAt };
  const stamp = new Date(deps.now()).toISOString();
  const groups = new Map(); let empty = 0;
  for (const { p, needLock, needPre } of plan) {
    const fairs = S.captureFairs(p, px);
    if (!Object.keys(fairs).length) { empty += 1; continue; }
    const row = { parlay_id: p.id, user_id: p.user_id, updated_at: stamp };
    if (needLock) Object.assign(row, { at_lock: fairs, at_lock_at: stamp, at_lock_src: mode === 'cron' ? 'first-seen' : 'add-lock' });
    if (needPre) Object.assign(row, { pregame: fairs, pregame_at: stamp });
    const sig = Object.keys(row).sort().join(','); // one upsert per column set: a missing column is never nulled
    (groups.get(sig) || groups.set(sig, []).get(sig)).push(row);
  }
  let written = 0;
  for (const rows of groups.values()) {
    const { error } = await client.from('combo_lock_leg_fairs').upsert(rows, { onConflict: 'parlay_id' });
    if (error) throw error; written += rows.length;
  }
  return { planned: plan.length, written, unpriced: empty };
}

async function handler(req, res) {
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL; const key = env.SUPABASE_SERVICE_KEY;
  try {
    if (req.method === 'GET' && String((req.query || {}).cron || '') === '1') {
      const sec = env.CRON_SECRET;
      if (!sec || lib.readBearer(req) !== sec) return json(res, 401, { ok: false, error: 'cron auth' });
      if (!url || !key) return json(res, 503, { ok: false, error: 'Server is not configured' });
      const client = deps.createClient(url, key, clientOpts); const now = deps.now();
      const locks = await openLocks(client, null, now);
      return json(res, 200, { ok: true, locks: locks.length, ...(await capture(client, locks, 'cron', now)) });
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });
    const token = lib.readBearer(req); if (!token) return json(res, 401, { ok: false, error: 'Sign in required' });
    const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon || !key) return json(res, 503, { ok: false, error: 'Server is not configured' });
    const { data, error } = await deps.createClient(url, anon, clientOpts).auth.getUser(token);
    const user = data && data.user; if (error || !user) return json(res, 401, { ok: false, error: 'Invalid session' });
    const client = deps.createClient(url, key, clientOpts); const now = deps.now();
    const locks = await openLocks(client, user.id, now);
    return json(res, 200, { ok: true, ...(await capture(client, locks, 'add-lock', now)) });
  } catch (e) {
    console.error('[combo-leg-fairs]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Could not save leg prices right now' });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 30 };
module.exports._setDeps = (p) => { deps = { ...deps, ...p }; };
module.exports._resetDeps = () => { deps = freshDeps(); };
module.exports._helpers = { openLocks, capture };
