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
const FILL_COLS = 'parlay_id,count,yes_price,no_price,fee,is_taker,is_combo,outcome_side,action,ticker,fill_id,order_id,kalshi_created_time,recorded_at';
async function loadLocks(client, userId) {
  if (!userId) throw new Error('no user');
  const { data: parlays, error } = await client.from('combo_parlays')
    .select('id,label,legs,parlay_stake,parlay_american,fill_american,is_free_bet,sportsbook,active,starts_at,hedge_mode,kalshi_status')
    .eq('user_id', userId).is('archived_at', null).is('merged_into_id', null).is('settled_at', null).is('underlying_settled_at', null)
    .limit(1000);
  if (error) throw error;
  return { parlays: parlays || [], ...(await loadLockChildren(client, (parlays || []).map((p) => p.id))) };
}
/** fills, single orders and filled submissions (History P/L's contract count) for these lock ids. */
async function loadLockChildren(client, ids) {
  const fills = []; const singles = []; const submissions = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [f, s, sb] = await Promise.all([
      client.from('combo_fills').select(FILL_COLS).in('parlay_id', chunk).limit(10000),
      client.from('combo_single_orders').select('id,parlay_id,venue,order_id,market,hedge,price,size,filled,open,status').in('parlay_id', chunk).limit(10000),
      client.from('combo_submissions').select('parlay_id,order_id,status,contracts,venue').in('parlay_id', chunk).eq('status', 'filled').limit(10000),
    ]);
    if (f.error) throw f.error; if (s.error) throw s.error;
    fills.push(...(f.data || [])); singles.push(...(s.data || [])); if (!sb.error) submissions.push(...(sb.data || []));
  }
  return { fills, singles, submissions };
}

/** Normalized "away|home" for matching the same game across venues ("Michigan St." == "Michigan State"). */
function normTeam(x) { return String(x || '').toLowerCase().replace(/\bst\.?(?=\s|$)/g, 'state').replace(/[^a-z0-9]+/g, ' ').trim(); }
function matchKey(away, home) {
  const a = normTeam(away), h = normTeam(home); return a && h ? `${a}|${h}` : '';
}

// Canonical NFL teams: abbreviation -> [nickname, ...exact aliases]. Kalshi names NFL teams several ways
// ("HOU Texans", "Houston", "New York J", "LA Chargers"); Polymarket / Novig use "Houston Texans".
const NFL_TEAMS = {
  ARI: ['cardinals', 'arizona', 'ari'], ATL: ['falcons', 'atlanta', 'atl'], BAL: ['ravens', 'baltimore', 'bal'], BUF: ['bills', 'buffalo', 'buf'],
  CAR: ['panthers', 'carolina', 'car'], CHI: ['bears', 'chicago', 'chi'], CIN: ['bengals', 'cincinnati', 'cin'], CLE: ['browns', 'cleveland', 'cle'],
  DAL: ['cowboys', 'dallas', 'dal'], DEN: ['broncos', 'denver', 'den'], DET: ['lions', 'detroit', 'det'], GB: ['packers', 'green bay', 'gb'],
  HOU: ['texans', 'houston', 'hou'], IND: ['colts', 'indianapolis', 'ind'], JAC: ['jaguars', 'jacksonville', 'jac', 'jax'], KC: ['chiefs', 'kansas city', 'kc'],
  LV: ['raiders', 'las vegas', 'lv'], LAC: ['chargers', 'los angeles c', 'la c', 'lac'], LAR: ['rams', 'los angeles r', 'la r', 'lar'], MIA: ['dolphins', 'miami', 'mia'],
  MIN: ['vikings', 'minnesota', 'min'], NE: ['patriots', 'new england', 'ne'], NO: ['saints', 'new orleans', 'nola', 'no'], NYG: ['giants', 'new york g', 'ny g', 'nyg'],
  NYJ: ['jets', 'new york j', 'ny j', 'nyj'], PHI: ['eagles', 'philadelphia', 'phi'], PIT: ['steelers', 'pittsburgh', 'pit'], SF: ['49ers', 'niners', 'san francisco', 'sf'],
  SEA: ['seahawks', 'seattle', 'sea'], TB: ['buccaneers', 'tampa bay', 'tb'], TEN: ['titans', 'tennessee', 'ten'], WAS: ['commanders', 'washington', 'was', 'wsh'],
};
const NFL_NICK = {}; const NFL_ALIAS = {};
for (const [ab, [nick, ...al]] of Object.entries(NFL_TEAMS)) { NFL_NICK[nick] = ab; NFL_ALIAS[nick] = ab; for (const a of al) NFL_ALIAS[a] = ab; }
NFL_NICK.niners = 'SF';
/** NFL team name -> abbreviation: a nickname word anywhere ("HOU Texans"), else the whole name as an exact alias ("New York J"). */
function nflTeam(x) {
  const n = normTeam(x); if (!n) return null;
  const hits = new Set(n.split(' ').map((w) => NFL_NICK[w]).filter(Boolean));
  if (hits.size === 1) return [...hits][0];
  return hits.size ? null : NFL_ALIAS[n] || null;
}
function nflKey(away, home) { const a = nflTeam(away), h = nflTeam(home); return a && h ? `nfl:${a}|${h}` : ''; }
// College: explicit name aliases only (normalized name -> canonical normalized name); no nickname-only matching.
const NCAAF_ALIASES = {};
function ncaafKey(away, home) { const c = (x) => { const n = normTeam(x); return NCAAF_ALIASES[n] || n; }; const a = c(away), h = c(home); return a && h ? `${a}|${h}` : ''; }
function boardKey(lg, away, home) { return lg === 'NFL' ? nflKey(away, home) : ncaafKey(away, home); }

