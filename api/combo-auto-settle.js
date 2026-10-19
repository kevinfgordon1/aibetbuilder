'use strict';
// /api/combo-auto-settle — server-side Combo Locks settlement for EVERY allowlisted user.
//
// Runs the exact planner the Combo Locks page runs for its own user on each poll
// (src/comboAutoSettle.js planSettlementPatches, same /api/kalshi-games and
// /api/espn-scores reads, answered in-process here). It only stamps the settlement
// columns the page stamps; History P/L math (buildComboStatement) is unchanged.
//
// SAFETY
//  * DRY-RUN BY DEFAULT. Writes happen only when COMBO_AUTO_SETTLE_WRITE=1 is set
//    AND the request does not pass ?dry=1. Dry-run returns what it WOULD stamp.
//  * Auth: Vercel cron (Authorization: Bearer <CRON_SECRET>) or the Combo Locks
//    owner's own session. Anyone else gets 401/403.
//  * Idempotent + safe with the page settling at the same time: every write is
//    conditional on the row still being unsettled for the field it stamps
//    (kalshi_result not yes/no, underlying_result not won/lost/push, combo_ticker
//    null), and the stamped values are a pure function of official market data,
//    so a concurrent page write and this job converge on the same row.
//  * Capped per run: users, locks loaded per user, rows stamped, and wall time.
//  * Never reads combo_exchange_keys or any secret; logs ids + results only.
const lib = require('./combo-probe-lib');

const CAPS = Object.freeze({ users: 50, locksPerUser: 300, tickerLookupsPerUser: 100, patchesPerRun: 100, msBudget: 45000 });
const PARLAY_COLS = '*';
const FILL_COLS = 'parlay_id,count,is_combo,is_taker,ticker,raw,fill_id,order_id,kalshi_created_time,recorded_at,no_price,yes_price,fee';
const SUB_COLS = 'id,parlay_id,rfq_id,status,is_live,contracts,quote_id,order_id,market_ticker,venue,fill_american,cancel_requested_at,created_at';

function defaultCreateClient(...args) { const { createClient } = require('@supabase/supabase-js'); return createClient(...args); }
function defaultGetJson(url) {
  // Same routes the page calls, answered in-process by the same handlers.
  const u = new URL(url, 'http://local');
  const mod = u.pathname === '/api/kalshi-games' ? require('./kalshi-games.js')
    : u.pathname === '/api/espn-scores' ? require('./espn-scores.js') : null;
  if (!mod) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let code = 200;
    const res = {
      setHeader() {}, end() { resolve(null); return res; },
      status(c) { code = c; return res; },
      json(b) { resolve(code >= 200 && code < 300 ? b : null); return res; },
    };
    Promise.resolve(mod({ method: 'GET', url: u.pathname + u.search, query: Object.fromEntries(u.searchParams), headers: {} }, res)).catch(reject);
  });
}
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, getJson: defaultGetJson, now: () => Date.now(), log: (...a) => console.log(...a) });
let deps = freshDeps();
function setDeps(patch) { deps = { ...deps, ...patch }; }
function resetDeps() { deps = freshDeps(); }
const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
function json(res, status, body) { res.setHeader('Cache-Control', 'no-store'); res.status(status).json(body); }

async function authorize(req) {
  const env = deps.env || process.env;
  const token = lib.readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'auth required' };
  if (env.CRON_SECRET && token === env.CRON_SECRET) return { ok: true, via: 'cron' };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: 'Server auth is not configured' };
  const { data, error } = await deps.createClient(url, anon, clientOpts).auth.getUser(token);
  const user = data && data.user;
  if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
  if (!lib.isComboOwner(user)) return { ok: false, status: 403, error: 'Owner only' };
  return { ok: true, via: 'owner' };
}

async function pagedAll(makeQuery, pageSize = 1000, maxPages = 20) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const r = await makeQuery().range(page * pageSize, page * pageSize + pageSize - 1);
    if (r.error) throw r.error;
    const data = r.data || [];
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
const TICKER_SUBS_PER_LOCK = 50;
const chunk = (ids, n = 10) => { const out = []; for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n)); return out; };
async function inChunks(ids, fn) { const out = []; for (const c of chunk(ids)) { const r = await fn(c); if (r.error) throw r.error; out.push(...(r.data || [])); } return out; }

