'use strict';
// GET /api/root-for — "What to root for" across the SIGNED-IN USER'S OWN open Combo Locks (scoped by auth user id).
// GET /api/root-for?check=1 — cheap: { ok, locks } count of the user's open locks (used to hide the sheet when 0).
// Reads combo_parlays / combo_fills / combo_single_orders (read-only), live venue books
// (Kalshi public orderbooks, odds-relay Polymarket US + Novig), and runs the joint engine.
const lib = require('./combo-probe-lib');
const viewAsLib = require('./combo-view-as-lib');

let mods = null;
async function loadMods() {
  if (!mods) {
    const [c, p] = await Promise.all([import('../src/rootForCompute.js'), import('../src/rootForPrices.js')]);
    mods = { ...c, ...p };
  }
  return mods;
}
function defaultCreateClient(...args) { const { createClient } = require('@supabase/supabase-js'); return createClient(...args); }
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const RELAY_FALLBACK = 'https://odds-relay-production-34da.up.railway.app';
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, fetch: (...a) => fetch(...a), now: () => Date.now() });
let deps = freshDeps();
const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };

function json(res, status, body) { res.setHeader('Cache-Control', 'no-store'); res.status(status).json(body); }

async function requireUser(req) {
  const token = lib.readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: 'Server auth is not configured' };
  const { data, error } = await deps.createClient(url, anon, clientOpts).auth.getUser(token);
  const user = data && data.user;
  if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
  return { ok: true, user, owner: lib.isComboOwner(user) };
}

/** Count of the user's open locks (same filters as loadLocks). */
async function countLocks(client, userId) {
  if (!userId) throw new Error('no user');
  const { count, error } = await client.from('combo_parlays').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).is('archived_at', null).is('merged_into_id', null).is('settled_at', null).is('underlying_settled_at', null);
  if (error) throw error;
  return count || 0;
}

/** Open locks for ONE user: not archived, not merged away, not settled. Fills/orders only for those lock ids. */
async function loadLocks(client, userId) {
  if (!userId) throw new Error('no user');
  const { data: parlays, error } = await client.from('combo_parlays')
    .select('id,label,legs,parlay_stake,parlay_american,fill_american,is_free_bet,sportsbook,active,starts_at,hedge_mode,kalshi_status')
    .eq('user_id', userId).is('archived_at', null).is('merged_into_id', null).is('settled_at', null).is('underlying_settled_at', null)
    .limit(1000);
  if (error) throw error;
  const ids = (parlays || []).map((p) => p.id);
  const fills = []; const singles = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [f, s] = await Promise.all([
      client.from('combo_fills').select('parlay_id,count,yes_price,no_price,fee,is_taker,is_combo,outcome_side,action').in('parlay_id', chunk).limit(10000),
      client.from('combo_single_orders').select('id,parlay_id,venue,order_id,market,hedge,price,size,filled,open,status').in('parlay_id', chunk).limit(10000),
    ]);
    if (f.error) throw f.error; if (s.error) throw s.error;
    fills.push(...(f.data || [])); singles.push(...(s.data || []));
  }
  return { parlays: parlays || [], fills, singles };
}

/** Normalized "away|home" for matching the same game across venues ("Michigan St." == "Michigan State"). */
function matchKey(away, home) {
  const n = (x) => String(x || '').toLowerCase().replace(/\bst\.?(?=\s|$)/g, 'state').replace(/[^a-z0-9]+/g, ' ').trim();
  const a = n(away), h = n(home); return a && h ? `${a}|${h}` : '';
}
/** Kalshi date-only placeholder kickoff: exactly 03:00:00 or 04:00:00 UTC (11 PM / midnight ET). */
function isPlaceholderStart(t) { return /T0[34]:00:00(\.000)?Z$/.test(String(t || '')); }