/** Kickoff stored on single-game locks (combo_parlays.starts_at, what combo-worker uses), keyed by ticker game id (e.g. 26OCT18HOUJAC). */
function lockStarts(parlays) {
  const out = {};
  for (const p of parlays || []) {
    const t = Date.parse(p && p.starts_at); if (!Number.isFinite(t)) continue;
    const games = new Set((p.legs || []).map((l) => String((l && l.ticker) || '').toUpperCase().split('-')[1]).filter(Boolean));
    if (games.size !== 1) continue; // a multi-game lock's starts_at is its earliest leg, not each game's kickoff
    const g = [...games][0]; if (!(g in out) || t < Date.parse(out[g])) out[g] = new Date(t).toISOString();
  }
  return out;
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
  let relay = {}; const relayNote = []; const starts = {}; const lockStart = lockStarts(parlays);
  try {
    const h = await getJ(`${base}/health`);
    const polledAt = now();
    const nv = (h && h.novig) || {};
    const novigLive = /ws:up/.test(String((h.status || {}).novig || '')) && Number(nv.lastWsMsgAt) > 0 && polledAt - Number(nv.lastWsMsgAt) < 15000;
    const boards = { kalshi: [], polymarket: [], novig: [] };
    const leagueOf = new Map(); // quote -> league it was fetched under (matching rules differ for NFL / college)
    await Promise.all(['NFL', 'NCAAF'].flatMap((lg) => Object.keys(boards).map(async (v) => {
      try { const j = await getJ(`${base}/board?venue=${v}&league=${lg}`); const qs = j.quotes || []; for (const q of qs) if (q && typeof q === 'object') leagueOf.set(q, lg); boards[v].push(...qs); } catch (e) { relayNote.push(`${v} ${lg}: ${String(e.message).slice(0, 60)}`); }
    })));
    // Kalshi's board start is often a date-only placeholder (e.g. 03:00Z = 11 PM ET on the ticker date, even for
    // Saturday games). Prefer the real kickoff from Polymarket / Novig for the same matchup; a Kalshi-only placeholder
    // time is treated as unknown (no time shown, not counted as Today).
    // Football: a Kalshi board start is never used as kickoff (it is often expected_expiration = kickoff + 3h, e.g.
    // HOU@JAC London 13:30Z shown as 16:30Z). Order: Polymarket / Novig start, then the lock's own starts_at
    // (single-game locks), else unknown.
    const real = {};
    for (const q of [...boards.polymarket, ...boards.novig]) {
      if (!q || !q.start || !Number.isFinite(Date.parse(q.start))) continue; const iso = new Date(Date.parse(q.start)).toISOString();
      for (const k of [matchKey(q.away, q.home), boardKey(leagueOf.get(q), q.away, q.home)]) if (k && !real[k]) real[k] = iso;
    }
    for (const q of boards.kalshi) {
      if (!q || !q.ticker) continue;
      const ev = String(q.ticker).toUpperCase().split('-').slice(0, 2).join('-'); if (ev in starts) continue;
      const k2 = boardKey(leagueOf.get(q), q.away, q.home);
      starts[ev] = real[matchKey(q.away, q.home)] || (k2 && real[k2]) || lockStart[ev.split('-')[1]] || null;
    }
    const tNow = now(); const started = new Set(Object.entries(starts).filter(([, t]) => t && Date.parse(t) <= tNow).map(([ev]) => ev));
    relay = M.relayIndex({ kalshiBoard: boards.kalshi, polymarket: boards.polymarket, novig: boards.novig, novigLive, polledAt, started, kalshiBooks, kalshiAt });
    for (const d of relay.droppedNovig || []) relayNote.push(`novig ${d.event}-${d.team} ignored (${d.reason}${d.ref != null ? `, ${d.novig} vs ${d.ref}` : ''})`);
  } catch (e) { relayNote.push(`relay: ${String(e.message).slice(0, 80)}`); }
  // start times for games the relay doesn't carry (e.g. NHL): Kalshi market close/expected times
  const missing = [...new Set(tickers.map((t) => t.split('-').slice(0, 2).join('-')))].filter((ev) => !(ev in starts));
  await Promise.all(missing.slice(0, 40).map(async (ev) => {
    try { const j = await getJ(`${KALSHI}/events/${encodeURIComponent(ev)}`); const m = (j.markets || [])[0] || {}; const t = m.expected_expiration_time || m.close_time; if (/FOOTBALL|NFL|NCAAF/i.test(ev) && lockStart[ev.split('-')[1]]) { starts[ev] = lockStart[ev.split('-')[1]]; return; } if (t && /FOOTBALL|NFL|NCAAF/i.test(ev) && isPlaceholderStart(t)) { starts[ev] = null; return; } if (t) starts[ev] = new Date(Date.parse(t) - 3 * 3600 * 1000).toISOString(); } catch (_) { /* no start: "Other days" */ }
  }));
  return { kalshiBooks, kalshiAt, relay, relayNote, starts, tickers: tickers.length };
}

