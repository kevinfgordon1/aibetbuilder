// Live Trading Desk — Kevin only. Polymarket US Retail (api.polymarket.us).
// GET  /api/live-trading-desk[?slug=]  positions, open orders, recent trades, NFL slate
// POST { op: "place", marketSlug, outcome, action, american, dollars, gameId?, confirm, allowCross?, protect?, protectXCents?, protectYCents? }
//   protect defaults ON when omitted; send protect:false to rest unprotected.
// POST { op: "cancel", orderId, marketSlug }
// POST { op: "protect-sweep" }  adverse-only cancel + re-rest. Owner session OR
//      header x-admin-secret = ADMIN_API_SECRET (same secret as the admin alert route).
//      The shared secret cannot place or cancel. Safe to call every 1–2s.
// Combo Locks polls POST /api/desk-protect-sweep (header X-Desk-Protect-Secret).
// gameId, when sent, must be the NFL event whose moneyline slug is marketSlug.
// Every non-sweep call checks the signed-in Supabase user is OWNER_EMAIL. UI hide is not the gate.
'use strict';

const crypto = require('crypto');

// src/comboAccess.js and src/liveDeskPrice.js are ESM. Static require()
// throws ERR_REQUIRE_ESM on the Vercel Node runtime, the function dies
// during load, and Vercel answers 500 JSON { error: { code, message } }.
// The desk renders that object and React unmounts the page. Dynamic
// import() works from this CommonJS route.
let access = null;
let price = null;
let games = null;
let protectMath = null;
let modsPromise = null;

function ensureMods() {
  if (access && price && games && protectMath) return Promise.resolve();
  if (!modsPromise) {
    modsPromise = Promise.all([
      import('../src/comboAccess.js'),
      import('../src/liveDeskPrice.js'),
      import('../src/liveDeskGames.js'),
      import('../src/liveDeskProtect.js'),
    ]).then(([accessMod, priceMod, gamesMod, protectMod]) => {
      access = accessMod;
      price = priceMod;
      games = gamesMod;
      protectMath = protectMod;
    }).catch((err) => {
      modsPromise = null;
      throw err;
    });
  }
  return modsPromise;
}

const auth = require('./polymarket-us-auth');
const { createPolymarketUsClient } = require('./polymarket-us-client');
const { createSupabaseProtectStore } = require('../lib/desk-protect-registry');
const { runProtectSweep } = require('../lib/desk-protect-sweep');
const { sendProtectPing } = require('../lib/desk-protect-notify');

let sharedStore = null;
function defaultProtectStore() {
  if (!sharedStore) sharedStore = createSupabaseProtectStore();
  return sharedStore;
}

function headerValue(headers, name) {
  if (!headers) return '';
  const direct = headers[name] || headers[name.toLowerCase()];
  if (direct) return Array.isArray(direct) ? String(direct[0]) : String(direct);
  const found = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return found ? String(headers[found]) : '';
}

function serviceSweepAuthorized(req) {
  const secret = String(process.env.ADMIN_API_SECRET || '');
  if (!secret) return false;
  const provided = headerValue(req && req.headers, 'x-admin-secret').trim();
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const defaults = {
  fetchImpl: (...args) => fetch(...args),
  requireOwner: requireDeskOwner,
  creds: () => auth.readPolymarketCreds(process.env),
  protectStore: defaultProtectStore,
  notify: (text) => sendProtectPing(text),
  now: () => Date.now(),
  serviceAuthorized: serviceSweepAuthorized,
};

let deps = { ...defaults };
let nflGamesCache = { at: 0, games: null };
const NFL_GAMES_TTL_MS = 60 * 1000;

function resetDeps() {
  sharedStore = null;
  deps = { ...defaults };
  nflGamesCache = { at: 0, games: null };
}

function setDeps(patch) {
  deps = { ...deps, ...patch };
}

function json(res, status, body) {
  res.status(status).json(body);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-secret');
  res.setHeader('Cache-Control', 'no-store');
}

function readBearer(req) {
  const headers = (req && req.headers) || {};
  const raw = headers.authorization || headers.Authorization || '';
  const m = /^Bearer\s+(\S+)/i.exec(String(raw));
  return m ? m[1] : '';
}

function parseBody(req) {
  const raw = req && req.body;
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  try { return JSON.parse(String(raw)); } catch (_) { return {}; }
}

async function requireDeskOwner(req) {
  const token = readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, status: 503, error: 'Server auth is not configured (SUPABASE_URL + SUPABASE_ANON_KEY)' };
  }
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  const user = data && data.user;
  if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
  if (!access.canSeeOwnerTools(user)) {
    return { ok: false, status: 403, error: 'Not allowed' };
  }
  return { ok: true, user };
}