/** Live books: Kalshi orderbooks for every needed ticker + relay boards (NFL, NCAAF). */
async function loadMarkets(M, parlays, env, f = deps.fetch, now = deps.now) {
  const tickers = M.tickersNeeded(parlays);
  const kalshiBooks = {};
  const getJ = async (u) => { const r = await f(u, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 80)}`); return r.json(); };
  await Promise.all(Array.from({ length: Math.ceil(tickers.length / 100) }, (_, i) => tickers.slice(i * 100, i * 100 + 100)).map(async (chunk) => {
    const j = await getJ(`${KALSHI}/markets/orderbooks?${chunk.map((t) => `tickers=${encodeURIComponent(t)}`).join('&')}`);
    for (const ob of j.orderbooks || []) { const t = String(ob.ticker || ob.market_ticker || '').toUpperCase(); if (t) kalshiBooks[t] = M.kalshiAsks(ob); }
  }));
  const kalshiAt = now();
  const base = String(env.ODDS_RELAY_URL || env.VITE_ODDS_RELAY_URL || RELAY_FALLBACK).replace(/\/+$/, '');
  let relay = {}; const relayNote = []; const starts = {};
  try {
    const h = await getJ(`${base}/health`);
    const polledAt = now();
    const nv = (h && h.novig) || {};
    const novigLive = /ws:up/.test(String((h.status || {}).novig || '')) && Number(nv.lastWsMsgAt) > 0 && polledAt - Number(nv.lastWsMsgAt) < 15000;
    const boards = { kalshi: [], polymarket: [], novig: [] };
    await Promise.all(['NFL', 'NCAAF'].flatMap((lg) => Object.keys(boards).map(async (v) => {
      try { const j = await getJ(`${base}/board?venue=${v}&league=${lg}`); boards[v].push(...(j.quotes || [])); } catch (e) { relayNote.push(`${v} ${lg}: ${String(e.message).slice(0, 60)}`); }
    })));
    // Kalshi's board start is often a date-only placeholder (e.g. 03:00Z = 11 PM ET on the ticker date, even for
    // Saturday games). Prefer the real kickoff from Polymarket / Novig for the same matchup; a Kalshi-only placeholder
    // time is treated as unknown (no time shown, not counted as Today).
    const real = {};
    for (const q of [...boards.polymarket, ...boards.novig]) { if (!q || !q.start) continue; const k = matchKey(q.away, q.home); if (k && !real[k]) real[k] = new Date(Date.parse(q.start)).toISOString(); }
    for (const q of boards.kalshi) {
      if (!q || !q.ticker) continue;
      const ev = String(q.ticker).toUpperCase().split('-').slice(0, 2).join('-'); if (ev in starts) continue;
      const r = real[matchKey(q.away, q.home)];
      starts[ev] = r || (q.start && !isPlaceholderStart(q.start) ? q.start : null);
    }
    relay = M.relayIndex({ kalshiBoard: boards.kalshi, polymarket: boards.polymarket, novig: boards.novig, novigLive, polledAt });
  } catch (e) { relayNote.push(`relay: ${String(e.message).slice(0, 80)}`); }
  // start times for games the relay doesn't carry (e.g. NHL): Kalshi market close/expected times
  const missing = [...new Set(tickers.map((t) => t.split('-').slice(0, 2).join('-')))].filter((ev) => !(ev in starts));
  await Promise.all(missing.slice(0, 40).map(async (ev) => {
    try { const j = await getJ(`${KALSHI}/events/${encodeURIComponent(ev)}`); const m = (j.markets || [])[0] || {}; const t = m.expected_expiration_time || m.close_time; if (t && /FOOTBALL|NFL|NCAAF/i.test(ev) && isPlaceholderStart(t)) { starts[ev] = null; return; } if (t) starts[ev] = new Date(Date.parse(t) - 3 * 3600 * 1000).toISOString(); } catch (_) { /* no start: "Other days" */ }
  }));
  return { kalshiBooks, kalshiAt, relay, relayNote, starts, tickers: tickers.length };
}

// Kickoff backfill for a started plain moneyline game we never saved (saving was off): Kalshi 1-minute candles
// ending at kickoff, inverse bet method on top of book: P(team) = max(team yes bid, 1 − other team's yes ask).
// Both sides held → raw inverted numbers + "neither"; one side held → that side raw, the other 1 − it.
async function kickoffProbs(ev, dist, kickoffIso, positions, f = deps.fetch) {
  const NEITHER = '__neither';
  const teams = Object.keys(dist || {}).filter((o) => o !== NEITHER);
  if (teams.length !== 2 || teams.some((t) => /[<>=]/.test(t))) return null; // spread buckets / totals: no backfill
  const k = Math.floor(Date.parse(kickoffIso) / 1000); if (!Number.isFinite(k)) return null;
  const series = ev.split('-')[0];
  const last = async (team) => {
    const r = await f(`${KALSHI}/series/${series}/markets/${encodeURIComponent(`${ev}-${team}`)}/candlesticks?start_ts=${k - 1800}&end_ts=${k}&period_interval=1`, { headers: { accept: 'application/json' } });
    if (!r.ok) return null; const j = await r.json();
    const c = (j.candlesticks || []).filter((x) => x && x.yes_bid && x.yes_ask && x.yes_ask.close_dollars != null).pop();
    return c ? { bid: Number(c.yes_bid.close_dollars), ask: Number(c.yes_ask.close_dollars) } : null;
  };
  const [A, B] = await Promise.all(teams.map(last)); if (!A || !B) return null;
  const raw = { [teams[0]]: Math.max(A.bid, 1 - B.ask), [teams[1]]: Math.max(B.bid, 1 - A.ask) };
  const held = new Set(); for (const p of positions || []) for (const l of p.legs || []) if (l.event === ev && l.allowed && l.allowed.length === 1) held.add(l.allowed[0]);
  if (NEITHER in dist || (held.has(teams[0]) && held.has(teams[1]))) { const n = Math.max(0, 1 - raw[teams[0]] - raw[teams[1]]); return { [teams[0]]: raw[teams[0]], [teams[1]]: raw[teams[1]], ...(n > 0 || NEITHER in dist ? { [NEITHER]: n } : {}) }; }
  const h = held.has(teams[1]) && !held.has(teams[0]) ? teams[1] : teams[0]; const o = h === teams[0] ? teams[1] : teams[0];
  return { [h]: raw[h], [o]: 1 - raw[h] };
}

// Daily needle history (owner only). One row per sheet day (Today rolls over at 11 AM ET).
// result = EV of the day's locks at the day's games' latest chances − EV with those games at their kickoff numbers
// (later games stay at current chances in both, so only the day's games count).
// Finished games drop out of live prices and settled locks drop out of open locks, so the row keeps a snapshot:
// every lock and game seen that day, each game's last live chances, and its kickoff numbers.
// The day turns final when every game is decided (some outcome ≥ 98%, or its market has closed) or at the
// 11 AM ET rollover; a final row is never rewritten. Never fails the request.
async function needleDay(client, userId, out, now, frozen) {
  try {
    const S = await import('../src/rootForSweat.js'); const TD = await import('../src/rootForToday.js');
    const day = TD.sheetDay(now); const model = out.model || {}; const probs = model.probs || {};
    const T = (t) => client.from(t); const stamp = new Date(now).toISOString();
    await T('root_for_needle_days').update({ final: true, final_reason: 'rollover', updated_at: stamp }).eq('user_id', userId).eq('final', false).lt('day', day);
    const { data: cur } = await T('root_for_needle_days').select('day,final,snap').eq('user_id', userId).eq('day', day).limit(1);
    const row0 = (cur || [])[0];
    if (!(row0 && row0.final)) {
      const snap = (row0 && row0.snap) || { positions: {}, last: {}, frozen: {} }; snap.lastAt = snap.lastAt || {};
      const evs = TD.todayEvents(out.perEvent || [], now);
      for (const ev of evs) { if (probs[ev]) { snap.last[ev] = probs[ev]; snap.lastAt[ev] = stamp; } if (frozen && frozen[ev]) snap.frozen[ev] = frozen[ev]; }
      for (const p of TD.touchedLocks(model, new Set(Object.keys(snap.last)))) snap.positions[p.id] = p;
      const dayEvs = Object.keys(snap.frozen);
      if (dayEvs.length) {
        const pos = Object.values(snap.positions);
        const liveP = { ...probs, ...Object.fromEntries(dayEvs.map((ev) => [ev, probs[ev] || snap.last[ev]])) };
        const preP = { ...liveP, ...snap.frozen };
        const liveEv = S.expectedProfit(pos, liveP); const preEv = S.expectedProfit(pos, preP);
        const decided = Object.keys(snap.last).every((ev) => !probs[ev] || Math.max(...Object.values(probs[ev])) >= 0.98);
        await T('root_for_needle_days').upsert({ user_id: userId, day, result: liveEv - preEv, pregame_ev: preEv, live_ev: liveEv, games: Object.keys(snap.last).length, locks: pos.length, events: Object.keys(snap.last), snap, final: decided, final_reason: decided ? 'all_decided' : null, updated_at: stamp }, { onConflict: 'user_id,day' });
      }
    }
    const { data: hist } = await T('root_for_needle_days').select('day,result,pregame_ev,live_ev,games,locks,final').eq('user_id', userId).order('day', { ascending: false }).limit(30);
    return hist || [];
  } catch (_) { return null; }
}

// Sweat meter (see src/rootForSweat.js): each game locked at its own kickoff. Owner only. Never fails the request.
// Returns frozen kickoff probabilities per started game so the client can build the needle for All or Today's locks.
async function sweatBaseline(client, out, now, userId) {
  try {
    const S = await import('../src/rootForSweat.js');
    const key = S.slateKey(now);
    const starts = {}; for (const e of out.perEvent || []) if (e && e.event && e.start) starts[e.event] = e.start;
    const { data, error } = await client.from('root_for_pregame_probs').select('event,sig,probs,kickoff,captured_at').eq('slate_key', key);
    if (error) throw error;
    const rows = [...(data || [])]; const have = new Set(rows.map((r) => `${r.event}#${r.sig}`));
    const backfill = []; const probs = (out.model && out.model.probs) || {};
    await Promise.all(Object.entries(probs).map(async ([ev, dist]) => {
      const t = starts[ev] ? Date.parse(starts[ev]) : NaN; if (!Number.isFinite(t) || now < t) return;
      const sig = S.outcomeSig(dist);
      // a saved row taken after the REAL kickoff (late first snapshot, or saved under an old placeholder kickoff)
      // is replaced by Kalshi's price at kickoff when history is available
      const old = rows.find((x) => x.event === ev && x.sig === sig);
      if (old && !(old.captured_at && Date.parse(old.captured_at) - t > 5 * 60000)) return;
      try { const p = await kickoffProbs(ev, dist, starts[ev], out.model.positions); if (p) { const row = { slate_key: key, event: ev, sig, probs: p, kickoff: new Date(t).toISOString(), captured_at: new Date(t).toISOString() }; if (old) rows.splice(rows.indexOf(old), 1); rows.push(row); backfill.push(row); } } catch (_) { /* fall back to first snapshot */ }
    }));
    if (backfill.length) { const { error: e0 } = await client.from('root_for_pregame_probs').upsert(backfill, { onConflict: 'slate_key,event,sig' }); if (e0) throw e0; }
    const r = S.pregameBaseline({ model: out.model, starts, now, key, rows });
    if (r.overwrite.length) { const { error: e1 } = await client.from('root_for_pregame_probs').upsert(r.overwrite, { onConflict: 'slate_key,event,sig' }); if (e1) throw e1; }
    if (r.insertOnce.length) { const { error: e2 } = await client.from('root_for_pregame_probs').upsert(r.insertOnce, { onConflict: 'slate_key,event,sig', ignoreDuplicates: true }); if (e2) throw e2; }
    // per started game: frozen probabilities + where they came from
    const bySig = new Map(rows.map((x) => [`${x.event}#${x.sig}`, x])); const frozen = {}; const source = {}; let since = null;
    for (const ev of r.started) {
      const x = bySig.get(`${ev}#${S.outcomeSig(probs[ev])}`);
      if (x && x.probs) { frozen[ev] = x.probs; const late = x.captured_at && starts[ev] && Date.parse(x.captured_at) - Date.parse(starts[ev]) > 5 * 60000; source[ev] = backfill.includes(x) || (x.captured_at && x.kickoff && x.captured_at === x.kickoff) ? 'kickoff' : late ? 'snapshot' : 'pregame'; if (late && (!since || x.captured_at < since)) since = x.captured_at; }
      else { frozen[ev] = probs[ev]; source[ev] = 'snapshot'; const c = new Date(now).toISOString(); if (!since || c < since) since = c; }
    }
    const history = userId ? await needleDay(client, userId, out, now, frozen) : null;
    // Finished games (no longer priced) stay counted at their last live chances (see finishedCarry):
    //  - All: for 12h after they end.
    //  - Today & beyond (the sheet's default): today's sheet-day games, finished ones included, plus every upcoming leg.
    const TD = await import('../src/rootForToday.js'); const sd = TD.sheetDay(now);
    let carry = null; let carryTU = null;
    if (userId) {
      try {
        const lo = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
        const { data: days } = await client.from('root_for_needle_days').select('day,snap,updated_at').eq('user_id', userId).gte('day', lo).order('day', { ascending: true });
        const kickoffs = {}; for (const x of rows) if (x && x.kickoff) kickoffs[x.event] = x.kickoff;
        const args = { positions: (out.model && out.model.positions) || [], probs, frozen, kickoffs, now, days: (days || []).map((x) => ({ day: x.day, snap: x.snap, updatedAt: x.updated_at })) };
        carry = S.finishedCarry(args);
        carryTU = S.finishedCarry({ ...args, keep: (ev, endedMs, day) => day === sd });
      } catch (_) { carry = null; carryTU = null; }
    }
    // Today's needle reads the saved day row (all of the day's games and locks, settled ones included), so it matches history.
    const dayRow = (history || []).find((h) => String(h.day).slice(0, 10) === sd) || null;
    const ids = (c) => (c ? c.kept.map((p) => String(p.id)) : []);
    const union = carry || carryTU ? (() => {
      const byId = {}; for (const c of [carry, carryTU]) if (c) for (const p of c.kept) byId[String(p.id)] = p;
      return { kept: Object.values(byId), last: { ...(carryTU || {}).last, ...(carry || {}).last }, frozen: { ...(carryTU || {}).frozen, ...(carry || {}).frozen },
        finishedDay: { ...(carryTU || {}).finishedDay, ...(carry || {}).finishedDay }, endedAt: { ...(carryTU || {}).endedAt, ...(carry || {}).endedAt } };
    })() : null;
    const add = (c, f) => (c ? c[f] : 0);
    const anyKept = !!(union && union.kept.length);
    return { started: r.started.length > 0 || anyKept, gamesStarted: r.started.length + (carry ? carry.finished.length : 0),
      // All (12h rule)
      baseline: r.baseline + add(carry, 'baseAdd'), now: Number(out.ev) + add(carry, 'nowAdd'),
      // Today & beyond
      tu: { baseline: r.baseline + add(carryTU, 'baseAdd'), now: Number(out.ev) + add(carryTU, 'nowAdd'), keptIds: ids(carryTU), finished: carryTU ? carryTU.finished : [] },
      allKeptIds: ids(carry), slateKey: key, frozen: union ? { ...union.frozen, ...frozen } : frozen, source,
      ...(anyKept ? { kept: union.kept, last: union.last, finished: carry ? carry.finished : [], finishedDay: union.finishedDay, endedAt: union.endedAt } : {}),
      since, backfilled: backfill.length, ...(history ? { history } : {}), ...(dayRow ? { dayRow } : {}) };
  } catch (e) {
    return { started: null, baseline: null, now: Number(out.ev), error: 'Pregame number unavailable' };
  }
}