/** Last live chances of recently seen games (daily needle snapshots, last 2 days; market facts, same for every user).
 * A finished game stops being priced; computeRootFor counts it at its final result (outcome >= 95%) from these. */
async function loadFinals(client, now) {
  try {
    const lo = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await client.from('root_for_needle_days').select('day,last:snap->last').gte('day', lo).order('day', { ascending: true });
    if (error) throw error;
    const out = {}; for (const r of data || []) Object.assign(out, (r && r.last) || {});
    return out;
  } catch (e) { console.error('[root-for] finals unavailable:', String((e && e.message) || e).slice(0, 120)); return {}; }
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
  { const z = raw[teams[0]] + raw[teams[1]]; if (z > 1) { raw[teams[0]] /= z; raw[teams[1]] /= z; } } // crossed books: scale to 100% (same as computeRootFor)
  const held = new Set(); for (const p of positions || []) for (const l of p.legs || []) if (l.event === ev && l.allowed && l.allowed.length === 1) held.add(l.allowed[0]);
  if (NEITHER in dist || (held.has(teams[0]) && held.has(teams[1]))) { const n = Math.max(0, 1 - raw[teams[0]] - raw[teams[1]]); return { [teams[0]]: raw[teams[0]], [teams[1]]: raw[teams[1]], ...(n > 0 || NEITHER in dist ? { [NEITHER]: n } : {}) }; }
  const h = held.has(teams[1]) && !held.has(teams[0]) ? teams[1] : teams[0]; const o = h === teams[0] ? teams[1] : teams[0];
  return { [h]: raw[h], [o]: 1 - raw[h] };
}

/** Saved leg fairs (combo_lock_leg_fairs) by lock id. Missing table / error → {} (the sheet falls back as before). */
async function loadStoredFairs(client, ids) {
  const out = {};
  for (let i = 0; i < (ids || []).length; i += 200) {
    const { data, error } = await client.from('combo_lock_leg_fairs').select('parlay_id,at_lock,at_lock_at,pregame,pregame_at').in('parlay_id', ids.slice(i, i + 200));
    if (error) { console.error('[root-for] saved leg fairs unavailable:', String(error.message || error).slice(0, 120)); return out; }
    for (const r of data || []) out[r.parlay_id] = r;
  }
  return out;
}

