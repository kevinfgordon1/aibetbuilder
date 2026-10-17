// /api/raw-parlay-edges — Kevin only (combo-probe-lib isComboOwner: owner email AND owner id).
// PREVIEW, read-only. Reads combo-worker's noboost paper RFQ log (public.noboost_paper_rfqs,
// RLS on with no client policies, so only this service-key route can read it) and returns the
// Kalshi parlay RFQs where the best price traders paid was well worse than fair.
// Never quotes, confirms, or trades anything.
//
// GET ?days=1..7&edge=<American X>&minCost=<$>&market=all|ml|td&fair=kalshi|pm|promo&venue=all|kalshi|polymarket  →
//   venue: Kalshi and Polymarket US parlay RFQs (venue column; Polymarket rows use the Poly combo fee / tick math).
//   fair=pm (default): inverse bet (live). fair=kalshi: Kalshi mid. fair=promo: moneyline legs use the Promo / boost inverse-bet fair the noboost logger
//   stores (fair_promo_best_american: Π (1 − implied(best guarded opposing price across trusted
//   books + exchanges)), from odds_cache). Rows whose sportsbook data is older than
//   PROMO_MAX_AGE_MS are skipped. (Superseded Oct 16: inverse bet live only, ML + TD.)
//   { ok, makerRate, series, edges: [...union of the top MAX_RETURN by every sort key], complete, days: [{ day, count, ev, maxLoss }], scanned,
//     skipped: { noFair: { total, byVenue, byDay }, beforeLive: { total, byVenue }, windowStart, requestedStart, earliestAvailable } }
'use strict';

const lib = require('./combo-probe-lib');
const seriesFee = require('./kalshi-series-fee');

let edgesMod = null;
let buyerOdds = null;
let riskMod = null;
let legsMod = null;
async function mods() {
  if (!legsMod) legsMod = await import('../src/sniperLegs.js');
  // src/*.js are ESM; dynamic import from this CommonJS route (static require throws on Vercel).
  if (!edgesMod) edgesMod = await import('../src/rawParlayEdges.js');
  if (!buyerOdds) buyerOdds = await import('../src/buyerOdds.js');
  if (!riskMod) riskMod = await import('../src/parlayRisk.js');
  return { edgesMod, buyerOdds, riskMod, legsMod };
}

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, lookupSeries: seriesFee._helpers.lookup, now: () => Date.now(), fetch: (...a) => fetch(...a) });
const RELAY_FALLBACK = 'https://odds-relay-production-34da.up.railway.app';
let deps = freshDeps();
const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
const COLS = 'rfq_id,rfq_created_ts,market_ticker,n_legs,legs,contracts,rfq_target_cost,fair_mid_american,fair_promo_best_american,promo_max_age_ms,fair_pm_inverse_american,traded_yes,traded_contracts,outcome,venue,legs_kalshi,poly_tick_size';
const PAGE = 1000;
const MAX_ROWS = 400000;
const SNIPER_TABLE = 'combo_sniper_traded';
const PASS_COL = { kalshi: 'pass_kalshi', pm: 'pass_pm', promo: 'pass_promo' };
// Per sort key. The response keeps the union of the top MAX_RETURN by EV/$100, EV and size, so whichever sort the
// page uses its top rows are all present (the old top-200-by-EV cut dropped high-margin small rows, e.g. Polymarket).
const MAX_RETURN = 2500;
// odds_cache is refreshed by a 5-minute cron; allow one missed tick of slack.
const PROMO_MAX_AGE_MS = 6 * 60 * 1000;

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

function parseOpts(q) {
  const num = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const days = Math.min(7, Math.max(1, Math.round(num(q.days, 1))));
  const edge = Math.min(100000, Math.max(0, num(q.edge, 500)));
  const minCost = Math.max(0, num(q.minCost, 0));
  const market = ['all', 'ml', 'td'].includes(String(q.market || '')) ? String(q.market) : 'all';
  // Kevin (Oct 16): EVERYTHING on Combo Sniper uses the inverse bet method (live). No other fair.
  const fair = 'pm';
  const venue = ['all', 'kalshi', 'polymarket'].includes(String(q.venue || '')) ? String(q.venue) : 'all';
  return { days, edge, minCost, market, fair, venue };
}

