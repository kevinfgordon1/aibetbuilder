// Novig venue branch for Live Trading Desk (Kevin only; caller gates owner).
'use strict';

const { createNovigClient, openOrdersFrom } = require('./novig-client');
const { readNovigDeskCreds, missingKeysError, locationErrorText } = require('./novig-auth');

let novigMod = null;
let priceMod = null;
let protectMath = null;
let modsPromise = null;

function ensureMods() {
  if (novigMod && priceMod && protectMath) return Promise.resolve();
  if (!modsPromise) {
    modsPromise = Promise.all([
      import('../src/liveDeskNovig.js'),
      import('../src/liveDeskPrice.js'),
      import('../src/liveDeskProtect.js'),
    ]).then(([n, p, pr]) => {
      novigMod = n;
      priceMod = p;
      protectMath = pr;
    }).catch((err) => {
      modsPromise = null;
      throw err;
    });
  }
  return modsPromise;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.orders)) return value.orders;
  if (value && Array.isArray(value.positions)) return value.positions;
  if (value && Array.isArray(value.fills)) return value.fills;
  return [];
}

function clientFromCreds(creds, fetchImpl) {
  return createNovigClient({
    keyId: creds.keyId,
    privateKey: creds.privateKey,
    apiBase: creds.apiBase,
    fetchImpl,
  });
}

async function loadNflSlate(client) {
  const events = [];
  let after = '';
  for (let i = 0; i < 8; i++) {
    const page = await client.publicListEvents({ league: 'NFL', limit: 100, ...(after ? { after } : {}) });
    const items = asList(page);
    for (const ev of items) {
      const g = novigMod.classifyNovigGameEvent(ev);
      if (g) events.push({ ...g, markets: [] });
    }
    after = page && page.next;
    if (!after || !items.length) break;
  }
  // Attach MONEY markets
  after = '';
  const byEvent = new Map(events.map((e) => [e.id, e]));
  for (let i = 0; i < 12; i++) {
    const page = await client.publicListMarkets({ league: 'NFL', marketType: 'MONEY', limit: 500, ...(after ? { after } : {}) });
    const items = asList(page);
    for (const m of items) {
      const game = byEvent.get(String(m.eventId || ''));
      if (!game) continue;
      const read = novigMod.readNovigMarket(m);
      if (!read.ok) continue;
      game.markets.push({
        id: 'moneyline',
        label: 'Moneyline',
        slug: read.slug,
        marketId: read.marketId,
        longName: read.longName,
        shortName: read.shortName,
      });
    }
    after = page && page.next;
    if (!after || !items.length) break;
  }
  const now = Date.now();
  return events
    .filter((g) => g.markets.length)
    .filter((g) => !g.startsTs || g.startsTs > now - 18 * 3600 * 1000)
    .sort((a, b) => (a.startsTs || 0) - (b.startsTs || 0));
}

function mapPosition(row, market) {
  const qty = Number(row.qty != null ? row.qty : row.quantity) || 0;
  if (!qty) return null;
  const cost = Number(row.cost) || 0;
  // avg entry prob ≈ 100 * cost / qty when cost is dollars and qty is 1¢ contracts
  // docs: average entry = 100 × cost / qty
  const avgProb = qty ? (100 * cost) / qty : null;
  const name = market
    ? (String(row.outcomeId) === market.longOutcomeId ? market.longName : market.shortName)
    : String(row.outcomeId || '');
  return {
    slug: market ? market.slug : novigMod.protectSlugForNovig(row.marketId),
    marketId: String(row.marketId || ''),
    outcomeId: String(row.outcomeId || ''),
    title: market ? market.description : name,
    side: market && String(row.outcomeId) === market.shortOutcomeId ? 'short' : 'long',
    net: qty,
    contracts: Math.abs(qty),
    totalCost: cost,
    american: avgProb != null ? priceMod.americanFromProb(avgProb) : '',
    venue: 'novig',
  };
}

