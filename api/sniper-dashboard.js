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
  const isHedge = req.query && (req.query.hedge === '1' || req.query.hedge === 1);
  if (req.method !== 'GET' && !isHedge) return json(res, 405, { ok: false, error: 'GET only' });
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
    if (isHedge) return hedgeWrite(req, res, db, auth.user, nowMs);
    if (q.matched === '1' || q.matched === 1) return json(res, 200, await matched(db, env, nowMs));
    if (q.rootfor === '1' || q.rootfor === 1) return json(res, 200, await sniperRootFor(db, env, nowMs, q.check === '1'));
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
    const [openRows, recent, settledAll, latest] = await Promise.all([
      pageAll(() => db.from('sniper_ledger').select(LEDGER_COLS).eq('dry_run', dry).eq('status', 'open').order('created_at', { ascending: false })),
      // NBA volume (~35k ledger rows/hour) made the full 7-day scan hit the statement timeout.
      // Only filled rows matter for risk/P&L; unfilled quotes are needed just for the latest-300 list.
      pageAll(() => db.from('sniper_ledger').select(LEDGER_COLS).eq('dry_run', dry).gt('filled_contracts', 0).gte('created_at', since).order('created_at', { ascending: false })),
      pageAll(() => db.from('sniper_ledger').select('rfq_id,status,phase,risk,realized_pnl,settled_at,created_at,games,legs,dry_run,filled_cost,filled_fee').eq('dry_run', dry).gt('filled_contracts', 0).eq('phase', 'settled')),
      db.from('sniper_ledger').select(LEDGER_COLS).eq('dry_run', dry).gte('created_at', since).order('created_at', { ascending: false }).limit(300)
        .then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; }),
    ]);
    { const seen = new Set(recent.map((r) => r.rfq_id)); for (const r of latest) if (!seen.has(r.rfq_id)) recent.push(r); }
    const byId = new Map();
    for (const r of [...settledAll, ...recent, ...openRows]) byId.set(r.rfq_id, { ...(byId.get(r.rfq_id) || {}), ...r });
    let all = [...byId.values()];
    // Hedged open fills count at net worst-case loss (same as the sniper's caps once 20261023f is applied).
    if (!dry) {
      const Hg = await hedgeMod();
      const hedges = await loadHedges(db, all.filter((r) => r.status === 'open' && Number(r.filled_contracts) > 0).map((r) => r.rfq_id));
      all = all.map((r) => { const hs = Hg.activeHedges(hedges[r.rfq_id]); if (!hs.length || r.status !== 'open' || r.phase !== 'filled') return r;
        const x = Hg.hedgeSummary({ n: Number(r.filled_contracts), risk: Number(r.filled_cost) + Number(r.filled_fee) }, hs); return { ...r, risk: x.netRisk, gross_risk: Number(r.risk), hedged: true }; });
    }
    const todayKey = H.etDayKey(new Date(nowMs).toISOString());
    const risk = H.summarizeLedger(all, todayKey);
    const quotes = [...openRows, ...recent.filter((r) => r.status !== 'open')]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 300).map(H.quoteRow);
    const sums = await pageAll(() => db.from('sniper_decisions').select('created_at,details').eq('action', 'summary').gte('created_at', new Date(nowMs - 24 * 3600e3).toISOString()).order('created_at', { ascending: true }), 2000);
    const labels = await legLabels(quotes, [...risk.games, ...risk.filledGames]);
    return json(res, 200, { ok: true, book, status, caps: H.CAPS, risk, quotes, skips: H.skipsByHour(sums), ...labels });
  } catch (e) {
    console.error('[sniper-dashboard]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Could not load sniper data' });
  }
}

