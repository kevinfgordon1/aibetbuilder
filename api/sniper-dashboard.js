// /api/sniper-dashboard — Kevin only (combo-probe-lib isComboOwner). Read-only view of the isolated
// Combo Sniper service's own tables (sniper_ledger, sniper_decisions; RLS on, service key only).
// GET ?book=live|dry|auto&days=1..30 → { ok, book, status, risk, caps, quotes, days, skips }
'use strict';
const lib = require('./combo-probe-lib');

function defaultCreateClient(...args) { const { createClient } = require('@supabase/supabase-js'); return createClient(...args); }
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, now: () => Date.now(), fetch: (...a) => fetch(...a) });
let deps = freshDeps();
const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
let helpers = null;
let matchedMod = null;
const rootForApi = () => require('./root-for');
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
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
    if (q.matched === '1' || q.matched === 1) return json(res, 200, await matched(db, env, nowMs));
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
    const labels = await legLabels(quotes, risk.games);
    return json(res, 200, { ok: true, book, status, caps: H.CAPS, risk, quotes, skips: H.skipsByHour(sums), ...labels });
  } catch (e) {
    console.error('[sniper-dashboard]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Could not load sniper data' });
  }
}

// Matched (live filled) positions: Combo Locks-style performance + live needle via the root-for engine.
async function kalshiMarkets(tickers) {
  const out = {};
  const f = deps.fetch || fetch;
  for (let i = 0; i < tickers.length; i += 100) {
    try {
      const r = await f(`${KALSHI}/markets?tickers=${tickers.slice(i, i + 100).join(',')}&limit=100`, { headers: { accept: 'application/json' } });
      if (!r.ok) continue; const j = await r.json();
      for (const m of j.markets || []) out[String(m.ticker).toUpperCase()] = m;
    } catch (_) { /* names/results optional */ }
  }
  return out;
}
// Plain-English leg + game labels for the quotes table / risk by game (ESPN kickoffs + Kalshi TD names).
let legsMod = null;
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
async function legLabels(quotes, games) {
  try {
    const L = legsMod || (legsMod = await import('../src/sniperLegLabels.js'));
    const legKeys = [...new Set((quotes || []).flatMap((q) => q.legs || []))];
    const gameKeys = [...new Set((games || []).map((g) => g.game))];
    const f = deps.fetch || fetch;
    const boards = await Promise.all(L.espnDates([...legKeys, ...gameKeys]).slice(0, 14).map(async (d) => {
      try { const r = await f(`${ESPN}?dates=${d}`, { headers: { accept: 'application/json' } }); return r.ok ? r.json() : null; } catch (_) { return null; }
    }));
    const gm = L.gamesFromEspn(boards.filter(Boolean));
    const tdTickers = [...new Set(legKeys.map((k) => String(k).split(':')[0].toUpperCase()).filter((t) => /^KXNFLTD/.test(t)))].slice(0, 500);
    const mk = tdTickers.length ? await kalshiMarkets(tdTickers) : {};
    const names = {}; for (const [t, m] of Object.entries(mk)) names[t] = m.title || m.yes_sub_title;
    const legInfo = {}; for (const k of legKeys) legInfo[k] = L.legInfo(k, gm, names);
    const gameLabels = {}; for (const g of gameKeys) gameLabels[g] = L.gameLabel(g, gm);
    return { legInfo, gameLabels };
  } catch (_) { return { legInfo: {}, gameLabels: {} }; }
}
async function matched(db, env, nowMs) {
  const S = matchedMod || (matchedMod = await import('../src/sniperMatched.js'));
  const rows = (await pageAll(() => db.from('sniper_ledger').select(LEDGER_COLS).eq('dry_run', false).or('filled_contracts.gt.0,phase.eq.accepted,phase.eq.filled,phase.eq.settled').order('created_at', { ascending: false }))).filter(S.isMatched);
  if (!rows.length) return { ok: true, empty: true, asOf: new Date(nowMs).toISOString(), rows: [] };
  const tickers = [...new Set(rows.flatMap((r) => (r.legs || []).map((k) => String(k).split(':')[0].toUpperCase())))];
  const mk = await kalshiMarkets(tickers);
  const names = {}; const legResults = {};
  for (const [t, m] of Object.entries(mk)) { if (/^KXNFLTD-/.test(t)) names[t] = m.title || m.yes_sub_title; const res = String(m.result || '').toLowerCase(); if ((res === 'yes' || res === 'no') && /settled|finalized|determined/.test(String(m.status || ''))) legResults[t] = res; }
  const perf = S.perfStats(rows, legResults);
  const positions = S.enginePositions(rows, names);
  let root = null; let sweat = null; let starts = {};
  if (positions.length) {
    const R = rootForApi(); const M = await R._helpers.loadMods();
    const markets = await R._helpers.loadMarkets(M, positions.map((p) => ({ legs: p.legs })), env);
    starts = markets.starts || {};
    root = M.computeRootFor({ parlays: [], extraPositions: positions, kalshiBooks: markets.kalshiBooks, relay: markets.relay, starts, now: nowMs, kalshiAt: markets.kalshiAt });
    // Needle: pregame = expected profit at the fair we sold at; now = live engine EV.
    const open = rows.filter((r) => r.status === 'open');
    const baseline = open.reduce((a, r) => a + S.rowMoney(r).ev, 0);
    const started = Object.values(starts).some((t) => t && Date.parse(t) <= nowMs);
    sweat = { baseline, now: root.ev, started: true, preStarted: started };
    delete root.model;
  }
  const kick = (k) => { const g = S.legMeta(k, names).gameKey; return starts[g] || null; };
  const lab = await legLabels(rows.map((r) => ({ legs: r.legs || [] })), []);
  const list = rows.map((r) => {
    const m = S.rowMoney(r);
    return { rfqId: r.rfq_id, status: S.matchedStatus(r), filledAt: r.updated_at || r.created_at, createdAt: r.created_at, settledAt: r.settled_at,
      legs: (r.legs || []).map((k) => ({ ...S.legMeta(k, names), ...(lab.legInfo[k] ? { bet: lab.legInfo[k].bet, game: lab.legInfo[k].game } : {}), kickoff: kick(k) || (lab.legInfo[k] && lab.legInfo[k].kickoff) || null, result: legResults[String(k).split(':')[0].toUpperCase()] || null })),
      fairYes: m.fair, soldYes: m.sold, contracts: m.n, risk: m.risk, toWin: m.toWin, ev: m.ev, edge: r.roi != null ? Number(r.roi) : null, pnl: r.realized_pnl != null ? Number(r.realized_pnl) : null };
  });
  return { ok: true, empty: false, asOf: new Date(nowMs).toISOString(), rows: list, perf, root, sweat };
}

module.exports = handler;
module.exports._setDeps = (patch) => { deps = { ...deps, ...patch }; };
module.exports._resetDeps = () => { deps = freshDeps(); };