// Kevin (Oct 16): only show requests logged at/after the inverse-bet-everywhere go-live (3:22 PM ET).
// Older rows stay in the database, hidden. Applies to every window, the risk card and the counts.
const INVERSE_LIVE_ISO = '2026-10-16T19:22:00.000Z';
/** Start of the ET day `days-1` days ago (never before INVERSE_LIVE_ISO), as ISO. */
function sinceIso(nowMs, days) {
  const iso = sinceIsoRaw(nowMs, days);
  return iso < INVERSE_LIVE_ISO ? INVERSE_LIVE_ISO : iso;
}
function sinceIsoRaw(nowMs, days) {
  const etNow = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const offsetMs = Math.round((new Date(nowMs).getTime() - etNow.getTime()) / 60000) * 60000;
  const start = new Date(etNow.getFullYear(), etNow.getMonth(), etNow.getDate() - (days - 1));
  return new Date(start.getTime() + offsetMs).toISOString();
}

const FAIR_COL = { kalshi: 'fair_mid_american', promo: 'fair_promo_best_american', pm: 'fair_pm_inverse_american' };
// Reads combo_sniper_traded: a trigger-synced narrow copy of traded noboost_paper_rfqs rows with a per-fair
// prefilter flag (pass_kalshi / pass_pm / pass_promo = traded_yes > P(fair) − 0.001). A row can only be flagged
// when traded_yes > P(fair) (flag needs y < traded_yes and ev > 0 ⇒ y > P), so the prefilter drops nothing that
// scoreRawEdge would flag. The window is split into time slices fetched in parallel, each keyset-paged.
const SLICES = 12;
const SLICE_CONCURRENCY = 6;
async function fetchSlice(client, lo, hi, minCost, { fair, venue }) {
  const out = [];
  const seen = new Set();
  let before = null;
  for (;;) {
    let q = client.from(SNIPER_TABLE).select(COLS)
      .eq(PASS_COL[fair] || PASS_COL.kalshi, true)
      .gte('rfq_created_ts', lo);
    q = before ? q.lte('rfq_created_ts', before) : q.lt('rfq_created_ts', hi);
    if (venue !== 'all') q = q.eq('venue', venue);
    if (minCost > 0) q = q.gte('rfq_target_cost', minCost);
    const { data, error } = await q.order('rfq_created_ts', { ascending: false }).limit(PAGE);
    if (error) throw error;
    const rows = data || [];
    let added = 0;
    for (const r of rows) {
      if (r == null || seen.has(r.rfq_id)) continue;
      if (before && !(r.rfq_created_ts < hi)) continue;
      seen.add(r.rfq_id); out.push(r); added++;
    }
    if (rows.length < PAGE || added === 0) break;
    const last = rows[rows.length - 1] && rows[rows.length - 1].rfq_created_ts;
    if (!last || last === before) break;
    before = last; // lte + rfq_id dedupe keeps rows that share the boundary timestamp
  }
  return out;
}
async function fetchRows(client, since, minCost, { fair = 'kalshi', venue = 'all' } = {}, nowMs = Date.now()) {
  const t0 = Date.parse(since), t1 = nowMs + 60000;
  const step = Math.max(1, Math.ceil((t1 - t0) / SLICES));
  const bounds = [];
  for (let t = t0; t < t1; t += step) bounds.push([new Date(t).toISOString(), new Date(Math.min(t + step, t1)).toISOString()]);
  const results = new Array(bounds.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(SLICE_CONCURRENCY, bounds.length) }, async () => {
    while (next < bounds.length) { const i = next++; results[i] = await fetchSlice(client, bounds[i][0], bounds[i][1], minCost, { fair, venue }); }
  }));
  const out = [];
  for (let i = results.length - 1; i >= 0; i--) out.push(...results[i]); // newest slice first
  return out.slice(0, MAX_ROWS);
}

/** Traded requests in the window the scan can't score because there's no inverse-bet fair (logged NULL), plus requests
 *  hidden because they're before the inverse-bet go-live. Read-only counts; failures return null (never block the scan). */