// One resting Novig order, in the fields the desk Open orders list reads
// (title, outcomeName, americanLabel, quantity, protect). Novig only has bids,
// so every rest is a buy of its own outcome at `price`.
function mapOrder(row, market, protectRow) {
  const price = Number(row.price);
  const qty = Number(row.remaining != null ? row.remaining : row.qty) || 0;
  const outcomeId = String(row.outcomeId || '');
  let outcomeName = '';
  if (market && market.ok !== false) {
    if (outcomeId === market.longOutcomeId) outcomeName = market.longName;
    else if (outcomeId === market.shortOutcomeId) outcomeName = market.shortName;
  }
  const american = price > 0 && price < 1 ? priceMod.americanFromProb(price) : null;
  const order = {
    id: String(row.orderId || row.id || ''),
    marketSlug: market && market.slug ? market.slug : novigMod.protectSlugForNovig(row.marketId),
    marketId: String(row.marketId || ''),
    outcomeId,
    price,
    american,
    americanLabel: american != null ? (priceMod.formatAmerican(american) || '') : '',
    action: 'buy',
    outcomeName,
    qty,
    contracts: qty,
    quantity: qty,
    tif: row.tif || 'GTC',
    status: row.status || 'OPEN',
    venue: 'novig',
    title: market && market.ok !== false
      ? ('Novig · ' + (market.description || (market.longName + ' / ' + market.shortName)))
      : 'Novig order',
  };
  const badge = protectRow ? protectMath.protectBadge(protectRow) : null;
  return badge ? { ...order, protect: badge } : order;
}

async function marketsFor(client, ids) {
  const out = new Map();
  await Promise.all([...new Set(ids.filter(Boolean))].slice(0, 25).map(async (id) => {
    try {
      out.set(id, novigMod.readNovigMarket(await client.getMarket(id)));
    } catch (_) { /* label falls back */ }
  }));
  return out;
}

async function snapshot(client, marketId, store) {
  await ensureMods();
  const games = await loadNflSlate(client).catch(() => []);
  let market = null;
  let book = null;
  let positions = [];
  let orders = [];
  let fills = [];
  let positionsError = null;
  let ordersError = null;

  try {
    const rawPos = await client.listPositions();
    const posRows = asList(rawPos);
    positions = posRows.map((r) => mapPosition(r, null)).filter(Boolean);
  } catch (err) {
    positionsError = novigMod.deskErrorFromNovig(err, 'Could not load Novig positions.');
  }

  let protectRows = [];
  if (store && store.configured && store.listArmed) {
    try {
      const armed = await store.listArmed();
      protectRows = (armed || []).filter((r) => String(r.market_slug || '').startsWith('novig:'));
    } catch (_) { /* optional */ }
  }

  try {
    const rawOrders = openOrdersFrom(await client.listOpenOrders());
    const markets = await marketsFor(client, rawOrders.map((r) => String(r.marketId || '')));
    const byOrder = new Map(protectRows.map((r) => [String(r.order_id), r]));
    orders = rawOrders.map((r) => mapOrder(r, markets.get(String(r.marketId || '')), byOrder.get(String(r.orderId || r.id || ''))));
  } catch (err) {
    ordersError = novigMod.deskErrorFromNovig(err, 'Could not load Novig open orders.');
  }

  try {
    const rawFills = await client.listFills({ limit: 50 });
    fills = asList(rawFills).slice(0, 50).map((f) => ({
      id: String(f.fillId || ''),
      orderId: String(f.orderId || ''),
      marketId: String(f.marketId || ''),
      outcomeId: String(f.outcomeId || ''),
      qty: Number(f.qty) || 0,
      cost: f.cost,
      fee: f.fee,
      taker: !!f.taker,
      ts: f.ts,
      venue: 'novig',
    }));
  } catch (_) { /* optional */ }

  if (marketId && novigMod.isNovigMarketId(marketId)) {
    try {
      const raw = await client.getMarket(marketId);
      market = novigMod.readNovigMarket(raw);
      if (market.ok) {
        try {
          book = await client.getBook(marketId, { depth: 5 });
        } catch (_) {
          try { book = await client.publicGetBook(marketId, { depth: 5 }); } catch (__) { book = null; }
        }
        const longAsk = book ? novigMod.bestAskFromNovigBook(book, market.longOutcomeId, market.shortOutcomeId) : null;
        const shortAsk = book ? novigMod.bestAskFromNovigBook(book, market.shortOutcomeId, market.longOutcomeId) : null;
        market = {
          ...market,
          bestAsk: longAsk && longAsk.ask,
          bestBid: shortAsk ? (1 - shortAsk.ask) : null,
          longAsk: longAsk && longAsk.ask,
          shortAsk: shortAsk && shortAsk.ask,
          fee: market.fee,
        };
      } else {
        market = null;
      }
    } catch (err) {
      return {
        ok: false,
        status: err.statusCode || 502,
        error: novigMod.deskErrorFromNovig(err, 'Could not load that Novig market.'),
      };
    }
  }

  return {
    ok: true,
    venue: 'novig',
    capDollars: novigMod.MAX_SIZE_DOLLARS,
    defaultDollars: novigMod.DEFAULT_SIZE_DOLLARS,
    marketTypes: novigMod.NOVIG_MARKET_TYPES,
    games,
    market: market && market.ok !== false ? market : null,
    positions,
    orders,
    fills,
    filledOrders: fills,
    activities: fills,
    positionFills: null,
    protectArmed: protectRows,
    positionsError,
    ordersError,
    paper: /paper\.novig\.com/i.test(String(client.wsUrl && client.wsUrl() || '')),
  };
}