async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'GET only' });
  // Vercel cron (every 10 min): keep the owner's needle + daily history current even with the sheet closed.
  // Needs CRON_SECRET (Vercel sends "Authorization: Bearer <CRON_SECRET>"); without it the cron is refused.
  if ((req.query || {}).cron === 'needle') {
    const env0 = deps.env || process.env; const sec = env0.CRON_SECRET;
    if (!sec || lib.readBearer(req) !== sec) return json(res, 401, { ok: false, error: 'cron auth' });
    try {
      const client = deps.createClient(env0.SUPABASE_URL || env0.VITE_SUPABASE_URL, env0.SUPABASE_SERVICE_KEY, clientOpts);
      const uid = lib.OWNER_USER_ID; const M = await loadMods();
      const { parlays, fills, singles } = await loadLocks(client, uid);
      if (!parlays.length) return json(res, 200, { ok: true, empty: true });
      const mk = await loadMarkets(M, parlays, env0); const now = deps.now();
      const out = M.computeRootFor({ parlays, fills, singles, kalshiBooks: mk.kalshiBooks, relay: mk.relay, starts: mk.starts, now, kalshiAt: mk.kalshiAt });
      const sw = await sweatBaseline(client, out, now, uid);
      return json(res, 200, { ok: true, days: (sw.history || []).length });
    } catch (e) { return json(res, 500, { ok: false, error: 'cron failed' }); }
  }
  const auth = await requireUser(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return json(res, 503, { ok: false, error: 'Server is not configured' });
  try {
    const client = deps.createClient(url, key, clientOpts);
    const q = (req.query) || {};
    // Owner "View as" (x-view-as header / view_as param): same server-side gate as the rest of Combo Locks.
    // Anyone else is always scoped to their own token user id; any user_id param is ignored.
    let uid = auth.user.id;
    const target = viewAsLib.readViewAs(req);
    if (target) {
      const live = await client.from('combo_live_users').select('user_id');
      if (live.error) throw live.error;
      const gate = viewAsLib.authorizeViewAs(auth.user, target, (live.data || []).map((r) => r.user_id));
      if (!gate.ok) return json(res, gate.status, { ok: false, error: gate.error });
      uid = gate.targetId;
    }
    if (q.check === '1' || q.check === 1) return json(res, 200, { ok: true, locks: await countLocks(client, uid) });
    const M = await loadMods();
    const { parlays, fills, singles } = await loadLocks(client, uid);
    if (!parlays.length) return json(res, 200, { ok: true, empty: true, locksTotal: 0 });
    const mk = await loadMarkets(M, parlays, env);
    const now = deps.now();
    const out = M.computeRootFor({ parlays, fills, singles, kalshiBooks: mk.kalshiBooks, relay: mk.relay, starts: mk.starts, now, kalshiAt: mk.kalshiAt });
    // pregame-probs table is not per-user: only the owner's sheet may write it (and it's off unless enabled)
    const sweat = auth.owner && uid === auth.user.id ? await sweatBaseline(client, out, now, uid) : undefined;
    const lockLabels = Object.fromEntries(parlays.map((p) => [p.id, p.label || '']));
    return json(res, 200, { ok: true, asOf: new Date(now).toISOString(), relayNote: mk.relayNote, ...out, lockLabels, ...(sweat ? { sweat } : {}) });
  } catch (e) {
    console.error('[root-for]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Could not compute right now' });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
module.exports._setDeps = (p) => { deps = { ...deps, ...p }; };
module.exports._helpers = { loadLocks, countLocks, loadMarkets, loadMods, matchKey, isPlaceholderStart };
