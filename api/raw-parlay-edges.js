// /api/raw-parlay-edges — Kevin only (combo-probe-lib isComboOwner: owner email AND owner id).
// PREVIEW, read-only. Reads combo-worker's noboost paper RFQ log (public.noboost_paper_rfqs,
// RLS on with no client policies, so only this service-key route can read it) and returns the
// Kalshi parlay RFQs where the best price traders paid was well worse than fair.
// Never quotes, confirms, or trades anything.
//
// GET ?days=1..7&edge=<American X>&minCost=<$>&market=all|ml|td&fair=promo|kalshi  →
//   fair=promo (default): moneyline legs use the Promo / boost inverse-bet fair the noboost logger
//   stores (fair_promo_best_american: Π (1 − implied(best guarded opposing price across trusted
//   books + exchanges)), from odds_cache). Rows whose sportsbook data is older than
//   PROMO_MAX_AGE_MS are skipped. TD legs keep their $500 Yes/No devig fair. fair=kalshi: old Kalshi mid.
//   { ok, makerRate, series, edges: [...top 200 by EV], days: [{ day, count, ev, maxLoss }], scanned }
'use strict';

const lib = require('./combo-probe-lib');
const seriesFee = require('./kalshi-series-fee');

let edgesMod = null;
let buyerOdds = null;
let riskMod = null;
async function mods() {
  // src/*.js are ESM; dynamic import from this CommonJS route (static require throws on Vercel).
  if (!edgesMod) edgesMod = await import('../src/rawParlayEdges.js');
  if (!buyerOdds) buyerOdds = await import('../src/buyerOdds.js');
  if (!riskMod) riskMod = await import('../src/parlayRisk.js');
  return { edgesMod, buyerOdds, riskMod };
}

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, lookupSeries: seriesFee._helpers.lookup, now: () => Date.now() });
let deps = freshDeps();
const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
const COLS = 'rfq_id,rfq_created_ts,market_ticker,n_legs,legs,contracts,rfq_target_cost,fair_mid_american,fair_promo_best_american,promo_max_age_ms,traded_yes,traded_contracts,outcome';
const PAGE = 1000;
const MAX_ROWS = 60000;
const MAX_RETURN = 200;
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
  const fair = String(q.fair || '') === 'kalshi' ? 'kalshi' : 'promo';
  return { days, edge, minCost, market, fair };
}

/** Start of the ET day `days-1` days ago, as ISO. */
function sinceIso(nowMs, days) {
  const etNow = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const offsetMs = Math.round((new Date(nowMs).getTime() - etNow.getTime()) / 60000) * 60000;
  const start = new Date(etNow.getFullYear(), etNow.getMonth(), etNow.getDate() - (days - 1));
  return new Date(start.getTime() + offsetMs).toISOString();
}

async function fetchRows(client, since, minCost) {
  const out = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = client.from('noboost_paper_rfqs').select(COLS)
      .eq('outcome', 'traded')
      .not('fair_mid_american', 'is', null)
      .gte('rfq_created_ts', since);
    if (minCost > 0) q = q.gte('rfq_target_cost', minCost);
    const { data, error } = await q.order('rfq_created_ts', { ascending: false }).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Row with fair_mid_american set to the chosen fair source, or null if that fair is missing/stale. */
function fairRow(r, fair, E) {
  if (fair === 'kalshi') return r;
  if (E.marketOf(r.legs) === 'td') return r; // TD legs: $500 Yes/No devig (no sportsbook TD fair in the logger yet)
  if (r.fair_promo_best_american == null) return null;
  if (!(Number(r.promo_max_age_ms) <= PROMO_MAX_AGE_MS)) return null;
  return { ...r, fair_kalshi_american: r.fair_mid_american, fair_mid_american: r.fair_promo_best_american };
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
    const { edgesMod: E, buyerOdds: B, riskMod: R } = await mods();
    const opts = parseOpts(req.query || {});
    const rows = await fetchRows(deps.createClient(url, key, clientOpts), sinceIso(deps.now(), opts.days), opts.minCost);
    // Exact maker rate per series (Kalshi GET /series fee_type × multiplier).
    const seriesList = [...new Set(rows.map((r) => B.seriesOfTicker(r.market_ticker)).filter(Boolean))];
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
      const r = fairRow(r0, opts.fair, E);
      if (!r) { staleSkipped += 1; continue; }
      priced.push(r);
      const s = B.seriesOfTicker(r.market_ticker);
      const makerRate = s && rates[s] ? rates[s].rate : B.FALLBACK_MAKER_RATE;
      const e = E.scoreRawEdge(r, { edgeAmerican: opts.edge, makerRate });
      if (e) e.kalshiFairAmerican = r.fair_kalshi_american != null ? Number(r.fair_kalshi_american) : null;
      if (e && e.flagged && E.matchesMarket(e, opts.market)) edges.push(e);
    }
    const days = E.summarizeByDay(edges);
    // Portfolio risk if we'd filled every flagged row: exact worst/best case across shared legs and
    // opposite sides of one game. Per-game fair probs fitted from that day's parlay fairs.
    const rowsByDay = new Map();
    for (const r of priced) { const k = E.etDayKey(r.rfq_created_ts); if (!rowsByDay.has(k)) rowsByDay.set(k, []); rowsByDay.get(k).push({ legs: r.legs, fairProb: E.probFromAmerican(r.fair_mid_american) }); }
    const merged = {};
    for (const d of [...days].reverse()) { // oldest → newest, so newest fit wins in `merged`
      const probs = R.fitEventProbs(rowsByDay.get(d.day) || []);
      Object.assign(merged, probs);
      d.risk = R.portfolioRisk(E.toRiskPositions(edges.filter((e) => e.day === d.day)), { eventProbs: probs });
      delete d.risk.worstOutcome;
    }
    const total = edges.length ? R.portfolioRisk(E.toRiskPositions(edges), { eventProbs: merged }) : null;
    if (total) delete total.worstOutcome;
    edges.sort((a, b) => b.ev - a.ev);
    return json(res, 200, { ok: true, opts, series: rates, scanned: rows.length, staleSkipped, fairSource: opts.fair, truncated: rows.length >= MAX_ROWS, days, risk: total, edges: edges.slice(0, MAX_RETURN).map(({ legsRaw, ...e }) => e), total: edges.length });
  } catch (e) {
    console.error('[raw-parlay-edges]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Something went wrong' });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
module.exports._setDeps = (patch) => { deps = { ...deps, ...patch }; };
module.exports._resetDeps = () => { deps = freshDeps(); };
module.exports._helpers = { parseOpts, sinceIso };