async function skippedCounts(client, { requestedStart, windowStart, minCost, venue, nowMs }) {
  const out = { noFair: null, beforeLive: null, windowStart, requestedStart, earliestAvailable: null };
  const scope = (q) => { if (venue !== 'all') q = q.eq('venue', venue); if (minCost > 0) q = q.gte('rfq_target_cost', minCost); return q; };
  try {
    const { data, error } = await scope(client.from(SNIPER_TABLE).select('rfq_id,rfq_created_ts,venue')
      .is('fair_pm_inverse_american', null).gte('rfq_created_ts', windowStart).lt('rfq_created_ts', new Date(nowMs + 60000).toISOString()))
      .order('rfq_created_ts', { ascending: false }).limit(10000);
    if (error) throw error;
    const byVenue = {}, byDay = {};
    for (const r of data || []) {
      const v = r.venue === 'polymarket' ? 'polymarket' : 'kalshi';
      byVenue[v] = (byVenue[v] || 0) + 1;
      const d = etDayKeyLocal(r.rfq_created_ts);
      byDay[d] = byDay[d] || {}; byDay[d][v] = (byDay[d][v] || 0) + 1;
    }
    out.noFair = { total: (data || []).length, byVenue, byDay };
  } catch (_) { /* counts are informational */ }
  try {
    if (requestedStart < windowStart) {
      const byVenue = {};
      for (const v of venue === 'all' ? ['kalshi', 'polymarket'] : [venue]) {
        let q = client.from(SNIPER_TABLE).select('rfq_id', { count: 'exact', head: true }).eq('venue', v)
          .gte('rfq_created_ts', requestedStart).lt('rfq_created_ts', windowStart);
        if (minCost > 0) q = q.gte('rfq_target_cost', minCost);
        const { count, error } = await q;
        if (error) throw error;
        byVenue[v] = count || 0;
      }
      out.beforeLive = { total: Object.values(byVenue).reduce((a, b) => a + b, 0), byVenue };
    } else out.beforeLive = { total: 0, byVenue: {} };
  } catch (_) { /* informational */ }
  try {
    const { data, error } = await client.from(SNIPER_TABLE).select('rfq_created_ts').order('rfq_created_ts', { ascending: true }).limit(1);
    if (!error && data && data[0]) out.earliestAvailable = data[0].rfq_created_ts;
  } catch (_) { /* informational */ }
  return out;
}
function etDayKeyLocal(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? 'unknown' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function publicError(e) {
  const msg = String((e && e.message) || e || 'Unknown error');
  if (/statement timeout/i.test(msg)) return 'Database query timed out — try a shorter range or a higher Min $ filter.';
  return 'Server error: ' + msg.slice(0, 160);
}

/** Row with fair_mid_american set to the live inverse-bet fair, or null if it is missing/stale.
 *  ML legs: 1 − best opposing $500 price across Kalshi / Polymarket US / Novig / ProphetX (<15s).
 *  TD legs: 1 − opposite-side $500 Kalshi VWAP. Parlay = product (noboost-paper logger). */
function fairRow(r) {
  if (r.fair_pm_inverse_american == null) return null;
  return { ...r, fair_kalshi_american: r.fair_mid_american, fair_mid_american: r.fair_pm_inverse_american };
}

// GET ?legs=<rfq_id> → { ok, legs: [...] }: one compact Combo Locks-style row per leg for an expanded Sniper row.
// Fair + best opp come from the inverse-bet leg detail logged at request time (pm_inverse_legs); live relay boards only
// add kickoff times and a "now" price/size. Board failures never fail the request.
async function legDetail(svc, rfqId, L, E) {
  const { data, error } = await svc.from('noboost_paper_rfqs').select('rfq_id,venue,legs,legs_kalshi,pm_inverse_legs').eq('rfq_id', rfqId).limit(1);
  if (error) throw error;
  const row = data && data[0];
  if (!row) return { ok: false, status: 404, error: 'Request not found' };
  const env = deps.env || process.env;
  const base = String(env.ODDS_RELAY_URL || env.VITE_ODDS_RELAY_URL || RELAY_FALLBACK).replace(/\/+$/, '');
  const boards = { kalshi: [], polymarket: [], novig: [] };
  const legsRaw = E.canonicalLegs(row);
  const leagues = [...new Set(legsRaw.map((l) => (/^KXNCAAF/.test(l) ? 'NCAAF' : 'NFL')))];
  await Promise.all(leagues.flatMap((lg) => Object.keys(boards).map(async (v) => {
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const t = ctl ? setTimeout(() => ctl.abort(), 4000) : null;
      const r = await deps.fetch(`${base}/board?venue=${v}&league=${lg}`, { headers: { accept: 'application/json' }, signal: ctl ? ctl.signal : undefined });
      if (t) clearTimeout(t);
      if (r && r.ok) { const j = await r.json(); boards[v].push(...((j && j.quotes) || [])); }
    } catch (_) { /* kickoff / now are optional */ }
  })));
  return { ok: true, legs: L.buildLegRows(legsRaw, row.pm_inverse_legs, L.indexBoards(boards)) };
}