/** Allowlisted users: hardcoded Combo Locks accounts + combo_live_users. */
async function allowlistedUsers(client) {
  const ids = new Map(lib.COMBO_LOCKS_ACCOUNTS.map((a) => [a.id, a.email]));
  const { data, error } = await client.from('combo_live_users').select('user_id');
  if (error) throw error;
  for (const r of data || []) if (r && r.user_id && !ids.has(r.user_id)) ids.set(r.user_id, null);
  return [...ids.entries()].map(([id, email]) => ({ id, email }));
}

/** Everything the page hands refreshSettlements, limited to rows that could still change. */
async function loadUserInputs(client, userId, T) {
  const rows = (await client.from('combo_parlays').select(PARLAY_COLS).eq('user_id', userId)
    .or('kalshi_result.is.null,kalshi_result.not.in.(yes,no),combo_ticker.is.null')
    .order('created_at', { ascending: false }).limit(CAPS.locksPerUser));
  if (rows.error) throw rows.error;
  const parlays = rows.data || [];
  if (!parlays.length) return null;
  const ids = parlays.map((p) => p.id);
  const fills = await pagedAll(() => client.from('combo_fills').select(FILL_COLS).eq('user_id', userId).eq('is_combo', true).order('recorded_at', { ascending: true }).order('id', { ascending: true }));
  // Booked rows (confirmed fills / live quotes) feed filledById, exactly like the page's booked read.
  const booked = await inChunks(ids, (c) => client.from('combo_submissions').select(SUB_COLS).eq('user_id', userId).in('parlay_id', c)
    .or('status.eq.filled,is_live.eq.true').order('created_at', { ascending: false }).limit(5000));
  // Ticker evidence (market_ticker on skip-tape rows) only for locks that still need a combo ticker.
  // Capped per chunk: resolveComboTicker takes the most common ticker, so the newest rows suffice.
  const S0 = await import('../src/comboSettlement.js');
  const needTicker = parlays.filter((p) => !p.combo_ticker && !S0.singleLegOf(p)
    && !fills.some((f) => f && f.parlay_id === p.id && S0.tickerFromRecord(f))).map((p) => p.id);
  const tickerSubs = [];
  for (const pid of needTicker.slice(0, CAPS.tickerLookupsPerUser)) {
    const r = await client.from('combo_submissions').select(SUB_COLS).eq('user_id', userId).eq('parlay_id', pid)
      .neq('status', 'shadow').not('market_ticker', 'is', null).order('created_at', { ascending: false }).limit(TICKER_SUBS_PER_LOCK);
    if (r.error) throw r.error;
    tickerSubs.push(...(r.data || []));
  }
  const seen = new Set();
  const submissions = [...booked, ...tickerSubs].filter((r) => r && !seen.has(r.id) && seen.add(r.id));
  const outcomes = await inChunks(ids, (c) => client.from('quote_outcomes').select('id,quote_id,rfq_id,parlay_id,market_ticker,raw').in('parlay_id', c).limit(5000));
  const matchRows = await inChunks(ids, (c) => client.from('combo_matches').select('id,rfq_id,parlay_id').in('parlay_id', c).limit(5000));
  const matchesByParlay = {};
  for (const m of matchRows) (matchesByParlay[m.parlay_id] = matchesByParlay[m.parlay_id] || []).push(m);
  const { byParlay } = T.deskFillCounts(fills, booked.filter(T.isConfirmedFillSubmission));
  return {
    living: parlays.filter((p) => !p.archived_at),
    archived: parlays.filter((p) => p.archived_at),
    fills, outcomes, matchesByParlay, submissions, filledById: byParlay,
  };
}

