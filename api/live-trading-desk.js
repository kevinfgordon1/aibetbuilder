// Live Trading Desk — Kevin only. Polymarket US Retail (api.polymarket.us).
// GET  /api/live-trading-desk[?slug=]  positions, open orders, recent trades, NFL slate
// POST { op: "place", marketSlug, outcome, action, american, dollars, gameId? }
// POST { op: "cancel", orderId, marketSlug }
// gameId, when sent, must be the NFL event whose moneyline slug is marketSlug.
// Every call checks the signed-in Supabase user is OWNER_EMAIL. UI hide is not the gate.
'use strict';

// src/comboAccess.js and src/liveDeskPrice.js are ESM. Static require()
// throws ERR_REQUIRE_ESM on the Vercel Node runtime, the function dies
// during load, and Vercel answers 500 JSON { error: { code, message } }.
// The desk renders that object and React unmounts the page. Dynamic
// import() works from this CommonJS route.
let access = null;
let price = null;
let games = null;
let modsPromise = null;

function ensureMods() {
  if (access && price && games) return Promise.resolve();
  if (!modsPromise) {
    modsPromise = Promise.all([
      import('../src/comboAccess.js'),
      import('../src/liveDeskPrice.js'),
      import('../src/liveDeskGames.js'),
    ]).then(([accessMod, priceMod, gamesMod]) => {
      access = accessMod;
      price = priceMod;
      games = gamesMod;
    }).catch((err) => {
      modsPromise = null;
      throw err;
    });
  }
  return modsPromise;
}

const auth = require('./polymarket-us-auth');
const { createPolymarketUsClient } = require('./polymarket-us-client');

const defaults = {
  fetchImpl: (...args) => fetch(...args),
  requireOwner: requireDeskOwner,
  creds: () => auth.readPolymarketCreds(process.env),
};

let deps = { ...defaults };
let nflGamesCache = { at: 0, games: null };
const NFL_GAMES_TTL_MS = 60 * 1000;

function resetDeps() {
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

async function snapshot(client, slug) {
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
  return {
    ok: true,
    venue: 'polymarket-us',
    capDollars: price.MAX_SIZE_DOLLARS,
    defaultDollars: price.DEFAULT_SIZE_DOLLARS,
    positions: decoratePositions(positions, markets),
    orders: price.mapOpenOrders(ordersRaw, markets),
    activity: price.mapActivities(activityRaw, markets),
    market: slug ? (markets[slug] || null) : null,
    games: asList(slate && slate.games),
    marketTypes: games.DESK_MARKET_TYPES,
    gamesError: (slate && typeof slate.gamesError === 'string') ? slate.gamesError : '',
  };
}

async function placeOrder(client, body) {
  const slug = String(body.marketSlug || body.slug || '').trim();
  if (!price.isMarketSlug(slug)) return { ok: false, status: 400, error: 'Enter a Polymarket US market slug.' };
  const early = games.placeScopeError(body, slug);
  if (early) return { ok: false, status: 400, error: early };
  if (price.parseAmerican(body.american) == null) {
    return { ok: false, status: 400, error: 'Enter American odds. An empty box is not the market and not a placeholder.' };
  }
  const dollars = typeof body.dollars === 'number' ? body.dollars : Number(String(body.dollars == null ? '' : body.dollars).trim());
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { ok: false, status: 400, error: 'Enter a dollar size. The desk will not substitute the $100 cap.' };
  }
  const raw = await client.getMarketBySlug(slug);
  const typed = games.placeScopeError(body, slug, raw);
  if (typed) return { ok: false, status: 400, error: typed };
  const market = price.readMarketSides(raw);
  if (!market.ok) return { ok: false, status: 400, error: market.error };
  if (!market.tradable) return { ok: false, status: 400, error: 'That market is not open on Polymarket US.' };
  const ticket = price.restingLimitOrder({
    slug,
    american: body.american,
    outcome: body.outcome,
    action: body.action,
    tick: market.tick,
    dollars,
    minQty: market.minQty,
  });
  if (!ticket.ok) return { ok: false, status: 400, error: ticket.error };
  const quote = ticket.quote;
  const orderBody = ticket.order;
  const outcomeName = quote.outcome === 'short' ? market.shortName : market.longName;
  const stray = price.strayOrderFields(body, orderBody);
  if (stray) return { ok: false, status: 400, error: stray };
  const shown = price.matchDisplayedOrder({
    confirm: body.confirm,
    quote,
    order: orderBody,
    team: outcomeName,
    yesTeam: market.longName,
  });
  if (!shown.ok) return { ok: false, status: 400, error: shown.error };
  const created = await client.createOrder(orderBody);
  const orderId = created && (created.id || (created.order && created.order.id));
  return {
    ok: true,
    orderId: orderId ? String(orderId) : null,
    snap: {
      outcome: quote.outcome,
      action: quote.action,
      outcomeName,
      americanLabel: quote.snappedAmericanLabel,
      centsLabel: quote.centsLabel,
      yesCentsLabel: quote.yesCentsLabel,
      yesPriceValue: quote.yesPriceValue,
      contracts: quote.contracts,
      riskLabel: quote.riskLabel,
      intent: quote.intent,
      tick: quote.tick,
    },
  };
}

async function cancelOrder(client, body) {
  const slug = String(body.marketSlug || body.slug || '').trim();
  const orderId = String(body.orderId || '').trim();
  if (!price.isMarketSlug(slug)) return { ok: false, status: 400, error: 'Missing market slug.' };
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(orderId)) return { ok: false, status: 400, error: 'Missing order id.' };
  await client.cancelOrder(orderId, slug);
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
    const owner = await deps.requireOwner(req);
    if (!owner.ok) {
      json(res, owner.status || 401, { ok: false, error: owner.error || 'Unauthorized' });
      return;
    }
    const creds = deps.creds();
    if (!creds.ok) {
      const missing = auth.missingKeysError(creds.missing);
      json(res, 503, missing);
      return;
    }
    const client = clientFromCreds(creds);
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
      json(res, 200, await snapshot(client, slug));
      return;
    }
    const body = parseBody(req);
    const op = String(body.op || '').trim().toLowerCase();
    if (op === 'place') {
      const placed = await placeOrder(client, body);
      json(res, placed.ok ? 200 : (placed.status || 400), placed);
      return;
    }
    if (op === 'cancel') {
      const canceled = await cancelOrder(client, body);
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