async function placeOrder(client, body, { store, ownerEmail } = {}) {
  await ensureMods();
  const marketId = String(body.marketId || body.marketSlug || '').replace(/^novig:/i, '').trim();
  if (!novigMod.isNovigMarketId(marketId)) {
    return { ok: false, status: 400, error: 'Pick a Novig market from the game list.' };
  }
  let raw;
  try {
    raw = await client.getMarket(marketId);
  } catch (err) {
    return { ok: false, status: err.statusCode || 502, error: novigMod.deskErrorFromNovig(err, 'Could not load Novig market.') };
  }
  const market = novigMod.readNovigMarket(raw);
  if (!market.ok) return { ok: false, status: 400, error: market.error };
  if (!market.tradable) return { ok: false, status: 400, error: 'That Novig market is not open.' };

  const allowCross = !!(body.allowCross === true || body.allowCross === '1' || body.allowCross === 'true');
  const quote = novigMod.quoteNovigRest({
    american: body.american,
    outcome: body.outcome,
    action: body.action,
    dollars: body.dollars,
    longOutcomeId: market.longOutcomeId,
    shortOutcomeId: market.shortOutcomeId,
  });
  if (!quote.ok) return { ok: false, status: 400, error: quote.error };

  const team = quote.outcome === 'short' ? market.shortName : market.longName;
  const confirm = body.confirm || {};
  if (confirm.american != null && String(confirm.american) !== String(quote.snappedAmerican)
      && String(confirm.american) !== quote.snappedAmericanLabel) {
    // soft: also accept numeric
    const confA = Number(confirm.american);
    if (!(Number.isFinite(confA) && confA === quote.snappedAmerican)) {
      return { ok: false, status: 400, error: 'Confirm the American odds shown on the ticket.' };
    }
  }
  if (confirm.contracts != null && Number(confirm.contracts) !== Number(quote.qty)) {
    return { ok: false, status: 400, error: 'Confirm the contract count shown on the ticket.' };
  }

  const protectReq = protectMath.readProtectRequest(body, { riskDollars: quote.riskDollars });
  if (!protectReq.ok) return { ok: false, status: 400, error: protectReq.error };
  let protectNote = protectReq.overCap ? protectReq.note : '';
  // Bet Protect for Novig: arm in registry; sweep must understand novig: slugs.
  if (protectReq.on && protectReq.defaulted && (!store || !store.configured)) {
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

  const orderBody = novigMod.buildNovigOrder(quote, { postOnly: !allowCross });
  let created;
  try {
    created = await client.placeOrder(orderBody);
  } catch (err) {
    return {
      ok: false,
      status: err.statusCode || 502,
      error: novigMod.deskErrorFromNovig(err, 'Novig rejected the order.'),
      code: err.code || null,
    };
  }
  const orderId = created && (created.orderId || created.id);
  let armed = null;
  if (protectReq.on) {
    if (!orderId) {
      return { ok: false, status: 502, error: 'Order id missing, so Bet Protect was not armed. Cancel it on Novig if it appeared.' };
    }
    try {
      armed = await store.insert({
        order_id: String(orderId),
        owner_email: String(ownerEmail || '').trim().toLowerCase(),
        market_slug: market.slug,
        outcome: quote.outcome,
        action: quote.action,
        yes_price: quote.orderPrice,
        outcome_micro: Math.round(quote.outcomeProb * 1e6),
        submitted_outcome_micro: Math.round(quote.outcomeProb * 1e6),
        contracts: quote.qty,
        x_cents: protectReq.xCents,
        y_cents: protectReq.yCents,
        lineage_id: String(orderId),
        protect_count: 0,
        status: 'armed',
        title: market.description || market.slug,
        outcome_name: team,
        tick: novigMod.NOVIG_TICK,
        min_qty: 1,
      });
    } catch (_) {
      try { await client.cancelOrder(String(orderId)); } catch (__) { /* best effort */ }
      return { ok: false, status: 503, error: 'Bet Protect could not be armed. That order was cancelled.' };
    }
  }

  return {
    ok: true,
    orderId: orderId ? String(orderId) : null,
    venue: 'novig',
    snap: {
      outcome: quote.outcome,
      action: quote.action,
      outcomeName: team,
      americanLabel: quote.snappedAmericanLabel,
      contracts: quote.qty,
      riskLabel: quote.riskLabel,
      price: quote.orderPrice,
      tif: orderBody.tif,
      line: team + ' ' + quote.snappedAmericanLabel + ' · ' + quote.qty + ' contracts · max loss ' + quote.riskLabel,
      protect: armed
        ? { on: true, xCents: protectReq.xCents, yCents: protectReq.yCents }
        : (protectNote ? { on: false, overCap: !!protectReq.overCap, note: protectNote } : { on: false }),
    },
  };
}

async function cancelOrder(client, body, store) {
  await ensureMods();
  const orderId = String(body.orderId || '').trim();
  if (!orderId) return { ok: false, status: 400, error: 'Missing order id.' };
  try {
    await client.cancelOrder(orderId);
  } catch (err) {
    return { ok: false, status: err.statusCode || 502, error: novigMod.deskErrorFromNovig(err, 'Cancel failed.') };
  }
  if (store && store.configured) {
    try { await store.disarm(orderId); } catch (_) { /* ok */ }
  }
  return { ok: true, orderId, venue: 'novig' };
}

async function handle({ req, res, json, deps, owner, store, body, query }) {
  await ensureMods();
  const creds = (deps.novigCreds || readNovigDeskCreds)(process.env);
  if (!creds.ok) {
    json(res, 503, missingKeysError(creds.missing));
    return true;
  }
  const client = clientFromCreds(creds, deps.fetchImpl);
  const method = req.method;

  if (method === 'GET') {
    const marketId = String((query && (query.marketId || query.slug)) || '').replace(/^novig:/i, '');
    const snap = await snapshot(client, marketId, store);
    if (snap.ok === false) {
      json(res, snap.status || 502, snap);
      return true;
    }
    json(res, 200, snap);
    return true;
  }

  const op = String((body && body.op) || '').trim().toLowerCase();
  if (op === 'place') {
    const result = await placeOrder(client, body, {
      store,
      ownerEmail: owner && owner.user && (owner.user.email || owner.user.user_metadata && owner.user.user_metadata.email),
    });
    json(res, result.ok ? 200 : (result.status || 400), result);
    return true;
  }
  if (op === 'cancel') {
    const result = await cancelOrder(client, body, store);
    json(res, result.ok ? 200 : (result.status || 400), result);
    return true;
  }
  json(res, 400, { ok: false, error: 'Unknown Novig desk op.' });
  return true;
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

function queryFrom(req) {
  const query = { ...((req && req.query) || {}) };
  if (!req || !req.url || (query.marketId && query.slug)) return query;
  try {
    const sp = new URL(req.url, 'http://localhost').searchParams;
    if (!query.marketId && sp.get('marketId')) query.marketId = sp.get('marketId');
    if (!query.slug && sp.get('slug')) query.slug = sp.get('slug');
  } catch (_) { /* query string stays as req.query */ }
  return query;
}

function sendJson(res, status, body) {
  const payload = (body && typeof body === 'object' && !Array.isArray(body)) ? { ...body } : { ok: false, error: 'Request failed' };
  delete payload.stack;
  if (!res || res.headersSent || res.writableEnded) return;
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  } catch (_) { /* headers already flushed */ }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(payload);
    return;
  }
  res.statusCode = status;
  try { res.setHeader('Content-Type', 'application/json; charset=utf-8'); } catch (_) { /* ignore */ }
  res.end(JSON.stringify(payload));
}

