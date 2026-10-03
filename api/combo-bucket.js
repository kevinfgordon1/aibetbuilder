// GET /api/combo-bucket — owner-only, read-only Kalshi balance readout for the
// Combo Locks tab. Reads the newest combo_worker_stats row that carries the
// bucket-manager snapshot (written by combo-worker's heartbeat) with the service
// role, because signed-in users cannot read combo_worker_stats. No Kalshi call is
// made here and nothing is written.
//
// Kalshi's own app shows main + combo combined; this labels them separately:
//   main  = exchange shard 0 cash
//   combo = exchange shard 1 available cash (+ open-position value)
// Needs combo-worker's migrations/20261002_combo_worker_stats_bucket.sql; until
// it is applied (or the worker has beaten) the endpoint answers { ok:true, bucket:null }.
'use strict';

const lib = require('./combo-probe-lib');

const OWNER = String(lib.OWNER_EMAIL || 'kev120909@gmail.com').toLowerCase();
const STALE_MS = 10 * 60 * 1000;

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}

let deps = { env: process.env, createClient: defaultCreateClient, now: () => Date.now() };

function setDeps(patch) { deps = { ...deps, ...patch }; }
function resetDeps() { deps = { env: process.env, createClient: defaultCreateClient, now: () => Date.now() }; }

function json(res, status, body) { res.status(status).json(body); }

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

// Account-wide Kalshi balances: owner only (the allowlist is for per-user lock rows).
async function requireOwner(req) {
  const token = lib.readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: 'Server auth is not configured' };
  const supabase = deps.createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  const user = data && data.user;
  if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
  if (String(user.email || '').trim().toLowerCase() !== OWNER) return { ok: false, status: 403, error: 'Not allowed' };
  return { ok: true, user };
}

function serviceClient() {
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return deps.createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function cents(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Dollars out, cents in. Anything missing stays null so the UI can show "—".
function shapeBucket(row, nowMs) {
  const b = row && row.bucket;
  if (!b || typeof b !== 'object') return null;
  const at = b.at || row.ts || null;
  const atMs = at ? Date.parse(at) : NaN;
  const d = (c) => (cents(c) == null ? null : cents(c) / 100);
  return {
    main_cash: d(b.main_cents),
    combo_cash: d(b.combo_cash_cents),
    combo_positions: d(b.combo_positions_cents),
    target: d(b.target_cents),
    ceiling: d(b.ceiling_cents),
    floor: d(b.floor_cents),
    gameday: b.gameday == null ? null : !!b.gameday,
    at,
    stale: Number.isFinite(atMs) ? nowMs - atMs > STALE_MS : true,
  };
}

async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'GET only' });
  const auth = await requireOwner(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  const client = serviceClient();
  if (!client) return json(res, 503, { ok: false, error: 'SUPABASE_SERVICE_KEY is not configured' });
  try {
    const { data, error } = await client
      .from('combo_worker_stats')
      .select('ts,bucket')
      .not('bucket', 'is', null)
      .order('ts', { ascending: false })
      .limit(1);
    if (error) {
      // Column not migrated yet: nothing to show, not an error for the page.
      if (/bucket|schema cache|Could not find|does not exist/i.test(String(error.message || ''))) {
        return json(res, 200, { ok: true, bucket: null, note: 'combo_worker_stats.bucket not migrated yet' });
      }
      throw error;
    }
    return json(res, 200, { ok: true, bucket: shapeBucket((data || [])[0], deps.now()) });
  } catch (err) {
    const message = String((err && err.message) || err);
    console.error('[combo-bucket]', message);
    return json(res, 500, { ok: false, error: message });
  }
}

handler.config = { maxDuration: 15 };
module.exports = handler;
module.exports.config = { maxDuration: 15 };
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
module.exports._shapeBucket = shapeBucket;