async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'GET only' });
  const auth = await requireOwner(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return json(res, 503, { ok: false, error: 'Server is not configured' });
  try {
    const { edgesMod: E, buyerOdds: B, riskMod: R, legsMod: L } = await mods();
    const svc = deps.createClient(url, key, clientOpts);
    const legsFor = req.query && typeof req.query.legs === 'string' ? req.query.legs.trim() : '';
    if (legsFor) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(legsFor)) return json(res, 400, { ok: false, error: 'Bad request id' });
      const out = await legDetail(svc, legsFor, L, E);
      return out.ok ? json(res, 200, out) : json(res, out.status, { ok: false, error: out.error });
    }
    const opts = parseOpts(req.query || {});
    const windowStart = sinceIso(deps.now(), opts.days);
    const [rows, skipped] = await Promise.all([
      fetchRows(svc, windowStart, opts.minCost, opts, deps.now()),
      skippedCounts(svc, { requestedStart: sinceIsoRaw(deps.now(), opts.days), windowStart, minCost: opts.minCost, venue: opts.venue, nowMs: deps.now() }),
    ]);
    // Exact maker rate per series (Kalshi GET /series fee_type × multiplier).
    const seriesList = [...new Set(rows.filter((r) => r.venue !== 'polymarket').map((r) => B.seriesOfTicker(r.market_ticker)).filter(Boolean))];
    const rates = {};
    await Promise.all(seriesList.map(async (s) => {
      let v = null;
      try { v = await deps.lookupSeries(s); } catch (_) { v = null; }
      rates[s] = { rate: v ? B.makerRateFromSeries(v.fee_type, v.fee_multiplier) : B.FALLBACK_MAKER_RATE, fee_type: v ? v.fee_type : null, known: !!v };
    }));
    const edges = [];
    let staleSkipped = 0;
    const priced = [];
    for (const r0 of rows) {
      const r = fairRow(r0);
      if (!r) { staleSkipped += 1; continue; }
      priced.push(r);
      const s = r.venue === 'polymarket' ? null : B.seriesOfTicker(r.market_ticker);
      const makerRate = r.venue === 'polymarket' ? 0 : (s && rates[s] ? rates[s].rate : B.FALLBACK_MAKER_RATE);
      const e = E.scoreRawEdge(r, { edgeAmerican: opts.edge, makerRate });
      if (e) { e.kalshiFairAmerican = r.fair_kalshi_american != null ? Number(r.fair_kalshi_american) : null; e.summary = E.legSummary(e.legsRaw); }
      if (e && e.flagged && E.matchesMarket(e, opts.market) && E.matchesVenue(e, opts.venue)) edges.push(e);
    }
    const days = E.summarizeByDay(edges);
    // Portfolio risk if we'd filled every flagged row: exact worst/best case across shared legs and
    // opposite sides of one game. Per-game fair probs fitted from that day's parlay fairs.
    const rowsByDay = new Map();
    for (const r of priced) { const k = E.etDayKey(r.rfq_created_ts); if (!rowsByDay.has(k)) rowsByDay.set(k, []); rowsByDay.get(k).push({ legs: E.canonicalLegs(r), fairProb: E.probFromAmerican(r.fair_mid_american) }); }
    const merged = {};
    for (const d of [...days].reverse()) { // oldest → newest, so newest fit wins in `merged`
      const probs = R.fitEventProbs(rowsByDay.get(d.day) || []);
      Object.assign(merged, probs);
      d.risk = R.portfolioRisk(E.toRiskPositions(edges.filter((e) => e.day === d.day)), { eventProbs: probs });
      delete d.risk.worstOutcome;
    }
    const total = edges.length ? R.portfolioRisk(E.toRiskPositions(edges), { eventProbs: merged }) : null;
    if (total) delete total.worstOutcome;
    // Cut AFTER ranking by every sort key (EV/$100, EV, size), never by EV alone — see MAX_RETURN.
    const top = E.topForEverySort(edges, MAX_RETURN);
    const slim = top.edges.map(({ legsRaw, bestTraderAmerican, offerAmerican, offerYes, ...e }) => e);
    return json(res, 200, { ok: true, opts, series: rates, scanned: rows.length, staleSkipped, skipped, fairSource: opts.fair, truncated: rows.length >= MAX_ROWS, days, risk: total, edges: slim, complete: top.complete, total: edges.length });
  } catch (e) {
    console.error('[raw-parlay-edges]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: publicError(e) });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 300 };
module.exports._setDeps = (patch) => { deps = { ...deps, ...patch }; };
module.exports._resetDeps = () => { deps = freshDeps(); };
module.exports._helpers = { parseOpts, sinceIso, sinceIsoRaw, MAX_RETURN };