// Public /api/novig-desk is this file. It is not a request handler unless we
// export one, and Vercel then answers 500 with a platform stack. Unauthenticated
// and invalid calls stop here, before Novig or the ESM desk modules load.
async function requireNovigDeskUser(req) {
  const token = readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 401, error: 'Sign in required' };
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.getUser(token);
    const user = data && data.user;
    if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
    const access = await import('../src/comboAccess.js');
    if (!access.canSeeOwnerTools(user)) return { ok: false, status: 403, error: 'Not allowed' };
    return { ok: true, user };
  } catch (_) {
    return { ok: false, status: 401, error: 'Sign in required' };
  }
}

function defaultProtectStore() {
  try {
    const { createSupabaseProtectStore } = require('../lib/desk-protect-registry');
    return createSupabaseProtectStore();
  } catch (_) {
    return null;
  }
}

const httpDefaults = {
  requireUser: requireNovigDeskUser,
  novigCreds: null,
  fetchImpl: (...args) => fetch(...args),
  protectStore: defaultProtectStore,
};

let httpDeps = { ...httpDefaults };

function resetHttpDeps() {
  httpDeps = { ...httpDefaults };
}

function setHttpDeps(patch) {
  httpDeps = { ...httpDeps, ...patch };
}

async function httpHandler(req, res) {
  let authed = false;
  try {
    const method = String((req && req.method) || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      if (typeof res.setHeader === 'function') {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      if (typeof res.status === 'function') res.status(204).end();
      else {
        res.statusCode = 204;
        res.end();
      }
      return;
    }
    if (method !== 'GET' && method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    const owner = await httpDeps.requireUser(req);
    if (!owner || !owner.ok) {
      const status = owner && Number(owner.status) === 403 ? 403 : 401;
      const allowed = status === 403 ? 'Not allowed' : (owner && owner.error === 'Invalid session' ? 'Invalid session' : 'Sign in required');
      sendJson(res, status, { ok: false, error: allowed });
      return;
    }
    authed = true;
    const deps = { fetchImpl: httpDeps.fetchImpl };
    if (httpDeps.novigCreds) deps.novigCreds = httpDeps.novigCreds;
    await handle({
      req,
      res,
      json: sendJson,
      deps,
      owner,
      store: httpDeps.protectStore ? httpDeps.protectStore() : null,
      body: method === 'POST' ? parseBody(req) : {},
      query: queryFrom(req),
    });
  } catch (_) {
    sendJson(res, authed ? 400 : 401, { ok: false, error: authed ? 'Request failed' : 'Sign in required' });
  }
}

module.exports = httpHandler;
module.exports.handle = handle;
module.exports.snapshot = snapshot;
module.exports.mapOrder = mapOrder;
module.exports.placeOrder = placeOrder;
module.exports.cancelOrder = cancelOrder;
module.exports.ensureMods = ensureMods;
module.exports.readNovigDeskCreds = readNovigDeskCreds;
module.exports._setHttpDeps = setHttpDeps;
module.exports._resetHttpDeps = resetHttpDeps;