// Logged sportsbook hedges (sniper_hedges; service role only, Kevin only via requireOwner). Map rfq_id -> rows.
async function loadHedges(db, ids) {
  const out = {}; if (!ids.length) return out;
  try {
    const { data, error } = await db.from('sniper_hedges').select('id,rfq_id,book,american,stake,placed_at,notes,status,source,created_at,updated_at').in('rfq_id', ids.slice(0, 1000)).order('placed_at', { ascending: true });
    if (error) return out;
    for (const h of data || []) (out[h.rfq_id] || (out[h.rfq_id] = [])).push({ ...h, american: Number(h.american), stake: Number(h.stake) });
  } catch (_) { /* optional: no hedges = unhedged */ }
  return out;
}
// POST ?hedge=1 {rfqId, book, american, stake, placedAt?, notes?, source?} · PATCH ?hedge=1&id= {...} · DELETE ?hedge=1&id=
async function hedgeWrite(req, res, db, user, nowMs) {
  const q = req.query || {}; let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  const patch = {};
  if (b.book != null) { const v = String(b.book).trim(); if (!v || v.length > 40) return json(res, 400, { ok: false, error: 'Book is required (max 40 chars)' }); patch.book = v; }
  if (b.american != null) { const a = Math.round(Number(b.american)); if (!Number.isFinite(a) || (a > -100 && a < 100)) return json(res, 400, { ok: false, error: 'American odds must be +100 or more, or -100 or less' }); patch.american = a; }
  if (b.stake != null) { const v = Number(b.stake); if (!(v > 0) || v > 100000) return json(res, 400, { ok: false, error: 'Stake must be more than $0' }); patch.stake = Math.round(v * 100) / 100; }
  if (b.placedAt != null) { const t = Date.parse(b.placedAt); if (!Number.isFinite(t)) return json(res, 400, { ok: false, error: 'Bad placed time' }); patch.placed_at = new Date(t).toISOString(); }
  if (b.notes !== undefined) patch.notes = b.notes == null ? null : String(b.notes).slice(0, 500);
  if (b.status != null) { if (!['active', 'void'].includes(b.status)) return json(res, 400, { ok: false, error: 'Bad status' }); patch.status = b.status; }
  try {
    if (req.method === 'POST') {
      const rfq = String(b.rfqId || '');
      if (!rfq || patch.book == null || patch.american == null || patch.stake == null) return json(res, 400, { ok: false, error: 'rfqId, book, american and stake are required' });
      const { data: fill, error: fe } = await db.from('sniper_ledger').select('rfq_id,dry_run,filled_contracts').eq('rfq_id', rfq).limit(1);
      if (fe) throw new Error(fe.message);
      const f = fill && fill[0];
      if (!f || f.dry_run || !(Number(f.filled_contracts) > 0)) return json(res, 400, { ok: false, error: 'Hedges can only be logged on real fills' });
      const row = { rfq_id: rfq, status: 'active', source: b.source === 'book_arb' ? 'book_arb' : 'manual', created_by: user && user.id ? String(user.id) : null, ...patch };
      const { data, error } = await db.from('sniper_hedges').insert(row).select('id');
      if (error) throw new Error(error.message);
      return json(res, 200, { ok: true, id: data && data[0] && data[0].id });
    }
    const id = String(q.id || b.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { ok: false, error: 'Hedge id required' });
    if (req.method === 'PATCH') {
      if (!Object.keys(patch).length) return json(res, 400, { ok: false, error: 'Nothing to change' });
      const { error } = await db.from('sniper_hedges').update({ ...patch, updated_at: new Date(nowMs).toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      const { error } = await db.from('sniper_hedges').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { ok: false, error: 'POST, PATCH or DELETE' });
  } catch (e) {
    console.error('[sniper-hedges]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Could not save the hedge' });
  }
}
// Shift engine positions by their hedges (hit += payout − stake, miss −= stake) so root-for / live EV include them.
function hedgePositions(positions, hedges, Hg) {
  for (const p of positions) {
    const hs = Hg.activeHedges(hedges[p.id]); if (!hs.length) continue;
    const x = Hg.hedgeSummary({ n: 0, risk: 0 }, hs);
    p.hit += x.hitDelta; p.miss += x.missDelta; p.hedged = true;
  }
}
const hedgeMod = () => import('../src/sniperHedge.js');

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
  // Live EV uses the same open fills and the same four-venue sniper leg fairs as "What to root for".
  const liveRows = rows.filter((r) => r.status === 'open' && Number(r.filled_contracts) > 0 && r.phase !== 'settled' && !r.settled_at);
  const Hg = await hedgeMod();
  const hedges = await loadHedges(db, rows.filter((r) => Number(r.filled_contracts) > 0).map((r) => r.rfq_id));
  const hedgeOf = (r) => { const m = S.rowMoney(r); return Hg.hedgeSummary({ n: m.n, risk: m.risk, fair: m.fair, baseEv: m.ev }, hedges[r.rfq_id]); };
  const positions = S.enginePositions(liveRows, names);
  hedgePositions(positions, hedges, Hg);
  let root = null; let sweat = null; let starts = {};
  if (positions.length) {
    const R = rootForApi(); const M = await R._helpers.loadMods();
    const markets = await R._helpers.loadMarkets(M, positions.map((p) => ({ legs: p.legs })), env);
    await collegeStarts(markets, positions, deps.fetch || fetch);
    starts = markets.starts || {};
    const legFairFn = await sniperLegFairFn(db, env, liveRows, names, positions);
    root = M.computeRootFor({ parlays: [], extraPositions: positions, kalshiBooks: markets.kalshiBooks, relay: markets.relay, starts, now: nowMs, kalshiAt: markets.kalshiAt, legFairFn });
    fillTimeFallback(root, liveRows, S);
    // Needle: pregame = expected profit at the fair we sold at; now = live engine EV.
    const baseline = liveRows.reduce((a, r) => { const hg = hedgeOf(r); return a + (hg && hg.ev != null ? hg.ev : S.rowMoney(r).ev); }, 0);
    const started = Object.values(starts).some((t) => t && Date.parse(t) <= nowMs);
    sweat = { baseline, now: root.ev, started: true, preStarted: started };
    delete root.model;
  }
  const kick = (k) => { const g = S.legMeta(k, names).gameKey; const ev = String(k).split(':')[0].toUpperCase().split('-').slice(0, 2).join('-'); return starts[ev] || starts[g] || null; };
  const lab = await legLabels(rows.map((r) => ({ legs: r.legs || [] })), []);
  // Quote-time breakdown: the sniper's own "quoted" decision (legDetail = best venue, fair, depth per leg).
  const quoteAt = {};
  try {
    const ids = rows.filter((r) => Number(r.filled_contracts) > 0).map((r) => r.rfq_id).slice(0, 300);
    if (ids.length) {
      const { data: ds } = await db.from('sniper_decisions').select('rfq_id,created_at,details').in('rfq_id', ids).eq('action', 'quoted').order('created_at', { ascending: false });
      for (const d of ds || []) if (!quoteAt[d.rfq_id] && d.details) {
        const x = d.details;
        quoteAt[d.rfq_id] = { at: d.created_at, fee: x.fee != null ? Number(x.fee) : null, makerRate: x.makerRate != null ? Number(x.makerRate) : null, fairYes: x.fairYes, quoteYes: x.quoteYes, contracts: x.contracts, risk: x.risk, ev: x.ev, roi: x.roi,
          legDetail: (x.legDetail || []).map((l) => ({ ticker: l.ticker, side: l.side, name: l.name || null, fair: l.fair != null ? Number(l.fair) : null, venue: l.venue || null, depthUsd: l.depthUsd != null ? Number(l.depthUsd) : null, venues: l.venues || l.prices || null })) };
      }
    }
  } catch (_) { /* breakdown optional */ }
  // Sportsbook arb check (combo-worker writes action 'book_arb' on each fill + re-checks until kickoff). Latest per fill.
  const bookArb = {};
  try {
    const ids = rows.filter((r) => Number(r.filled_contracts) > 0).map((r) => r.rfq_id).slice(0, 300);
    if (ids.length) {
      const { data: ds } = await db.from('sniper_decisions').select('rfq_id,created_at,details').in('rfq_id', ids).eq('action', 'book_arb').order('created_at', { ascending: false });
      for (const d of ds || []) if (!bookArb[d.rfq_id] && d.details) {
        const x = d.details;
        bookArb[d.rfq_id] = { at: d.created_at, reason: x.reason || null, hedgeable: !!x.hedgeable, sgp: !!x.sgp, soldAmerican: x.soldAmerican ?? null,
          books: (x.books || []).slice(0, 8).map((b) => ({ book: b.book, label: b.label, american: b.american, stake: b.stake, locked: b.locked, roi: b.roi, arb: !!b.arb })),
          legs: (x.legs || []).map((l) => ({ ticker: l.ticker, side: l.side, name: l.name || null, reason: l.reason, prices: l.prices || {} })) };
      }
    }
  } catch (_) { /* optional */ }
  const list = rows.map((r) => {
    const m = S.rowMoney(r); const hg = hedgeOf(r);
    return { rfqId: r.rfq_id, status: S.matchedStatus(r), filledAt: r.updated_at || r.created_at, createdAt: r.created_at, settledAt: r.settled_at,
      legs: (r.legs || []).map((k) => ({ ...S.legMeta(k, names), ...(lab.legInfo[k] ? { bet: lab.legInfo[k].bet, game: lab.legInfo[k].game } : {}), kickoff: kick(k) || (lab.legInfo[k] && lab.legInfo[k].kickoff) || null, result: legResults[String(k).split(':')[0].toUpperCase()] || null })),
      fairYes: m.fair, soldYes: m.sold, contracts: m.n, filled: Number(r.filled_contracts) > 0, risk: m.risk, toWin: m.toWin, ev: m.ev, edge: r.roi != null ? Number(r.roi) : null, pnl: r.realized_pnl != null ? Number(r.realized_pnl) : null, fee: r.filled_fee != null ? Number(r.filled_fee) : r.fee != null ? Number(r.fee) : null, quote: quoteAt[r.rfq_id] || null, bookArb: bookArb[r.rfq_id] || null,
      hedges: hedges[r.rfq_id] || [], hedge: hg, ...(hg && hg.ev != null ? { evUnhedged: m.ev, ev: hg.ev } : {}) };
  });
  const hedgedList = list.filter((x) => x.hedge && x.status === 'open');
  const hedgeTotals = { fills: hedgedList.length, locked: hedgedList.filter((x) => x.hedge.locked).length, stake: hedgedList.reduce((a, x) => a + x.hedge.stake, 0),
    worst: hedgedList.reduce((a, x) => a + x.hedge.worst, 0), freed: hedgedList.reduce((a, x) => a + x.hedge.freed, 0) };
  return { ok: true, empty: false, asOf: new Date(nowMs).toISOString(), rows: list, perf, root, sweat, hedgeTotals };
}

