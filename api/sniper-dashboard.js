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
    const labels = await legLabels(quotes, [...risk.games, ...risk.filledGames]);
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
    const m = S.rowMoney(r);
    return { rfqId: r.rfq_id, status: S.matchedStatus(r), filledAt: r.updated_at || r.created_at, createdAt: r.created_at, settledAt: r.settled_at,
      legs: (r.legs || []).map((k) => ({ ...S.legMeta(k, names), ...(lab.legInfo[k] ? { bet: lab.legInfo[k].bet, game: lab.legInfo[k].game } : {}), kickoff: kick(k) || (lab.legInfo[k] && lab.legInfo[k].kickoff) || null, result: legResults[String(k).split(':')[0].toUpperCase()] || null })),
      fairYes: m.fair, soldYes: m.sold, contracts: m.n, filled: Number(r.filled_contracts) > 0, risk: m.risk, toWin: m.toWin, ev: m.ev, edge: r.roi != null ? Number(r.roi) : null, pnl: r.realized_pnl != null ? Number(r.realized_pnl) : null, fee: r.filled_fee != null ? Number(r.filled_fee) : r.fee != null ? Number(r.fee) : null, quote: quoteAt[r.rfq_id] || null, bookArb: bookArb[r.rfq_id] || null };
  });
  return { ok: true, empty: false, asOf: new Date(nowMs).toISOString(), rows: list, perf, root, sweat };
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
  const L = legsMod || (legsMod = await import('../src/sniperLegLabels.js'));
  const legKeys = [...new Set(rows.flatMap((r) => r.legs || []))];
  const f = deps.fetch || fetch;
  const boards = await Promise.all(L.espnDates(legKeys).slice(0, 14).map(async (d) => { try { const r = await f(`${ESPN}?dates=${d}`, { headers: { accept: 'application/json' } }); return r.ok ? r.json() : null; } catch (_) { return null; } }));
  const gm = L.gamesFromEspn(boards.filter(Boolean));
  const R = rootForApi(); const M = await R._helpers.loadMods();
  const markets = await R._helpers.loadMarkets(M, positions.map((p) => ({ legs: p.legs })), env);
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
  const baseline = rows.reduce((a, r) => a + S.rowMoney(r).ev, 0);
  const lockLabels = {}; for (const r of rows) lockLabels[r.rfq_id] = (r.legs || []).map((k) => L.legInfo(k, gm, names).bet).join(' + ');
  // Pregame = fill-time value of the open fills (sniper fair at quote time), not the live number again.
  return { ok: true, house: true, asOf, relayNote: markets.relayNote, ...root, locksTotal: rows.length, lockLabels, sweat: { baseline, now: root.ev, started: true, fixedBaseline: true } };
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

module.exports = handler;
module.exports._setDeps = (patch) => { deps = { ...deps, ...patch }; };
module.exports._resetDeps = () => { deps = freshDeps(); };
module.exports._sniperRootFor = (...a) => sniperRootFor(...a);