// Per-lock pregame baseline (Kevin, Oct 18): a lock's baseline locks when its FIRST leg kicks off. Every leg is
// taken at its chances at that moment, with the lock's contracts as of then, and frozen in the day snapshot
// (snap.lockPre[id] = { t0, pos, probs, adds, fb }). Seen within 5 min of that kickoff → the live chances; later
// → Kalshi 1-minute candles at the first kickoff; else the nearest earlier stored price (root_for_pregame_probs,
// latest captured at/before the kickoff, else the earliest stored, else that game's kickoff row) — counted in fb.
// Contracts added after the first kickoff (rare) join at the chances when we first see them (adds).
// Locks whose first leg hasn't started count at live pregame in both baseline and Now (no effect on the needle).
// Saved leg prices (combo_lock_leg_fairs, src/rootForStored.js) come first: a value saved ≤15 min before the first
// kickoff IS the kickoff number (counted in st). An older saved value (e.g. at lock time) beats the generic
// earlier-stored fallback but not the candles (still counted in fb). n = legs frozen for the lock.
async function lockBaselines(snap, pos, liveP, preP, starts, rows, now, loadStored = null) {
  const S = await import('../src/rootForSweat.js'); const ST = await import('../src/rootForStored.js');
  snap.lockPre = snap.lockPre || {};
  const memo = new Map(); const deadline = Date.now() + 5000; // locks not reached in time freeze on the next request
  const rf = async (u, o) => { for (let i = 0; ; i++) { const r = await deps.fetch(u, o); if (r.status !== 429 || i >= 3) return r; await new Promise((z) => setTimeout(z, 300 * (i + 1))); } }; // Kalshi rate limit
  const cached = (key, fn) => { if (!memo.has(key)) memo.set(key, fn().catch(() => null)); return memo.get(key); };
  const kick = (ev) => { const s = starts[ev] || ((rows.find((x) => x.event === ev && x.kickoff) || {}).kickoff); const ms = s ? Date.parse(s) : NaN; return Number.isFinite(ms) ? ms : null; };
  const binCandle = async (ev, k, held) => {
    try {
      const series = ev.split('-')[0];
      const r = await rf(`${KALSHI}/series/${series}/markets/${encodeURIComponent(ev)}/candlesticks?start_ts=${k - 1800}&end_ts=${k}&period_interval=1`, { headers: { accept: 'application/json' } });
      if (!r.ok) return null; const j = await r.json();
      const c = (j.candlesticks || []).filter((x) => x && x.yes_bid && x.yes_ask && x.yes_ask.close_dollars != null).pop(); if (!c) return null;
      const bid = Number(c.yes_bid.close_dollars), ask = Number(c.yes_ask.close_dollars); // inverse bet method: held side at its own bid
      const y = held === 'no' ? ask : bid; return Number.isFinite(y) ? { yes: y, no: 1 - y } : null;
    } catch { return null; }
  };
  const todo = [];
  for (const p of pos) {
    const id = String(p.id); const legs = p.legs || [];
    const ks = legs.map((l) => kick(l.event)).filter((x) => x != null); if (!ks.length) continue;
    const t0 = Math.min(...ks); if (now < t0) continue;
    const cur = snap.lockPre[id];
    if (cur) { // contracts changed after the freeze: the difference joins at today's chances
      if (Number(cur.pos.hit) !== Number(p.hit) || Number(cur.pos.miss) !== Number(p.miss)) {
        cur.adds = Number(cur.adds || 0) + S.expectedProfit([p], liveP) - S.expectedProfit([{ ...p, hit: cur.pos.hit, miss: cur.pos.miss }], liveP);
        cur.pos = { ...cur.pos, hit: p.hit, miss: p.miss };
      }
      continue;
    }
    todo.push({ id, p, legs, t0 });
  }
  let stored = {};
  if (todo.length && loadStored) { try { stored = (await loadStored([...new Set(todo.map((x) => x.id.split(':')[0]))])) || {}; } catch (_) { stored = {}; } }
  const heldM = ST.heldByEvent(pos);
  const freeze = async ({ id, p, legs, t0 }) => {
    if (Date.now() > deadline) return;
    const probs = {}; let fb = 0; let st = 0; const fresh = now - t0 <= 5 * 60000;
    const pick = ST.pickStored(stored[id.split(':')[0]], t0);
    const fromStored = (ev, dist) => (pick ? ST.storedEventProbs(ev, dist, pick.fairs, heldM[ev] || new Set()) : null);
    for (const l of legs) {
      const ev = l.event; if (probs[ev]) continue; const dist = liveP[ev] || preP[ev];
      if (pick && pick.kind === 'kickoff') { const sp = fromStored(ev, dist); if (sp) { probs[ev] = sp; st += 1; continue; } }
      if (fresh && liveP[ev]) { probs[ev] = liveP[ev]; continue; }
      const iso = new Date(t0).toISOString(); let got = null;
      try {
        const teams = Object.keys(dist || {}).filter((o) => o !== '__neither'); const held = (l.allowed || [])[0];
        if (teams.length === 2 && teams.includes('yes') && teams.includes('no')) got = await cached(`b|${ev}|${t0}|${held}`, () => binCandle(ev, Math.floor(t0 / 1000), held));
        else got = await cached(`m|${ev}|${t0}`, () => kickoffProbs(ev, dist, iso, pos, rf));
      } catch { got = null; }
      if (got) { probs[ev] = got; continue; }
      fb += 1;
      if (pick && pick.kind === 'early') { const sp = fromStored(ev, dist); if (sp) { probs[ev] = sp; continue; } }
      const mine = rows.filter((x) => x.event === ev && x.probs);
      const before = mine.filter((x) => x.captured_at && Date.parse(x.captured_at) <= t0).sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)))[0];
      const earliest = [...mine].sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)))[0];
      probs[ev] = (before || earliest || {}).probs || (snap.frozen || {})[ev] || dist;
    }
    if (Date.now() > deadline + 2500) return; // too slow: try again next request rather than freeze half-fetched
    snap.lockPre[id] = { t0: new Date(t0).toISOString(), pos: { id: p.id, legs, hit: p.hit, miss: p.miss }, probs, adds: 0, fb, st, n: Object.keys(probs).length };
  };
  for (let i = 0; i < todo.length; i += 3) await Promise.all(todo.slice(i, i + 3).map(freeze));
}

