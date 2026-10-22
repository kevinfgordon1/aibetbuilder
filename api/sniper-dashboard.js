// /api/sniper-dashboard — Kevin only (combo-probe-lib isComboOwner). Read-only view of the isolated
// Combo Sniper service's own tables (sniper_ledger, sniper_decisions; RLS on, service key only).
// GET ?book=live|dry|auto&days=1..30 → { ok, book, status, risk, caps, quotes, days, skips }
'use strict';
const lib = require('./combo-probe-lib');

function defaultCreateClient(...args) { const { createClient } = require('@supabase/supabase-js'); return createClient(...args); }
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, now: () => Date.now() });
let deps = freshDeps();
const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
let helpers = null;
const mods = async () => (helpers || (helpers = await import('../src/sniperDashboard.js')));
const LEDGER_COLS = 'rfq_id,combo_key,games,legs,status,phase,dry_run,risk,ev,roi,quote_yes,quote_american,fair_yes,fair_american,contracts,fee,maker_rate,market_ticker,quote_id,order_id,filled_contracts,filled_cost,filled_fee,market_result,realized_pnl,settled_at,created_at,updated_at';

function json(res, status, body) { res.setHeader('Cache-Control', 'no-store'); res.status(status).json(body); }

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

async function pageAll(build, max = 20000) {
  const out = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'GET only' });
  const auth = await requireOwner(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  if (!url || !env.SUPABASE_SERVICE_KEY) return json(res, 503, { ok: false, error: 'Server data access is not configured' });
  try {
    const H = await mods();
    const q = req.query || {};
    const days = Math.min(30, Math.max(1, Number(q.days) || 7));
    const nowMs = deps.now();
    const since = new Date(nowMs - days * 864e5).toISOString();
    const db = deps.createClient(url, env.SUPABASE_SERVICE_KEY, clientOpts);
    const { data: sumRows, error: se } = await db.from('sniper_decisions').select('created_at,details').eq('action', 'summary').order('created_at', { ascending: false }).limit(1);
    if (se) throw new Error(se.message);
    const status = H.statusFrom(sumRows && sumRows[0], nowMs);
    let book = String(q.book || 'auto');
    if (book === 'auto') {
      const { count } = await db.from('sniper_ledger').select('rfq_id', { count: 'exact', head: true }).eq('dry_run', false);
      book = count > 0 || status.mode === 'live' ? 'live' : 'dry';
    }
    const dry = book !== 'live';
    // Open rows of any age + everything touched in the window (settlements count for running P&L).
    const [openRows, recent, settledAll] = await Promise.all([
      pageAll(() => db.from('sniper_ledger').select(LEDGER_COLS).eq('dry_run', dry).eq('status', 'open').order('created_at', { ascending: false })),
      pageAll(() => db.from('sniper_ledger').select(LEDGER_COLS).eq('dry_run', dry).gte('created_at', since).order('created_at', { ascending: false })),
      pageAll(() => db.from('sniper_ledger').select('rfq_id,status,phase,risk,realized_pnl,settled_at,created_at,games,legs').eq('dry_run', dry).eq('phase', 'settled')),
    ]);
    const byId = new Map();
    for (const r of [...settledAll, ...recent, ...openRows]) byId.set(r.rfq_id, { ...(byId.get(r.rfq_id) || {}), ...r });
    const all = [...byId.values()];
    const todayKey = H.etDayKey(new Date(nowMs).toISOString());
    const risk = H.summarizeLedger(all, todayKey);
    const quotes = [...openRows, ...recent.filter((r) => r.status !== 'open')]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 300).map(H.quoteRow);
    const sums = await pageAll(() => db.from('sniper_decisions').select('created_at,details').eq('action', 'summary').gte('created_at', new Date(nowMs - 24 * 3600e3).toISOString()).order('created_at', { ascending: true }), 2000);
    return json(res, 200, { ok: true, book, status, caps: H.CAPS, risk, quotes, skips: H.skipsByHour(sums) });
  } catch (e) {
    console.error('[sniper-dashboard]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Could not load sniper data' });
  }
}

module.exports = handler;
module.exports._setDeps = (patch) => { deps = { ...deps, ...patch }; };
module.exports._resetDeps = () => { deps = freshDeps(); };