function clientFromCreds(creds) {
  return createPolymarketUsClient({
    keyId: creds.keyId,
    secretKey: creds.secretKey,
    apiBase: creds.apiBase,
    gatewayBase: creds.gatewayBase,
    fetchImpl: deps.fetchImpl,
  });
}

function upstreamStatus(err) {
  const code = Number(err && err.statusCode);
  if (code >= 400 && code < 500) return code;
  return 502;
}

function upstreamMessage(err, fallback) {
  const msg = err && (err.publicMessage || err.message);
  return auth.redactText(msg || fallback || 'Polymarket US request failed');
}

async function allPositions(client) {
  const merged = {};
  let cursor = '';
  for (let i = 0; i < 5; i++) {
    const page = await client.listPositions({ limit: 100, cursor: cursor || undefined });
    const positions = (page && page.positions) || {};
    if (positions && typeof positions === 'object' && !Array.isArray(positions)) {
      Object.assign(merged, positions);
    }
    if (!page || page.eof || !page.nextCursor || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return { positions: merged };
}

async function loadMarkets(client, slugs) {
  const out = {};
  const unique = [...new Set((slugs || []).map((s) => String(s || '').trim()).filter(price.isMarketSlug))].slice(0, 24);
  await Promise.all(unique.map(async (slug) => {
    try {
      const raw = await client.getMarketBySlug(slug);
      const sides = price.readMarketSides(raw);
      if (sides.ok) out[slug] = sides;
    } catch (_) { /* names are optional on the board */ }
  }));
  return out;
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function decoratePositions(rows, markets) {
  return rows.map((row) => {
    const m = markets[row.slug];
    if (!m) return row;
    return {
      ...row,
      title: row.title || m.title,
      longName: m.longName,
      shortName: m.shortName,
      team: row.side === 'short' ? m.shortName : m.longName,
      tick: m.tick,
      minQty: m.minQty,
      tradable: m.tradable,
    };
  });
}

async function loadNflGames(client) {
  const now = Date.now();
  if (nflGamesCache.games && now - nflGamesCache.at < NFL_GAMES_TTL_MS) {
    return { games: nflGamesCache.games, gamesError: '' };
  }
  try {
    const text = await client.getNflLeagueEventsText();
    const list = games.gamesFromLeagueEventsText(text, now);
    const safe = Array.isArray(list) ? list : [];
    nflGamesCache = { at: now, games: safe };
    return { games: safe, gamesError: '' };
  } catch (_) {
    if (nflGamesCache.games) return { games: nflGamesCache.games, gamesError: '' };
    return {
      games: [],
      gamesError: 'NFL slate did not load. Positions are still here; pick a game once the slate returns.',
    };
  }
}

function withProtect(orders, rows) {
  const byId = new Map();
  for (const row of rows || []) {
    if (row && row.order_id) byId.set(row.order_id, row);
  }
  return orders.map((order) => {
    const badge = protectMath.protectBadge(byId.get(order.id));
    return badge ? { ...order, protect: badge } : order;
  });
}

async function armedRows(store) {
  if (!store || !store.configured) return [];
  try { return await store.listArmed(); } catch (_) { return []; }
}

async function improvedRows(store, slugs) {
  if (!store || !store.configured || typeof store.listImproved !== 'function') return [];
  try { return await store.listImproved(slugs); } catch (_) { return []; }
}

function withFillNotes(positions, rows) {
  return positions.map((row) => {
    const line = protectMath.protectFillForPosition(row, rows);
    return line ? { ...row, protectFill: line } : row;
  });
}

async function snapshot(client, slug, store) {
  const [positionsRaw, ordersRaw, activityRaw, slate] = await Promise.all([
    allPositions(client),
    client.listOpenOrders(),
    client.listActivities({
      limit: 20,
      sortOrder: 'SORT_ORDER_DESCENDING',
      types: 'ACTIVITY_TYPE_TRADE',
    }),
    loadNflGames(client),
  ]);
  const positions = price.mapPositions(positionsRaw);
  const slugs = positions.map((p) => p.slug);
  const orderList = asList(ordersRaw && ordersRaw.orders);
  for (const order of orderList) {
    if (order && order.marketSlug) slugs.push(order.marketSlug);
  }
  for (const item of asList(activityRaw && activityRaw.activities)) {
    if (item && item.trade && item.trade.marketSlug) slugs.push(item.trade.marketSlug);
  }
  if (slug) slugs.push(slug);
  const markets = await loadMarkets(client, slugs);
  let market = slug ? (markets[slug] || null) : null;
  if (market && slug) market = await withBook(client, slug, market);
  return {
    ok: true,
    venue: 'polymarket-us',
    capDollars: price.MAX_SIZE_DOLLARS,
    defaultDollars: price.DEFAULT_SIZE_DOLLARS,
    positions: withFillNotes(decoratePositions(positions, markets), await improvedRows(store, slugs)),
    orders: withProtect(price.mapOpenOrders(ordersRaw, markets), await armedRows(store)),
    activity: price.mapActivities(activityRaw, markets),
    market,
    games: asList(slate && slate.games),
    marketTypes: games.DESK_MARKET_TYPES,
    gamesError: (slate && typeof slate.gamesError === 'string') ? slate.gamesError : '',
  };
}

async function withBook(client, slug, market) {
  try {
    const raw = await client.getMarketBbo(slug);
    const book = price.readYesBbo(raw);
    return {
      ...market,
      bestBid: book.bestBid,
      bestAsk: book.bestAsk,
      bookOk: !!book.ok,
    };
  } catch (_) {
    return { ...market, bestBid: null, bestAsk: null, bookOk: false };
  }
}

async function placeOrder(client, body, { store, ownerEmail } = {}) {
  const slug = String(body.marketSlug || body.slug || '').trim();
  if (!price.isMarketSlug(slug)) return { ok: false, status: 400, error: 'Enter a Polymarket US market slug.' };
  const early = games.placeScopeError(body, slug);
  if (early) return { ok: false, status: 400, error: early };
  const raw = await client.getMarketBySlug(slug);
  const typed = games.placeScopeError(body, slug, raw);
  if (typed) return { ok: false, status: 400, error: typed };
  const market = price.readMarketSides(raw);
  if (!market.ok) return { ok: false, status: 400, error: market.error };
  if (!market.tradable) return { ok: false, status: 400, error: 'That market is not open on Polymarket US.' };
  const quote = price.quoteRestingOrder({
    american: body.american,
    outcome: body.outcome,
    action: body.action,
    tick: market.tick,
    dollars: body.dollars,
    minQty: market.minQty,
  });
  if (!quote.ok) return { ok: false, status: 400, error: quote.error };
  const team = quote.outcome === 'short' ? market.shortName : market.longName;
  const shown = price.matchDisplayedOrder(quote, team, body.confirm);
  if (!shown.ok) return { ok: false, status: 400, error: shown.error };
  const stray = price.strayOrderMismatch(body, quote);
  if (stray) return { ok: false, status: 400, error: stray };
  const allowCross = price.allowCrossRequested(body.allowCross);
  if (!allowCross) {
    let book;
    try {
      book = price.readYesBbo(await client.getMarketBbo(slug));
    } catch (_) {
      book = { ok: false, error: 'The book is missing or crossed. A rest will not be sent.' };
    }
    const cross = price.crossBlock({
      bookSide: quote.bookSide,
      yesMicro: quote.yesMicro,
      bestBid: book.bestBid,
      bestAsk: book.bestAsk,
    });
    if (!cross.ok) return { ok: false, status: 400, error: cross.error || book.error };
  }
  // Bet Protect defaults ON when the request omits the flag; over the $100
  // Protect cap it rests unprotected with a note instead of blocking.
  const protectReq = protectMath.readProtectRequest(body, { riskDollars: quote.riskDollars });
  if (!protectReq.ok) return { ok: false, status: 400, error: protectReq.error };
  let protectNote = protectReq.overCap ? protectReq.note : '';
  if (protectReq.on && protectReq.defaulted && (!store || !store.configured)) {
    // Implicit default only: rest unprotected and say so. An explicit
    // protect:true still refuses to rest without the registry (below).
    protectReq.on = false;
    protectNote = 'Bet Protect registry is not configured, so this order rests unprotected.';
  }
  if (protectReq.on && (!store || !store.configured)) {
    return {
      ok: false,
      status: 503,
      error: 'Bet Protect registry is not configured. Apply sql/desk_protect_rests.sql and set SUPABASE_SERVICE_KEY.',
    };
  }
  const orderBody = price.buildLimitOrder({ slug, quote, allowCross });
  const created = await client.createOrder(orderBody);
  const orderId = created && (created.id || (created.order && created.order.id));
  let armed = null;
  if (protectReq.on) {
    if (!orderId) {
      return { ok: false, status: 502, error: 'Order id missing, so Bet Protect was not armed. Cancel it on Polymarket US.' };
    }
    try {
      armed = await store.insert({
        order_id: String(orderId),
        owner_email: String(ownerEmail || '').trim().toLowerCase(),
        market_slug: slug,
        outcome: quote.outcome,
        action: quote.action,
        yes_price: quote.yesPriceValue,
        outcome_micro: quote.outcomeMicro,
        submitted_outcome_micro: quote.outcomeMicro,
        contracts: quote.contracts,
        x_cents: protectReq.xCents,
        y_cents: protectReq.yCents,
        lineage_id: String(orderId),
        protect_count: 0,
        status: 'armed',
        title: market.title || slug,
        outcome_name: team,
        tick: quote.tick,
        min_qty: market.minQty,
      });
    } catch (_) {
      try { await client.cancelOrder(String(orderId), slug); } catch (__) { /* best effort */ }
      return { ok: false, status: 503, error: 'Bet Protect could not be armed. That order was cancelled.' };
    }
  }
  return {
    ok: true,
    orderId: orderId ? String(orderId) : null,
    snap: {
      outcome: quote.outcome,
      action: quote.action,
      outcomeName: team,
      americanLabel: quote.snappedAmericanLabel,
      centsLabel: quote.centsLabel,
      yesCentsLabel: quote.yesCentsLabel,
      yesPriceValue: quote.yesPriceValue,
      contracts: quote.contracts,
      riskLabel: quote.riskLabel,
      intent: quote.intent,
      bookSide: quote.bookSide,
      line: shown.expected.line,
      tick: quote.tick,
      protect: armed
        ? { on: true, xCents: protectReq.xCents, yCents: protectReq.yCents }
        : (protectNote ? { on: false, overCap: !!protectReq.overCap, note: protectNote } : { on: false }),
    },
  };
}

async function cancelOrder(client, body, store) {
  const slug = String(body.marketSlug || body.slug || '').trim();
  const orderId = String(body.orderId || '').trim();
  if (!price.isMarketSlug(slug)) return { ok: false, status: 400, error: 'Missing market slug.' };
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(orderId)) return { ok: false, status: 400, error: 'Missing order id.' };
  await client.cancelOrder(orderId, slug);
  if (store && store.configured) {
    try { await store.disarm(orderId); } catch (_) { /* book cancel already landed */ }
  }
  return { ok: true, orderId };
}

async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    await ensureMods();
    const body = req.method === 'POST' ? parseBody(req) : {};
    const op = String(body.op || '').trim().toLowerCase();
    const sweepBySecret = op === 'protect-sweep' && deps.serviceAuthorized(req);
    let owner = { ok: true, user: null };
    if (!sweepBySecret) {
      owner = await deps.requireOwner(req);
      if (!owner.ok) {
        json(res, owner.status || 401, { ok: false, error: owner.error || 'Unauthorized' });
        return;
      }
    }
    const creds = deps.creds();
    if (!creds.ok) {
      const missing = auth.missingKeysError(creds.missing);
      json(res, 503, missing);
      return;
    }
    const client = clientFromCreds(creds);
    const store = deps.protectStore();
    if (req.method === 'GET') {
      const q = (req.query) || {};
      let slug = q.slug || '';
      if (!slug && req.url) {
        try { slug = new URL(req.url, 'http://localhost').searchParams.get('slug') || ''; } catch (_) { slug = ''; }
      }
      slug = String(Array.isArray(slug) ? slug[0] : slug).trim();
      if (slug && !price.isMarketSlug(slug)) {
        json(res, 400, { ok: false, error: 'Bad market slug.' });
        return;
      }
      json(res, 200, await snapshot(client, slug, store));
      return;
    }
    if (op === 'protect-sweep') {
      const swept = await runProtectSweep({
        client,
        store,
        notify: deps.notify,
        now: deps.now,
      });
      json(res, swept.ok ? 200 : (swept.status || 503), swept);
      return;
    }
    if (op === 'place') {
      const email = owner.user && (owner.user.email || owner.user.user_email);
      const placed = await placeOrder(client, body, { store, ownerEmail: email });
      json(res, placed.ok ? 200 : (placed.status || 400), placed);
      return;
    }
    if (op === 'cancel') {
      const canceled = await cancelOrder(client, body, store);
      json(res, canceled.ok ? 200 : (canceled.status || 400), canceled);
      return;
    }
    json(res, 400, { ok: false, error: 'Unknown desk action.' });
  } catch (err) {
    json(res, upstreamStatus(err), { ok: false, error: upstreamMessage(err) });
  }
}

handler.config = { maxDuration: 15 };
module.exports = handler;
module.exports.config = { maxDuration: 15 };
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
module.exports._requireDeskOwner = requireDeskOwner;