// Settled results for legs that dropped off the live boards (snap.last keeps only their LAST LIVE price, e.g.
// PIT 0.565 an hour before the end). Kalshi market results: binary market → yes/no; game event → the team whose
// market settled yes; "NE<8"/"NE>=8" buckets → that team won AND its "wins by 8+" spread market (KX…SPREAD-…-NE8).
const kRetry = async (u) => { for (let i = 0; ; i++) { const r = await deps.fetch(u, { headers: { accept: 'application/json' } }); if (r.status !== 429 || i >= 3) return r; await new Promise((z) => setTimeout(z, 300 * (i + 1))); } };
const SETTLED = new Set(['finalized', 'settled', 'determined']);
async function kMarket(ticker) { try { const r = await kRetry(`${KALSHI}/markets/${encodeURIComponent(ticker)}`); if (!r.ok) return null; const j = await r.json(); return j && j.market; } catch { return null; } }
async function resolveFinal(ev, dist) {
  const outs = Object.keys(dist || {}); if (!outs.length) return null;
  const done = (m) => m && SETTLED.has(String(m.status)) && (m.result === 'yes' || m.result === 'no');
  if (outs.every((o) => o === 'yes' || o === 'no')) { const m = await kMarket(ev); return done(m) ? { yes: m.result === 'yes' ? 1 : 0, no: m.result === 'yes' ? 0 : 1 } : null; }
  let ms; try { const r = await kRetry(`${KALSHI}/markets?event_ticker=${encodeURIComponent(ev)}&limit=100`); if (!r.ok) return null; ms = ((await r.json()) || {}).markets || []; } catch { return null; }
  if (!ms.length || !ms.every(done)) return null;
  const w = (ms.find((m) => m.result === 'yes') || {}).ticker; const team = w ? w.slice(ev.length + 1) : null;
  const res = {};
  for (const o of outs) {
    if (o === '__neither') { res[o] = team ? 0 : 1; continue; }
    const b = o.match(/^([A-Z]+)(<|>=)(\d+)$/);
    if (!b) { res[o] = o === team ? 1 : 0; continue; }
    if (b[1] !== team) { res[o] = 0; continue; }
    const [series, ...rest] = ev.split('-'); const sm = await kMarket(`${series.replace('GAME', 'SPREAD')}-${rest.join('-')}-${team}${b[3]}`);
    if (!done(sm)) return null; const cover = sm.result === 'yes'; res[o] = (b[2] === '>=') === cover ? 1 : 0;
  }
  return Object.values(res).some((v) => v === 1) ? res : null;
}
// fill snap.final for the day's legs no longer on the board (or not yet confirmed); returns true when every leg is settled
async function resolveSnapFinals(snap, probs = {}) {
  snap.final = snap.final || {}; const todo = Object.keys(snap.last || {}).filter((ev) => !snap.final[ev] && !(probs[ev] && Math.max(...Object.values(probs[ev])) >= 0.995));
  for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(async (ev) => { const f = await resolveFinal(ev, snap.last[ev]).catch(() => null); if (f) snap.final[ev] = f; }));
  return Object.keys(snap.last || {}).every((ev) => snap.final[ev] || (probs[ev] && Math.max(...Object.values(probs[ev])) >= 0.995));
}
// Re-price a saved day's locks the History P/L way (settled locks are gone from the open-lock query): reload each
// lock (any state) + its fills/orders/filled submissions and rebuild its positions; frozen pregame chances stay.
async function rebuildSnapPositions(client, snap) {
  try {
    const L = await import('../src/rootForLocks.js'); const T = await import('../src/comboTape.js');
    const base = [...new Set(Object.keys(snap.positions || {}).map((k) => String((snap.positions[k] || {}).id || k).split(':')[0]))];
    if (!base.length) return;
    const { data: parlays, error } = await client.from('combo_parlays').select('id,label,legs,parlay_stake,parlay_american,fill_american,is_free_bet,sportsbook,active,starts_at,hedge_mode,kalshi_status').in('id', base);
    if (error || !parlays) return;
    const { fills, singles, submissions } = await loadLockChildren(client, parlays.map((p) => p.id));
    const by = T.deskFillCounts(fills, submissions.filter(T.isConfirmedFillSubmission)).byParlay;
    for (const p of parlays) {
      const r = L.lockPositions(p, fills, singles, by[p.id] || 0); if (r.skip) continue;
      // saved positions keep their engine legs (event/outcomes); only contract value changes, mirrored singles go
      const want = new Map(r.positions.map((x) => [String(x.id), x]));
      for (const k of Object.keys(snap.positions)) {
        const sp = snap.positions[k]; const id = String((sp || {}).id || k); if (id !== p.id && !id.startsWith(p.id + ':')) continue;
        const np = want.get(id); if (!np) { delete snap.positions[k]; if (snap.lockPre) delete snap.lockPre[id]; continue; }
        snap.positions[k] = { ...sp, hit: np.hit, miss: np.miss, filled: np.filled, received: np.received };
        const f = (snap.lockPre || {})[id]; if (f && f.pos) f.pos = { ...f.pos, hit: np.hit, miss: np.miss };
      }
    }
  } catch (e) { console.error('[root-for] rebuild failed:', String((e && e.message) || e).slice(0, 120)); }
}