/** Conditional write: only while the row is still unsettled for what this patch stamps. */
async function writePatch(client, userId, id, patch) {
  let q = client.from('combo_parlays').update(patch).eq('id', id).eq('user_id', userId);
  if ('kalshi_result' in patch) q = q.or('kalshi_result.is.null,kalshi_result.not.in.(yes,no)');
  else if ('underlying_result' in patch) q = q.or('underlying_result.is.null,underlying_result.not.in.(won,lost,push)');
  else q = q.is('combo_ticker', null);
  const r = await q.select('id');
  if (r.error) throw r.error;
  return (r.data || []).length;
}

const short = (patch) => Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'leg_results'));

async function run({ client, write, mods }) {
  const { A, S, T } = mods;
  const started = deps.now();
  const users = (await allowlistedUsers(client)).slice(0, CAPS.users);
  const out = []; let stamped = 0; let planned = 0; let capped = false;
  for (const u of users) {
    if (deps.now() - started > CAPS.msBudget) { capped = true; break; }
    const inputs = await loadUserInputs(client, u.id, T);
    if (!inputs) { out.push({ user_id: u.id, email: u.email, checked: 0, patches: [] }); continue; }
    const { rowPatch } = await A.planSettlementPatches(inputs, { getJson: deps.getJson, now: deps.now });
    const byId = new Map([...inputs.living, ...inputs.archived].map((p) => [p.id, p]));
    const patches = [];
    for (const [id, patch] of Object.entries(rowPatch)) {
      if (!patch || !Object.keys(patch).length) continue;
      if (planned >= CAPS.patchesPerRun) { capped = true; break; }
      planned += 1;
      const before = byId.get(id) || {};
      const after = { ...before, ...patch };
      // History P/L for this lock after the stamp — same buildComboStatement the page uses.
      let pnl = null; let result = null;
      if (after.archived_at) {
        const st = S.buildComboStatement({ parlays: [after], fillsById: inputs.filledById, fills: inputs.fills, outcomes: inputs.outcomes, matchesByParlay: inputs.matchesByParlay, submissions: inputs.submissions });
        const line = st.lines[0];
        if (line) { pnl = line.settled ? line.pnl : null; result = line.resultLabel || null; }
      }
      let wrote = 0;
      if (write) wrote = await writePatch(client, u.id, id, patch);
      stamped += wrote;
      patches.push({ id, label: before.label || '', archived: !!before.archived_at, patch: short(patch), result, pnl, wrote: write ? wrote : undefined });
    }
    out.push({ user_id: u.id, email: u.email, checked: inputs.living.length + inputs.archived.length, patches });
    deps.log('[combo-auto-settle]', JSON.stringify({ user: u.id, checked: inputs.living.length + inputs.archived.length, planned: patches.length, wrote: write ? patches.reduce((s, p) => s + (p.wrote || 0), 0) : 0, mode: write ? 'write' : 'dry' }));
    if (capped) break;
  }
  return { users: out, planned, stamped, capped, ms: deps.now() - started };
}

let modsP = null;
function loadMods() {
  if (!modsP) {
    modsP = Promise.all([import('../src/comboAutoSettle.js'), import('../src/comboStatement.js'), import('../src/comboTape.js')])
      .then(([A, S, T]) => ({ A, S, T }));
  }
  return modsP;
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: 'GET or POST' });
  const auth = await authorize(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  if (!url || !env.SUPABASE_SERVICE_KEY) return json(res, 503, { ok: false, error: 'Server is not configured' });
  const client = deps.createClient(url, env.SUPABASE_SERVICE_KEY, clientOpts);
  const q = req.query || {};
  const write = env.COMBO_AUTO_SETTLE_WRITE === '1' && String(q.dry || '') !== '1';
  try {
    const out = await run({ client, write, mods: await loadMods() });
    return json(res, 200, { ok: true, mode: write ? 'write' : 'dry-run', via: auth.via, caps: CAPS, ...out });
  } catch (e) {
    console.error('[combo-auto-settle]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: 'auto-settle failed' });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
module.exports._run = run;
module.exports._loadMods = loadMods;
module.exports.CAPS = CAPS;
