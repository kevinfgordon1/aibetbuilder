// POST /api/combo-probe — owner-only Combo Locks Probe.
// Creates a real Kalshi RFQ at the lock's computed contract size, waits ~4s
// for maker quotes, returns the best competing NO bid + implied American fill,
// then DELETE the RFQ. Never accept or confirm.
'use strict';

const lib = require('./combo-probe-lib');
const sign = require('./kalshi-sign');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const defaults = {
  fetchImpl: (...args) => fetch(...args),
  sleep,
  now: () => Date.now(),
  requireOwner: requireComboOwner,
  kalshiCreds: () => sign.readKalshiCreds(process.env),
};

let deps = { ...defaults };

function resetDeps() {
  deps = { ...defaults };
}

function setDeps(patch) {
  deps = { ...deps, ...patch };
}

function json(res, status, body) {
  res.status(status).json(body);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

async function requireComboOwner(req) {
  const token = lib.readBearer(req);
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
  if (!lib.canSeeComboLocks(user, process.env)) {
    return { ok: false, status: 403, error: 'Not allowed' };
  }
  return { ok: true, user };
}

function apiBase() {
  return String(process.env.KALSHI_API_BASE || lib.KALSHI_API_BASE).replace(/\/+$/, '');
}

async function readJsonRes(res) {
  const text = await res.text();
  if (!text) return { data: null, text: '' };
  try {
    return { data: JSON.parse(text), text };
  } catch (_) {
    return { data: null, text };
  }
}

async function kalshi(method, path, { body, creds } = {}) {
  const url = apiBase() + path;
  const res = await sign.signedFetch(url, {
    method,
    body,
    keyId: creds.keyId,
    pem: creds.pem,
    fetchImpl: deps.fetchImpl,
  });
  const parsed = await readJsonRes(res);
  return { status: res.status, ok: res.ok, ...parsed };
}

async function ensureComboMarket(legs, collection, creds) {
  const selected_markets = lib.selectedMarkets(legs);
  const path = `/multivariate_event_collections/${encodeURIComponent(collection)}`;
  const res = await kalshi('POST', path, {
    creds,
    body: { selected_markets },
  });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status >= 400 && res.status < 600 ? res.status : 502,
      error: lib.kalshiErrorText(res.data || res.text, 'Could not create the combo market on Kalshi'),
    };
  }
  const marketTicker = lib.marketTickerFromCreate(res.data);
  if (!marketTicker) {
    return { ok: false, status: 502, error: 'Kalshi created a combo market but returned no market_ticker' };
  }
  return { ok: true, marketTicker };
}

async function createRfq(marketTicker, contracts, creds) {
  const res = await kalshi('POST', '/communications/rfqs', {
    creds,
    body: {
      market_ticker: marketTicker,
      contracts,
      contracts_fp: String(contracts),
      rest_remainder: false,
    },
  });
  if (res.status === 409) {
    return {
      ok: false,
      status: 409,
      error: 'An open RFQ already exists on this combo market. Cancel it on Kalshi and retry Probe.',
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status >= 400 && res.status < 600 ? res.status : 502,
      error: lib.kalshiErrorText(res.data || res.text, 'Could not create the probe RFQ'),
    };
  }
  const rfqId = lib.rfqIdFromCreate(res.data);
  if (!rfqId) return { ok: false, status: 502, error: 'Kalshi created an RFQ but returned no id' };
  return { ok: true, rfqId };
}

async function listQuotes(rfqId, creds) {
  const q = `/communications/quotes?rfq_id=${encodeURIComponent(rfqId)}`;
  const res = await kalshi('GET', q, { creds });
  if (!res.ok) {
    return {
      ok: false,
      error: lib.kalshiErrorText(res.data || res.text, 'Could not list quotes'),
      quotes: [],
    };
  }
  return { ok: true, quotes: lib.quotesFromList(res.data) };
}

async function deleteRfq(rfqId, creds) {
  if (!rfqId) return { ok: true };
  try {
    const res = await kalshi('DELETE', `/communications/rfqs/${encodeURIComponent(rfqId)}`, { creds });
    if (res.status === 404 || res.status === 204 || res.ok) return { ok: true };
    return { ok: false, error: lib.kalshiErrorText(res.data || res.text, 'Could not delete the probe RFQ') };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function pollQuotes(rfqId, waitMs, creds) {
  const start = deps.now();
  const deadline = start + waitMs;
  let quotes = [];
  let lastErr = null;
  while (true) {
    const listed = await listQuotes(rfqId, creds);
    if (listed.ok) {
      quotes = listed.quotes;
      lastErr = null;
    } else {
      lastErr = listed.error;
    }
    const t = deps.now();
    if (t >= deadline) break;
    await deps.sleep(Math.min(350, Math.max(0, deadline - t)));
    if (deps.now() >= deadline) break;
  }
  return { quotes, waitedMs: deps.now() - start, listError: lastErr };
}

async function runProbe({ legs, contracts, waitMs, collection, creds }) {
  const market = await ensureComboMarket(legs, collection, creds);
  if (!market.ok) return market;
  const created = await createRfq(market.marketTicker, contracts, creds);
  if (!created.ok) return { ...created, marketTicker: market.marketTicker };
  let poll;
  try {
    poll = await pollQuotes(created.rfqId, waitMs, creds);
  } finally {
    await deleteRfq(created.rfqId, creds);
  }
  const best = lib.pickBestQuote(poll.quotes);
  return {
    ok: true,
    bestAmerican: best.bestAmerican,
    bestNoBid: best.bestNoBid,
    bestYesBid: best.bestYesBid,
    quoteCount: best.quoteCount,
    rfqId: created.rfqId,
    marketTicker: market.marketTicker,
    waitedMs: poll.waitedMs,
    suggestFillAmerican: best.suggestFillAmerican,
    contracts,
  };
}

async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'POST only' });
    return;
  }

  const owner = await deps.requireOwner(req);
  if (!owner.ok) {
    json(res, owner.status || 401, { ok: false, error: owner.error || 'Unauthorized' });
    return;
  }

  const creds = deps.kalshiCreds();
  if (!creds.ok) {
    json(res, 503, lib.missingKalshiKeysError(creds.missing));
    return;
  }

  const body = lib.parseBody(req);
  const legsRes = lib.normalizeLegs(body.legs);
  if (!legsRes.ok) {
    json(res, 400, { ok: false, error: legsRes.error });
    return;
  }
  const contracts = lib.parseContracts(body.contracts);
  if (!contracts) {
    json(res, 400, { ok: false, error: 'contracts must be a positive integer (the lock cap)' });
    return;
  }
  const waitMs = lib.clampWaitMs(body.waitMs);
  const collection = String(body.collection || body.mve_collection || lib.COMBO_COLLECTION).trim()
    || lib.COMBO_COLLECTION;

  try {
    const result = await runProbe({
      legs: legsRes.legs,
      contracts,
      waitMs,
      collection,
      creds,
    });
    if (!result.ok) {
      json(res, result.status || 502, { ok: false, error: result.error, marketTicker: result.marketTicker || null });
      return;
    }
    json(res, 200, result);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/never accepts or confirms/i.test(msg)) {
      json(res, 500, { ok: false, error: msg });
      return;
    }
    json(res, 502, { ok: false, error: msg });
  }
}

handler.config = { maxDuration: 20 };
module.exports = handler;
module.exports.config = { maxDuration: 20 };
module.exports._helpers = lib;
module.exports._sign = sign;
module.exports._runProbe = runProbe;
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
module.exports._requireComboOwner = requireComboOwner;
