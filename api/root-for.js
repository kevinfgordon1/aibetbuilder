'use strict';
// GET /api/root-for — owner-only "What to root for" across ALL open Combo Locks.
// Reads combo_parlays / combo_fills / combo_single_orders (read-only), live venue books
// (Kalshi public orderbooks, odds-relay Polymarket US + Novig), and runs the joint engine.
const lib = require('./combo-probe-lib');

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

/** Open locks: not archived, not merged away, not settled. */
async function loadLocks(client, userId) {
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
  let relay = {}; const relayNote = [];
  try {
    const h = await getJ(`${base}/health`);
    const polledAt = now();
    const nv = (h && h.novig) || {};
    const novigLive = /ws:up/.test(String((h.status || {}).novig || '')) && Number(nv.lastWsMsgAt) > 0 && polledAt - Number(nv.lastWsMsgAt) < 15000;
    const boards = { kalshi: [], polymarket: [], novig: [] };
    await Promise.all(['NFL', 'NCAAF'].flatMap((lg) => Object.keys(boards).map(async (v) => {
      try { const j = await getJ(`${base}/board?venue=${v}&league=${lg}`); boards[v].push(...(j.quotes || [])); } catch (e) { relayNote.push(`${v} ${lg}: ${String(e.message).slice(0, 60)}`); }
    })));
    relay = M.relayIndex({ kalshiBoard: boards.kalshi, polymarket: boards.polymarket, novig: boards.novig, novigLive, polledAt });
  } catch (e) { relayNote.push(`relay: ${String(e.message).slice(0, 80)}`); }
  return { kalshiBooks, kalshiAt, relay, relayNote, tickers: tickers.length };
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
    const M = await loadMods();
    const { parlays, fills, singles } = await loadLocks(deps.createClient(url, key, clientOpts), auth.user.id);
    const mk = await loadMarkets(M, parlays, env);
    const out = M.computeRootFor({ parlays, fills, singles, kalshiBooks: mk.kalshiBooks, relay: mk.relay, now: deps.now(), kalshiAt: mk.kalshiAt });
    return json(res, 200, { ok: true, asOf: new Date(deps.now()).toISOString(), relayNote: mk.relayNote, ...out });
  } catch (e) {
    console.error('[root-for]', String((e && e.message) || e).slice(0, 200));
    return json(res, 500, { ok: false, error: 'Could not compute right now' });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
module.exports._setDeps = (p) => { deps = { ...deps, ...p }; };
module.exports._helpers = { loadLocks, loadMarkets, loadMods };