// "What to root for" (Combo Locks sheet) over live, filled, unsettled sniper positions. The sniper is the HOUSE
// (hit = all legs win = we lose our cost), so the engine's "root for" outcomes are the ones that beat the legs.
// Same response shape as /api/root-for so src/RootFor.jsx renders it unchanged.
async function sniperRootFor(db, env, nowMs, checkOnly) {
  const S = matchedMod || (matchedMod = await import('../src/sniperMatched.js'));
  const rows = (await pageAll(() => db.from('sniper_ledger').select(LEDGER_COLS).eq('dry_run', false).eq('status', 'open').gt('filled_contracts', 0).order('created_at', { ascending: false })))
    .filter((r) => r.phase !== 'settled' && !r.settled_at && S.isMatched(r));
  if (checkOnly) return { ok: true, locks: rows.length, days: 0 };
  const asOf = new Date(nowMs).toISOString();
  if (!rows.length) return { ok: true, empty: true, locksTotal: 0, asOf };
  const tickers = [...new Set(rows.flatMap((r) => (r.legs || []).map((k) => String(k).split(':')[0].toUpperCase())))];
  const mk = await kalshiMarkets(tickers.filter((t) => /^KXNFLTD/.test(t)));
  const names = {}; for (const [t, m] of Object.entries(mk)) names[t] = m.title || m.yes_sub_title;
  const positions = S.enginePositions(rows, names);
  const Hg = await hedgeMod();
  const hedges = await loadHedges(db, rows.map((r) => r.rfq_id));
  hedgePositions(positions, hedges, Hg);
  const L = legsMod || (legsMod = await import('../src/sniperLegLabels.js'));
  const legKeys = [...new Set(rows.flatMap((r) => r.legs || []))];
  const f = deps.fetch || fetch;
  const boards = await Promise.all(L.espnDates(legKeys).slice(0, 14).map(async (d) => { try { const r = await f(`${ESPN}?dates=${d}`, { headers: { accept: 'application/json' } }); return r.ok ? r.json() : null; } catch (_) { return null; } }));
  const gm = L.gamesFromEspn(boards.filter(Boolean));
  const R = rootForApi(); const M = await R._helpers.loadMods();
  const markets = await R._helpers.loadMarkets(M, positions.map((p) => ({ legs: p.legs })), env);
  await collegeStarts(markets, positions, deps.fetch || fetch);
  const legFairFn = await sniperLegFairFn(db, env, rows, names, positions);
  const root = M.computeRootFor({ parlays: [], extraPositions: positions, kalshiBooks: markets.kalshiBooks, relay: markets.relay, starts: markets.starts || {}, now: nowMs, kalshiAt: markets.kalshiAt, legFairFn });
  // plain-English labels: "NE @ CHI", ESPN kickoff first, TD outcomes as "X scores a TD" / "X doesn't score"
  const codeOf = (ev) => String(ev || '').toUpperCase().split('-')[1] || '';
  const espn = (ev) => gm[codeOf(ev)] || null;
  const gameOf = (ev, fallback) => { const g = espn(ev); return g ? `${g.away} @ ${g.home}` : fallback; };
  const tdWho = {}; for (const p of positions) for (const l of p.legs) if (l.type === 'td') tdWho[l.ticker] = String(l.label || '').replace(/\s*\([A-Z]{2,4}\)\s*TD$/, '').replace(/\s*TD$/, '');
  const nameOf = (ev, outcome, cur) => (tdWho[ev] ? (outcome === 'yes' ? `${tdWho[ev]} scores a TD` : outcome === 'no' ? `${tdWho[ev]} doesn't score a TD` : cur) : cur);
  const startOf = (ev, cur) => { const g = espn(ev); return (g && g.kickoff) || cur || null; };
  const slotOf = (st) => (st ? { key: st, label: new Date(st).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/, (\d+:\d+ [AP]M)$/, ' · $1') + ' ET' } : { key: '9', label: 'Kickoff unknown' });
  const deco = (o) => { const start = startOf(o.event, o.start); return { ...o, name: nameOf(o.event, o.outcome, o.name), game: gameOf(o.event, o.game), start, slot: slotOf(start) }; };
  root.perEvent = root.perEvent.map((e) => { const start = startOf(e.event, e.start); return { ...e, game: gameOf(e.event, e.game), start, slot: slotOf(start), rootForName: e.rootFor != null ? nameOf(e.event, e.rootFor, e.rootForName) : e.rootForName, outcomes: e.outcomes.map(deco) }; })
    .sort((a, b) => String(a.start || '9').localeCompare(String(b.start || '9')));
  root.top = (root.top || []).map(deco);
  if (root.model && root.model.teamNames) for (const k of Object.keys(root.model.teamNames)) { const i = k.lastIndexOf(':'); root.model.teamNames[k] = nameOf(k.slice(0, i), k.slice(i + 1), root.model.teamNames[k]); }
  const evOf = (r) => { const m = S.rowMoney(r); const hg = Hg.hedgeSummary({ n: m.n, risk: m.risk, fair: m.fair, baseEv: m.ev }, hedges[r.rfq_id]); return hg && hg.ev != null ? hg.ev : m.ev; };
  const baseline = rows.reduce((a, r) => a + evOf(r), 0);
  fillTimeFallback(root, rows, S, evOf);
  const lockLabels = {}; for (const r of rows) lockLabels[r.rfq_id] = (r.legs || []).map((k) => L.legInfo(k, gm, names).bet).join(' + ');
  // Pregame = fill-time value of the open fills (sniper fair at quote time), not the live number again.
  const hedgedLocks = rows.filter((r) => Hg.activeHedges(hedges[r.rfq_id]).length).length;
  return { ok: true, house: true, asOf, relayNote: markets.relayNote, ...root, locksTotal: rows.length, hedgedLocks, lockLabels, sweat: { baseline, now: root.ev, started: true, fixedBaseline: true } };
}