// Keep saving recent sheet days until every leg of the day's locks is settled (works with no open locks / cron):
// live_ev at settled results = what those locks actually made; final + 'settled' once all are decided.
async function settleDays(client, userId, now, skipDay = null) {
  try {
    const S = await import('../src/rootForSweat.js');
    const lo = new Date(now - 4 * 86400000).toISOString().slice(0, 10);
    const { data } = await client.from('root_for_needle_days').select('day,final,final_reason,snap').eq('user_id', userId).gte('day', lo);
    for (const row of data || []) {
      if (!row.snap || !row.snap.positions || (row.final && row.final_reason === 'settled' && Number(row.snap.settleV) >= 3) || String(row.day).slice(0, 10) === skipDay) continue;
      const snap = row.snap;
      if (!(Number(snap.settleV) >= 3)) await rebuildSnapPositions(client, snap); // v3: History P/L contract counts, no double-counted single orders
      snap.settleV = 3; const legsAll = await resolveSnapFinals(snap); // v2: losing leg decides a lock
      const pos = Object.values(snap.positions); const all = legsAll || pos.every((p) => S.lockDecided(p, snap.final)); const liveP = { ...(snap.last || {}), ...snap.final }; const preP = { ...liveP, ...(snap.frozen || {}) };
      const liveEv = S.dayValue(pos, liveP, snap.final); const preEv = S.lockedPregameEv(pos, preP, snap.lockPre);
      const stamp = new Date(now).toISOString();
      await client.from('root_for_needle_days').upsert({ user_id: userId, day: row.day, result: liveEv - preEv, pregame_ev: preEv, live_ev: liveEv, snap, final: all || !!row.final, final_reason: all ? 'settled' : row.final_reason || null, updated_at: stamp }, { onConflict: 'user_id,day' });
    }
  } catch (e) { console.error('[root-for] settle failed:', String((e && e.message) || e).slice(0, 120)); }
}

