// love23 loss-rebate optimizer — Kevin only (OWNER_EMAIL, same gate as the
// Live Trading Desk). RECOMMENDATIONS ONLY: this route never calls a love23
// wager endpoint (lib/love23-client.js refuses every wager path outright).
//
// GET  /api/love23-rebate?view=picks[&weeks=&bpw=&drift=&sd=&cap=&credit=&carry=&weekNet=&maxBet=&confirm=&flagged=1]
//        love23 schedule (cached 30s, backoff on errors) x odds_cache / event_odds_cache
//        -> ranked hedged picks with EV incl. the weekly rebate. carry / weekNet
//        default to the ledger (carry entering this Tue-Tue week, love23 net so far).
//        weeks = weeks left in the promo incl. this one, bpw = planned bets per week.
// GET  /api/love23-rebate?view=account
//        balance, limits, open + settled wagers (settled days are upserted into
//        love23_daily so the ledger outlives the API's 1-week window), ledger summary.
// POST { op: "hedge-add", game, market, venue, side, american, stake, note?, love23Ticket? }
// POST { op: "hedge-settle", id, result: "won"|"lost"|"push"|"void", pnl? }
// POST { op: "hedge-delete", id }
// POST { op: "adjust", pnl, note? }        love23 net correction (counts in this week)
// POST { op: "carry", pnl, note? }         opening carry-forward balance at promo start
// POST { op: "settlement", pnl, note? }    weekly cash actually settled (+ received, - paid)
//
// Env: LOVE23_USERNAME, LOVE23_PASSWORD (Kevin sets these), optional LOVE23_PROMO_START
// (YYYY-MM-DD), LOVE23_API_BASE. Supabase: SUPABASE_URL + SUPABASE_SERVICE_KEY.
// Tables: sql/20261030_love23_ledger.sql (Kevin runs it).
'use strict';

const { createLove23Client, Love23Error } = require('../lib/love23-client');
const { parseSchedule, DEFAULT_LEAGUE_IDS, SPORT_KEYS } = require('../lib/love23-parse');
const { evaluateAll, rankPicks, VENUE_LABEL } = require('../lib/love23-optimizer');
const { computeLedger, settledDailyFromApi } = require('../lib/love23-ledger');
const R = require('../lib/love23-rebate');
const Wk = require('../lib/love23-weekly');

let access = null;
let accessPromise = null;
function ensureAccess() {
  if (access) return Promise.resolve(access);
  if (!accessPromise) {
    // src/comboAccess.js is ESM; dynamic import works from this CommonJS route.
    accessPromise = import('../src/comboAccess.js').then((m) => { access = m; return m; })
      .catch((e) => { accessPromise = null; throw e; });
  }
  return accessPromise;
}

function readBearer(req) {
  const h = (req && req.headers) || {};
  const raw = h.authorization || h.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(raw) ? raw[0] : String(raw));
  return m ? m[1].trim() : '';
}

async function requireOwner(req) {
  const token = readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: 'Server auth is not configured' };
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.getUser(token);
  const user = data && data.user;
  if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
  const a = await ensureAccess();
  if (!a.canSeeOwnerTools(user)) return { ok: false, status: 403, error: 'Not allowed' };
  return { ok: true, user };
}

let sharedClient = null;
let sharedDb = null;
const defaults = {
  requireOwner,
  love23: () => { if (!sharedClient) sharedClient = createLove23Client(); return sharedClient; },
  db: () => {
    if (sharedDb) return sharedDb;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) return null;
    const { createClient } = require('@supabase/supabase-js');
    sharedDb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return sharedDb;
  },
  now: () => Date.now(),
  promoStart: () => (process.env.LOVE23_PROMO_START || '').trim() || null,
};
let deps = { ...defaults };
function setDeps(p) { deps = { ...deps, ...p }; }
function resetDeps() { deps = { ...defaults }; sharedClient = null; sharedDb = null; }

const SPORTS = Object.values(SPORT_KEYS).filter((k) => k !== 'baseball_mlb');