// Sniper leg fairs (src/sniperLegFair.js): $1,000 inverse bet across Kalshi + relay Polymarket US / Novig (TD /td)
// + ProphetX (relay board), falling back to the sniper's fill-time leg fair. Any feed failing just drops that venue.
let legFairMod = null;
async function sniperLegFairFn(db, env, rows, names, positions) {
  const F = legFairMod || (legFairMod = await import('../src/sniperLegFair.js'));
  const P = await import('../src/rootForPrices.js');
  const f = deps.fetch || fetch;
  const base = String(env.ODDS_RELAY_URL || env.VITE_ODDS_RELAY_URL || '').replace(/\/+$/, '');
  const getJ = async (u) => { try { const r = await f(u, { headers: { accept: 'application/json' } }); return r.ok ? await r.json() : null; } catch (_) { return null; } };
  const polledAt = deps.now();
  let tdBooks = {}; let pxRelay = {};
  if (base) {
    const [h, tdPm, tdNv, kNfl, kCfb, pNfl, pCfb] = await Promise.all([
      getJ(`${base}/health`), getJ(`${base}/td?venue=polymarket&league=NFL`), getJ(`${base}/td?venue=novig&league=NFL`),
      getJ(`${base}/board?venue=kalshi&league=NFL`), getJ(`${base}/board?venue=kalshi&league=NCAAF`),
      getJ(`${base}/board?venue=prophetx&league=NFL`), getJ(`${base}/board?venue=prophetx&league=NCAAF`),
    ]);
    tdBooks = F.indexTdRows({ polymarket: (tdPm && tdPm.markets) || [], novig: (tdNv && tdNv.markets) || [] }, names, polledAt);
    const pxLive = /ws:up/.test(String((h && h.status && h.status.prophetx) || ''));
    pxRelay = P.relayIndex({ kalshiBoard: [...((kNfl && kNfl.quotes) || []), ...((kCfb && kCfb.quotes) || [])], novig: F.prophetxAsNovig([...((pNfl && pNfl.quotes) || []), ...((pCfb && pCfb.quotes) || [])]), novigLive: pxLive, polledAt });
  }
  let stored = {};
  try { // the fill's own quote-time leg fairs first; legs without one use the latest sniper quote that priced them
    const ids = rows.map((r) => r.rfq_id);
    const { data: own } = await db.from('sniper_decisions').select('created_at,details').eq('action', 'quoted').in('rfq_id', ids).limit(2000);
    const legsWanted = new Set(positions.flatMap((p) => p.legs.map((l) => String(l.ticker).toUpperCase())));
    const since = new Date(polledAt - 24 * 3600e3).toISOString();
    const { data: recent } = await db.from('sniper_decisions').select('created_at,details').eq('action', 'quoted').gte('created_at', since).order('created_at', { ascending: false }).limit(5000);
    const hit = (d) => ((d.details && d.details.legDetail) || []).some((l) => l && legsWanted.has(String(l.ticker).toUpperCase()));
    stored = { ...F.storedLegFairs((recent || []).filter(hit)), ...F.storedLegFairs(own || []) };
  } catch (_) { stored = {}; }
  return F.makeSniperLegFair({ tdBooks, pxRelay, stored });
}