// Daily needle history (owner only). One row per sheet day (Today rolls over at 11 AM ET).
// result = EV of the day's locks at the day's games' latest chances − EV with those games at their kickoff numbers
// (later games stay at current chances in both, so only the day's games count).
// Finished games drop out of live prices and settled locks drop out of open locks, so the row keeps a snapshot:
// every lock and game seen that day, each game's last live chances, and its kickoff numbers.
// The day turns final when every game is decided (some outcome ≥ 98%, or its market has closed) or at the
// 11 AM ET rollover; a final row is never rewritten. Never fails the request.
async function needleDay(client, userId, out, now, frozen, starts = {}, rows = []) {
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
      // keep each leg's display names (finished props/totals drop off the board and lose them)
      snap.names = snap.names || {}; for (const e of out.perEvent || []) { if (!e || !evs.has(e.event)) continue; const nm = {}; for (const o of e.outcomes || []) if (o && o.outcome && o.name) nm[o.outcome] = o.name; if (e.rootForName) nm.label = e.rootForName; if (e.game) nm.game = e.game; if (Object.keys(nm).length) snap.names[e.event] = nm; }
      for (const p of TD.touchedLocks(model, new Set(Object.keys(snap.last)))) snap.positions[p.id] = p;
      const dayEvs = Object.keys(snap.frozen);
      if (dayEvs.length) {
        const pos = Object.values(snap.positions);
        const allSettled = await resolveSnapFinals(snap, probs);
        const liveP = { ...probs, ...Object.fromEntries(dayEvs.map((ev) => [ev, probs[ev] || snap.last[ev]])), ...snap.final };
        const preP = { ...liveP, ...snap.frozen };
        await lockBaselines(snap, pos, liveP, preP, starts, rows, now, (ids) => loadStoredFairs(client, ids));
        const liveEv = S.dayValue(pos, liveP, snap.final); const preEv = S.lockedPregameEv(pos, preP, snap.lockPre);
        const decided = allSettled || pos.every((p) => S.lockDecided(p, snap.final));
        await T('root_for_needle_days').upsert({ user_id: userId, day, result: liveEv - preEv, pregame_ev: preEv, live_ev: liveEv, games: Object.keys(snap.last).length, locks: pos.length, events: Object.keys(snap.last), snap, final: decided, final_reason: decided ? 'settled' : null, updated_at: stamp }, { onConflict: 'user_id,day' });
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
    // finished games drop off the live boards (no start time any more): use the saved kickoff of the row for
    // today's outcome set, else the latest saved kickoff for that game
    for (const [ev, dist] of Object.entries((out.model && out.model.probs) || {})) {
      if (starts[ev]) continue; const sig = S.outcomeSig(dist);
      const m = rows.find((x) => x.event === ev && x.sig === sig && x.kickoff) || rows.filter((x) => x.event === ev && x.kickoff).sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)))[0];
      if (m) starts[ev] = new Date(m.kickoff).toISOString();
    }
    // outcome set changed after kickoff (no on-time row for today's sig): regroup the latest on-time row for that game
    // (in memory only; the stored rows are never rewritten)
    for (const [ev, dist] of Object.entries((out.model && out.model.probs) || {})) {
      const t = starts[ev] ? Date.parse(starts[ev]) : NaN; if (!Number.isFinite(t) || now < t) continue;
      const sig = S.outcomeSig(dist); const cur = rows.find((x) => x.event === ev && x.sig === sig);
      if (cur && !(cur.captured_at && Date.parse(cur.captured_at) - t > 5 * 60000)) continue;
      const a = S.adaptPregame(rows, ev, dist, t); if (!a) continue;
      if (cur) rows.splice(rows.indexOf(cur), 1); rows.push(a); have.add(`${ev}#${sig}`);
    }
    const backfill = []; const probs = (out.model && out.model.probs) || {};
    await Promise.all(Object.entries(probs).map(async ([ev, dist]) => {
      const t = starts[ev] ? Date.parse(starts[ev]) : NaN; if (!Number.isFinite(t) || now < t) return;
      const sig = S.outcomeSig(dist);
      // a saved row taken after the REAL kickoff (late first snapshot, or saved under an old placeholder kickoff)
      // is replaced by Kalshi's price at kickoff when history is available
      const old = rows.find((x) => x.event === ev && x.sig === sig);
      if (old && !(old.captured_at && Date.parse(old.captured_at) - t > 5 * 60000)) return;
      try { const p = await kickoffProbs(ev, dist, starts[ev], out.model.positions); if (p) { const row = { slate_key: key, event: ev, sig, probs: p, kickoff: new Date(t).toISOString(), captured_at: new Date(t).toISOString() }; if (old) rows.splice(rows.indexOf(old), 1); rows.push(row); backfill.push(row); } else console.error('[root-for] kickoff backfill: no Kalshi kickoff price for', ev, sig); } catch (e) { console.error('[root-for] kickoff backfill failed for', ev, String((e && e.message) || e).slice(0, 120)); }
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
    const history = userId ? await needleDay(client, userId, out, now, frozen, starts, rows) : null;
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
    let dayRow = (history || []).find((h) => String(h.day).slice(0, 10) === sd) || null;
    if (dayRow && userId) { try { const { data: x } = await client.from('root_for_needle_days').select('snap').eq('user_id', userId).eq('day', sd).limit(1); if (x && x[0]) dayRow = { ...dayRow, snap: x[0].snap }; } catch (_) { /* gauge falls back */ } }
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
      const { parlays, fills, singles, submissions } = await loadLocks(client, uid);
      if (!parlays.length) { await settleDays(client, uid, deps.now()); return json(res, 200, { ok: true, empty: true }); }
      const mk = await loadMarkets(M, parlays, env0); const now = deps.now();
      const out = M.computeRootFor({ parlays, fills, singles, submissions, kalshiBooks: mk.kalshiBooks, relay: mk.relay, starts: mk.starts, now, kalshiAt: mk.kalshiAt, finals: await loadFinals(client, now) });
      const sw = await sweatBaseline(client, out, now, uid); { const TD = await import('../src/rootForToday.js'); await settleDays(client, uid, now, TD.sheetDay(now)); } // today: needleDay above
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
    // saved daily needle rows (owner's sheet days): the sheet stays visible for them even with no open locks
    const NEEDLE_COLS = 'day,result,pregame_ev,live_ev,games,locks,final,updated_at';
    const needleHist = async () => { const { data, error } = await client.from('root_for_needle_days').select(NEEDLE_COLS).eq('user_id', uid).order('day', { ascending: false }).limit(60); if (error) throw error; return data || []; };
    const needleRow = async (day) => { const { data, error } = await client.from('root_for_needle_days').select(NEEDLE_COLS + ',snap').eq('user_id', uid).eq('day', day).limit(1); if (error) throw error; return (data || [])[0] || null; };
    if (q.check === '1' || q.check === 1) { const hist = await needleHist().catch(() => []); return json(res, 200, { ok: true, locks: await countLocks(client, uid), days: hist.length }); }
    // one saved day (gauge vs that day's frozen pregame baseline, final needle, finished legs)
    if (q.day && /^\d{4}-\d{2}-\d{2}$/.test(String(q.day))) {
      const [row, history] = await Promise.all([needleRow(String(q.day)), needleHist()]);
      return json(res, 200, { ok: true, asOf: new Date(deps.now()).toISOString(), dayRow: row, history });
    }
    const M = await loadMods();
    const { parlays, fills, singles, submissions } = await loadLocks(client, uid);
    if (!parlays.length) { // nothing open: still show the latest saved day (and the past-day picker)
      if (auth.owner && uid === auth.user.id) await settleDays(client, uid, deps.now());
      const history = await needleHist().catch(() => []); const latest = history[0] ? await needleRow(String(history[0].day).slice(0, 10)).catch(() => null) : null;
      return json(res, 200, { ok: true, empty: true, locksTotal: 0, ...(history.length ? { asOf: new Date(deps.now()).toISOString(), sweat: { history, dayRow: latest } } : {}) });
    }
    const mk = await loadMarkets(M, parlays, env);
    const now = deps.now();
    const out = M.computeRootFor({ parlays, fills, singles, submissions, kalshiBooks: mk.kalshiBooks, relay: mk.relay, starts: mk.starts, now, kalshiAt: mk.kalshiAt, finals: await loadFinals(client, now) });
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
module.exports._helpers = { loadLocks, countLocks, loadMarkets, loadMods, loadStoredFairs, lockBaselines, requireUser, matchKey, isPlaceholderStart, nflTeam, nflKey, lockStarts };