function numParam(q, key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = q && q[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cfgFromQuery(q) {
  const D = R.DEFAULT_CONFIG;
  const credit = numParam(q, 'credit', null, { min: 0, max: 1e7 });
  return {
    maxBet: numParam(q, 'maxBet', 500, { min: 1, max: 500 }),
    weeksLeft: numParam(q, 'weeks', D.weeksLeft, { min: 1, max: 52 }),
    betsPerWeek: numParam(q, 'bpw', D.betsPerWeek, { min: 0, max: 2000 }),
    futureDriftPct: numParam(q, 'drift', D.futureDriftPct, { min: -0.2, max: 0.2 }),
    futureSdMult: numParam(q, 'sd', D.futureSdMult, { min: 0.1, max: 5 }),
    confirmPts: numParam(q, 'confirm', D.confirmPts, { min: 0.001, max: 0.2 }),
    rebateRate: numParam(q, 'rate', D.rebateRate, { min: 0, max: 1 }),
    weeklyLossCap: numParam(q, 'cap', D.weeklyLossCap, { min: 0, max: 1e7 }),
    weekStartDow: numParam(q, 'dow', D.weekStartDow, { min: 0, max: 6 }),
    creditLimit: credit && credit > 0 ? credit : null,
  };
}

function stateOverrides(q, ledgerState) {
  const has = (k) => q[k] != null && q[k] !== '';
  return {
    carry: has('carry') ? numParam(q, 'carry', 0, { min: 0 }) : (ledgerState ? ledgerState.carry : 0),
    weekNet: has('weekNet') ? numParam(q, 'weekNet', 0) : (ledgerState ? ledgerState.weekNet : 0),
    source: has('carry') || has('weekNet') ? 'query' : (ledgerState ? 'ledger' : 'default'),
  };
}

async function loadOdds(db, nowMs) {
  const odds = {};
  const events = {};
  if (!db) return { odds, events, error: 'Supabase service key not configured' };
  const { data, error } = await db.from('odds_cache').select('sport,data,fetched_at').in('sport', SPORTS);
  if (error) return { odds, events, error: error.message };
  for (const row of data || []) odds[row.sport] = { fetchedAt: row.fetched_at, games: Array.isArray(row.data) ? row.data : [] };
  const ev = await db.from('event_odds_cache').select('event_id,data,fetched_at')
    .in('sport', SPORTS).gt('commence_time', new Date(nowMs).toISOString());
  if (!ev.error) for (const row of ev.data || []) events[row.event_id] = row.data;
  return { odds, events, error: null };
}

async function loadLedger(db, promoStart, cfg, nowMs, atRisk = 0) {
  if (!db) return { ledger: computeLedger({ promoStart, cfg, nowMs, atRisk }), entries: [], daily: [], error: 'Supabase service key not configured' };
  const [d, e] = await Promise.all([
    db.from('love23_daily').select('date,win_loss').order('date', { ascending: true }),
    db.from('love23_ledger').select('*').order('created_at', { ascending: false }).limit(500),
  ]);
  const err = (d.error || e.error) ? 'Run sql/20261030_love23_ledger.sql in Supabase (love23_daily / love23_ledger missing?)' : null;
  const daily = (d.data || []).map((r) => ({ date: r.date, winLoss: Number(r.win_loss) }));
  const entries = e.data || [];
  return { ledger: computeLedger({ daily, entries, promoStart, cfg, nowMs, atRisk }), entries, daily, error: err };
}

function pickView(r) {
  const s = r.sel;
  return {
    key: `${s.legId}`,
    sportKey: s.sportKey,
    kickoff: new Date(s.kickoffMs).toISOString(),
    game: `${s.away} @ ${s.home}`,
    kind: s.kind,
    market: s.market,
    side: s.side,
    team: s.team || null,
    point: s.point,
    love23American: Number(s.american),
    love23OppAmerican: Number(s.oppAmerican),
    love23LegId: s.legId,
    fairAmerican: r.fairAmerican,
    fairP: r.fairP,
    fairSource: r.fairSource,
    pinnacleFairAmerican: r.pinFair != null ? R.probToAmerican(r.pinFair) : null,
    pmFairAmerican: r.pmFair != null ? R.probToAmerican(r.pmFair) : null,
    stake: r.stake,
    commission: r.commission,
    love23Ev: r.l23Ev,
    love23EvPct: r.l23EvPct,
    rebateValue: r.rebateValue,
    totalUnhedged: r.totalUnhedged,
    hedge: r.hedge ? {
      venue: r.hedge.venue,
      venueLabel: VENUE_LABEL[r.hedge.venue] || r.hedge.venue,
      outcome: r.hedgeName,
      point: r.hedgePoint,
      american: r.hedge.american,
      hedgeStake: r.hedge.hedgeStake,
      stakeRatio: r.hedge.stakeRatio,
      neededProfit: r.hedge.neededProfit,
      depthProfit: r.hedge.depthProfit,
      depthOk: r.hedge.depthOk,
      lockedPnl: r.hedge.lockedPnl,
      hedgeEv: r.hedge.hedgeEv,
    } : null,
    totalHedged: r.totalHedged != null ? r.totalHedged : null,
    flags: r.flags,
  };
}

async function handlePicks(req, res) {
  const q = req.query || {};
  const cfg = cfgFromQuery(q);
  const nowMs = deps.now();
  const db = deps.db();
  let sched;
  try {
    sched = await deps.love23().schedule(DEFAULT_LEAGUE_IDS);
  } catch (e) {
    const status = e instanceof Love23Error && e.status === 503 ? 503 : 502;
    res.status(status).json({ error: e.message || 'love23 unavailable' });
    return;
  }
  const [{ odds, events, error: oddsError }, led] = await Promise.all([
    loadOdds(db, nowMs),
    loadLedger(db, deps.promoStart(), cfg, nowMs),
  ]);
  const st = stateOverrides(q, led && !led.error ? led.ledger.state : null);
  const ctx = Wk.buildContext({ state: st, cfg, nowMs });
  const { games, selections } = parseSchedule(sched.data);
  const rows = evaluateAll({ selections, games, odds, events, state: { ...st, ctx }, cfg, nowMs });
  const flagged = q.flagged === '1' || q.flagged === 'true';
  const ranked = rankPicks(rows, { includeFlagged: flagged });
  const counts = rows.reduce((acc, r) => {
    for (const f of r.flags || []) acc[f] = (acc[f] || 0) + 1;
    return acc;
  }, {});
  const outlook = Wk.weekOutlook(ctx);
  const cleanTop = ranked.filter((r) => !r.flags.includes('next_week')).slice(0, Math.max(1, ctx.betsLeftThisWeek || 1));
  const avgLock = cleanTop.length ? cleanTop.reduce((s2, r) => s2 + r.hedge.lockedPnl, 0) / cleanTop.length : null;
  // One bet per game side is enough for the plan; repeat lines (alts) would overstate depth.
  const seenGames = new Set();
  const planPicks = ranked.filter((r) => !r.flags.includes('next_week'))
    .filter((r) => (seenGames.has(r.sel.gameLink) ? false : (seenGames.add(r.sel.gameLink), true)))
    .map((r) => ({ p: r.fairP, win: r.stake * (R.americanToDecimal(r.sel.american) - 1), risk: r.risk, lock: r.hedge.lockedPnl }));
  const plan = Wk.planTable({ picks: planPicks, cfg, carry: st.carry });
  res.status(200).json({
    picks: ranked.slice(0, 60).map(pickView),
    totals: { love23Lines: selections.length, evaluated: rows.filter((r) => !r.skipped).length, ranked: ranked.length, flags: counts },
    state: { carry: st.carry, weekNet: st.weekNet, source: st.source },
    weekly: {
      weekStart: Wk.weekStartOf(Wk.etDate(nowMs), cfg.weekStartDow),
      betsLeftThisWeek: ctx.betsLeftThisWeek,
      weeksLeft: cfg.weeksLeft,
      plannedWeekMu: ctx.weekMu,
      plannedWeekSd: ctx.weekSd,
      pThisWeekPastCarry: outlook.pPastCarry,
      expectedRebateThisWeek: outlook.expectedRebateThisWeek,
      expectedOwedThisWeek: outlook.expectedOwedThisWeek,
      expectedRebateRestOfPromo: outlook.expectedRebateTotal,
      avgLockTopPicks: avgLock,
      plan,
      note: 'Rebate values assume the plan in config (bets/week at max bet, drift, SD) for the rest of the promo, hedged so only love23 P&L drives the rebate.',
    },
    config: cfg,
    meta: {
      love23FetchedAt: new Date(sched.fetchedAt).toISOString(),
      love23Stale: !!sched.stale,
      love23BackoffUntil: sched.backoffUntil ? new Date(sched.backoffUntil).toISOString() : null,
      oddsFetchedAt: Object.fromEntries(Object.entries(odds).map(([k, v]) => [k, v.fetchedAt])),
      oddsError: oddsError || null,
      ledgerError: led ? led.error : null,
      note: 'Odds API Pinnacle trailed love23 by ~3-10 min on Oct 30; line_moved / stale_odds picks are held back.',
    },
  });
}

async function persistDaily(db, daily) {
  if (!db || !daily.length) return null;
  const rows = daily.map((d) => ({ date: d.date, win_loss: d.winLoss, orders: d.orders, updated_at: new Date().toISOString() }));
  const { error } = await db.from('love23_daily').upsert(rows, { onConflict: 'date' });
  return error ? error.message : null;
}

async function handleAccount(req, res) {
  const cfg = cfgFromQuery(req.query || {});
  const l = deps.love23();
  const db = deps.db();
  let bal; let prof; let open; let settled;
  try {
    [bal, prof, open, settled] = await Promise.all([l.balance(), l.profile(), l.openBets(), l.settled()]);
  } catch (e) {
    res.status(e instanceof Love23Error && e.status === 503 ? 503 : 502).json({ error: e.message || 'love23 unavailable' });
    return;
  }
  const daily = settledDailyFromApi(settled.data);
  const persistError = await persistDaily(db, daily);
  const led = await loadLedger(db, deps.promoStart(), cfg, deps.now(), Number(bal.data && bal.data.atRisk) || 0);
  const p = prof.data || {};
  res.status(200).json({
    balance: bal.data || null,
    limits: { minWager: p.minWager ?? null, maxWager: p.maxWager ?? null, message: typeof p.message === 'string' ? p.message.trim() : null },
    openBets: open.data || [],
    settled: settled.data || [],
    ledger: led.ledger,
    entries: led.entries,
    promoStart: deps.promoStart(),
    errors: { persist: persistError, ledger: led.error },
    fetchedAt: new Date(bal.fetchedAt).toISOString(),
  });
}

const RESULTS = new Set(['open', 'won', 'lost', 'push', 'void']);

function hedgePnl(american, stake, result) {
  if (result === 'won') return R.profitAtAmerican(stake, american);
  if (result === 'lost') return -Number(stake);
  return 0;
}

async function handlePost(req, res) {
  const db = deps.db();
  if (!db) { res.status(503).json({ error: 'Supabase service key not configured' }); return; }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const op = String(body.op || '');
  const str = (v, n = 200) => (v == null ? null : String(v).slice(0, n));
  if (op === 'hedge-add') {
    const american = Number(body.american);
    const stake = Number(body.stake);
    if (!R.americanToDecimal(american) || !(stake > 0)) { res.status(400).json({ error: 'american (e.g. -120 / +150) and stake > 0 required' }); return; }
    const venue = String(body.venue || '').toLowerCase();
    if (!['kalshi', 'polymarket', 'novig', 'prophetx'].includes(venue)) { res.status(400).json({ error: 'venue must be kalshi, polymarket, novig or prophetx' }); return; }
    const row = { kind: 'hedge', game: str(body.game), market: str(body.market, 60), venue, side: str(body.side), american, stake, result: 'open', pnl: 0, note: str(body.note, 500), love23_ticket: str(body.love23Ticket, 60) };
    const { data, error } = await db.from('love23_ledger').insert(row).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ entry: data });
    return;
  }
  if (op === 'hedge-settle') {
    const result = String(body.result || '');
    if (!RESULTS.has(result) || !body.id) { res.status(400).json({ error: 'id and result required' }); return; }
    const { data: cur, error: e1 } = await db.from('love23_ledger').select('*').eq('id', body.id).single();
    if (e1 || !cur) { res.status(404).json({ error: 'entry not found' }); return; }
    const pnl = body.pnl != null && Number.isFinite(Number(body.pnl)) ? Number(body.pnl) : hedgePnl(cur.american, cur.stake, result);
    const { data, error } = await db.from('love23_ledger').update({ result, pnl, settled_at: new Date().toISOString() }).eq('id', body.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ entry: data });
    return;
  }
  if (op === 'hedge-delete') {
    if (!body.id) { res.status(400).json({ error: 'id required' }); return; }
    const { error } = await db.from('love23_ledger').delete().eq('id', body.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }
  if (op === 'adjust' || op === 'carry' || op === 'settlement') {
    const pnl = Number(body.pnl);
    if (!Number.isFinite(pnl)) { res.status(400).json({ error: 'pnl (number) required' }); return; }
    if (op === 'carry' && pnl < 0) { res.status(400).json({ error: 'carry is a profit balance (>= 0)' }); return; }
    const { data, error } = await db.from('love23_ledger').insert({ kind: op, pnl, note: str(body.note, 500) }).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ entry: data });
    return;
  }
  res.status(400).json({ error: 'unknown op' });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const gate = await deps.requireOwner(req);
    if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }
    if (req.method === 'GET') {
      const view = String((req.query && req.query.view) || 'picks');
      if (view === 'account') return await handleAccount(req, res);
      return await handlePicks(req, res);
    }
    if (req.method === 'POST') return await handlePost(req, res);
    res.status(405).json({ error: 'GET or POST only' });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
}

module.exports = handler;
module.exports.setDeps = setDeps;
module.exports.resetDeps = resetDeps;
module.exports.cfgFromQuery = cfgFromQuery;
module.exports.pickView = pickView;
module.exports.hedgePnl = hedgePnl;