// College kickoffs from ESPN's FBS scoreboard. Kalshi NCAAF tickers carry the day BEFORE kickoff
// (KXNCAAFGAME-26OCT23OREILL = Sat Oct 24) and the relay has no start for them, so without this every college
// game lands in "Other days" and Today never sees it. Tries the ticker date and the next day.
async function collegeStarts(markets, positions, f) {
  const starts = markets.starts || (markets.starts = {});
  const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  const evs = [...new Set(positions.flatMap((p) => p.legs.map((l) => String(l.ticker).toUpperCase().split('-').slice(0, 2).join('-'))))]
    .filter((ev) => /^KXNCAAF/.test(ev) && !starts[ev]);
  const want = {};
  for (const ev of evs) { const m = /-(\d\d)([A-Z]{3})(\d\d)([A-Z]+)$/.exec(ev); if (!m || !MON[m[2]]) continue;
    const t = Date.parse(`20${m[1]}-${MON[m[2]]}-${m[3]}T12:00:00Z`);
    for (const d of [t, t + 864e5]) { const k = new Date(d).toISOString().slice(0, 10).replace(/-/g, ''); (want[k] = want[k] || []).push([ev, m[4]]); } }
  await Promise.all(Object.entries(want).slice(0, 10).map(async ([date, list]) => {
    try {
      const r = await f(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&groups=80&limit=300`, { headers: { accept: 'application/json' } });
      if (!r.ok) return; const j = await r.json(); const by = {};
      for (const e of j.events || []) { const c = ((e.competitions || [])[0] || {}).competitors || []; const a = c.find((x) => x.homeAway === 'away'), h = c.find((x) => x.homeAway === 'home');
        if (a && h && Number.isFinite(Date.parse(e.date))) by[String(a.team.abbreviation + h.team.abbreviation).toUpperCase()] = new Date(Date.parse(e.date)).toISOString(); }
      for (const [ev, teams] of list) if (!starts[ev] && by[teams]) starts[ev] = by[teams];
    } catch (_) { /* no start: "Other days" */ }
  }));
}

// Fills with a leg that has no live price: keep them at their fill-time expected profit (a constant, so the
// root for / against swings are unchanged) instead of leaving them out. Shifts EV, range and chart by that amount.
function fillTimeFallback(root, rows, S, evOf = (r) => S.rowMoney(r).ev) {
  const ids = new Set((root.unpriced || []).map((u) => String(u.id)));
  if (!ids.size) { root.fillTimeLocks = 0; return; }
  const add = rows.filter((r) => ids.has(String(r.rfq_id))).reduce((a, r) => a + evOf(r), 0);
  const sh = (x) => (Number.isFinite(Number(x)) ? Number(x) + add : x);
  root.ev = sh(root.ev); root.lo2 = sh(root.lo2); root.hi2 = sh(root.hi2);
  for (const k of ['best', 'worst', 'baseWorst']) if (root[k] && Number.isFinite(Number(root[k].pnl))) root[k] = { ...root[k], pnl: Number(root[k].pnl) + add };
  if (root.hist && root.hist.bins) root.hist = { ...root.hist, bins: root.hist.bins.map((b) => ({ ...b, from: b.from + add, to: b.to + add })) };
  root.fillTimeLocks = ids.size; root.fillTimeEv = add; root.locksPriced = Number(root.locksPriced || 0) + ids.size;
}

module.exports = handler;
module.exports._setDeps = (patch) => { deps = { ...deps, ...patch }; };
module.exports._resetDeps = () => { deps = freshDeps(); };
module.exports._sniperRootFor = (...a) => sniperRootFor(...a);
