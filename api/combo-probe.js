// POST /api/combo-probe — Combo Locks "Check market price".
// Owner (Kevin): uses the server Kalshi key (env), same as before.
// Allowlisted testers: use THEIR OWN stored Kalshi key from Vault — never
// Kevin's env key. Rate-limited per user. No key → "Connect Kalshi to check price".
// Creates a real Kalshi RFQ at the lock's computed contract size, waits up to
// ~8s for maker quotes (early-exit on a usable NO bid), returns the best
// competing NO bid + implied American fill, then DELETE the RFQ. Never
// accept or confirm. Lists quotes with rfq_user_filter=self so the RFQ
// creator can see maker replies.
'use strict';

const lib = require('./combo-probe-lib');
const sign = require('./kalshi-sign');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const probeRate = lib.createProbeRateLimiter(lib.PROBE_COOLDOWN_MS);

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}

const defaults = {
  fetchImpl: (...args) => fetch(...args),
  sleep,
  now: () => Date.now(),
  requireOwner: requireComboOwner, // kept for older tests; handler uses requireProbeUser
  requireProbeUser: requireProbeUser,
  kalshiCreds: () => sign.readKalshiCreds(process.env),
  loadUserKalshiCreds: loadUserKalshiCreds,
  createClient: defaultCreateClient,
  rateLimiter: probeRate,
};

let deps = { ...defaults };

function resetDeps() {
  deps = { ...defaults };
  if (deps.rateLimiter && deps.rateLimiter._reset) deps.rateLimiter._reset();
}

function setDeps(patch) {
  deps = { ...deps, ...patch };
  // Older tests only stub requireOwner — wrap it as probe auth (owner path).
  if (patch && patch.requireOwner && !patch.requireProbeUser) {
    const stub = patch.requireOwner;
    deps.requireProbeUser = async (req) => {
      const r = await stub(req);
      if (!r || !r.ok) return r;
      return { ...r, isOwner: r.isOwner != null ? r.isOwner : true };
    };
  }
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

async function requireComboOwner(req, createClientImpl) {
  const token = lib.readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, status: 503, error: 'Server auth is not configured (SUPABASE_URL + SUPABASE_ANON_KEY)' };
  }
  const createClient = createClientImpl || deps.createClient || defaultCreateClient;
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  const user = data && data.user;
  if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
  if (!lib.isComboOwner(user)) {
    return { ok: false, status: 403, error: 'Not allowed' };
  }
  return { ok: true, user, isOwner: true };
}

/** Owner or Combo Locks allowlisted tester (email+id pair). */
async function requireProbeUser(req, createClientImpl) {
  const token = lib.readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, status: 503, error: 'Server auth is not configured (SUPABASE_URL + SUPABASE_ANON_KEY)' };
  }
  const createClient = createClientImpl || deps.createClient || defaultCreateClient;
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  const user = data && data.user;
  if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
  if (lib.isComboOwner(user)) return { ok: true, user, isOwner: true };
  if (!lib.canSeeComboLocks(user)) return { ok: false, status: 403, error: 'Not allowed' };
  return { ok: true, user, isOwner: false };
}

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return (deps.createClient || defaultCreateClient)(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Tester's own Vault Kalshi key. Never falls back to Kevin's env key. */
async function loadUserKalshiCreds(userId) {
  const client = serviceClient();
  if (!client) {
    return { ok: false, status: 503, error: 'Server is not configured', missingKey: false };
  }
  const { data, error } = await client.rpc('combo_exchange_key_get', {
    p_user: userId,
    p_venue: 'kalshi',
  });
  if (error) {
    return { ok: false, status: 502, error: 'Could not load your Kalshi key', missingKey: false };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.key_id || !row.secret) {
    return { ok: false, status: 400, error: lib.CONNECT_KALSHI_ERROR, missingKey: true, needKalshiKey: true };
  }
  return { ok: true, keyId: String(row.key_id), pem: String(row.secret) };
}

async function resolveProbeCreds(auth) {
  if (auth.isOwner) {
    const creds = deps.kalshiCreds();
    if (!creds.ok) {
      return { ok: false, status: 503, body: lib.missingKalshiKeysError(creds.missing) };
    }
    return { ok: true, creds, source: 'owner-env' };
  }
  const loaded = await deps.loadUserKalshiCreds(auth.user.id);
  if (!loaded.ok) {
    return {
      ok: false,
      status: loaded.status || 400,
      body: {
        ok: false,
        error: loaded.error || lib.CONNECT_KALSHI_ERROR,
        needKalshiKey: !!loaded.needKalshiKey || !!loaded.missingKey,
      },
    };
  }
  return { ok: true, creds: { ok: true, keyId: loaded.keyId, pem: loaded.pem }, source: 'user-vault' };
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

// Public (unsigned) collection read, used only to explain a rejected combo.
async function fetchCollectionEvents(collection) {
  try {
    const url = `${apiBase()}/multivariate_event_collections/${encodeURIComponent(collection)}`;
    const res = await deps.fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
    if (!res || !res.ok) return null;
    const parsed = await readJsonRes(res);
    return lib.collectionEventTickers(parsed.data);
  } catch (_) {
    return null;
  }
}

// Pick the collection that actually contains every leg (requested one first, then the
// other sports combo collections) and resolve each leg's real event_ticker from it.
async function pickCollection(legs, requested) {
  const order = [requested, ...lib.COMBO_COLLECTION_CANDIDATES.filter((c) => c !== requested)];
  const tried = [];
  let firstEvents = null;
  for (const c of order) {
    const events = await fetchCollectionEvents(c);
    if (!events) continue;
    tried.push(c);
    if (!firstEvents) firstEvents = events;
    const resolved = lib.legsInCollection(legs, events);
    if (resolved) return { ok: true, collection: c, legs: resolved };
  }
  if (!tried.length) return { ok: true, collection: requested, legs, unverified: true };
  // No collection holds all legs: name the legs missing from every one.
  const bad = legs.filter((l) => !lib.resolveEventTicker(l.ticker, firstEvents));
  return { ok: false, status: 400, error: lib.noCollectionError(bad.length ? bad : legs, tried),
    outsideCollection: (bad.length ? bad : legs).map((l) => l.ticker) };
}

// Maker rate for the combo's series (Kalshi GET /series); unknown → 0.035, same as the worker.
async function makerRateForMarket(marketTicker) {
  const series = String(marketTicker || '').split('-')[0];
  if (!series) return { series: null, makerRate: lib.FALLBACK_MAKER_RATE };
  try {
    const res = await deps.fetchImpl(`${apiBase()}/series/${encodeURIComponent(series)}`, { method: 'GET', headers: { accept: 'application/json' } });
    if (res && res.ok) {
      const { data } = await readJsonRes(res);
      const st = data && data.series;
      if (st && st.fee_type) return { series, makerRate: lib.makerRateFromSeries(st.fee_type, st.fee_multiplier), feeType: st.fee_type };
    }
  } catch (_) { /* fall through */ }
  return { series, makerRate: lib.FALLBACK_MAKER_RATE };
}

async function ensureComboMarket(legs, collection, creds) {
  const selected_markets = lib.selectedMarkets(legs);
  const path = `/multivariate_event_collections/${encodeURIComponent(collection)}`;
  const res = await kalshi('POST', path, {
    creds,
    body: { selected_markets },
  });
  if (!res.ok) {
    const body = res.data || res.text;
    const upstream = lib.kalshiErrorText(body, 'Could not create the combo market on Kalshi');
    let error = upstream;
    let outsideCollection;
    // Kalshi answers a leg whose game is not in the combo collection with a bare
    // 400 invalid_parameters. Name the offending leg(s) instead.
    if (res.status === 400 || /invalid_parameters/i.test(lib.kalshiErrorCode(body))) {
      const events = await fetchCollectionEvents(collection);
      const bad = lib.legsOutsideCollection(legs, events);
      if (bad.length) {
        error = lib.outsideCollectionError(bad, collection, upstream);
        outsideCollection = bad.map((l) => l.ticker);
      } else if (!/kalshi/i.test(upstream)) {
        error = `Kalshi rejected the combo market: ${upstream}`;
      }
    }
    return {
      ok: false,
      status: res.status >= 400 && res.status < 600 ? res.status : 502,
      error,
      upstreamError: upstream,
      outsideCollection,
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
  const q = lib.quotesListPath(rfqId);
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
      if (lib.pickBestQuote(quotes).bestAmerican != null) break;
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

async function runProbe({ legs: rawLegs, contracts, waitMs, collection: requested, creds }) {
  const picked = await pickCollection(rawLegs, requested);
  if (!picked.ok) return picked;
  const { collection, legs } = picked;
  const market = await ensureComboMarket(legs, collection, creds);
  if (!market.ok) return { ...market, collection };
  const fee = await makerRateForMarket(market.marketTicker);
  const created = await createRfq(market.marketTicker, contracts, creds);
  if (!created.ok) return { ...created, marketTicker: market.marketTicker };
  let poll;
  try {
    poll = await pollQuotes(created.rfqId, waitMs, creds);
  } finally {
    await deleteRfq(created.rfqId, creds);
  }
  const best = lib.pickBestQuote(poll.quotes, fee.makerRate);
  return {
    ok: true,
    collection,
    feeSeries: fee.series,
    makerRate: fee.makerRate,
    bestAmerican: best.bestAmerican,
    bestNoBid: best.bestNoBid,
    bestYesBid: best.bestYesBid,
    quoteCount: best.quoteCount,
    usableQuoteCount: best.usableQuoteCount,
    rfqId: created.rfqId,
    marketTicker: market.marketTicker,
    waitedMs: poll.waitedMs,
    suggestFillAmerican: best.suggestFillAmerican,
    contracts,
    listError: poll.listError || null,
  };
}

async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'POST only' });
    return;
  }

  const authFn = deps.requireProbeUser || deps.requireOwner;
  const auth = await authFn(req);
  if (!auth.ok) {
    json(res, auth.status || 401, { ok: false, error: auth.error || 'Unauthorized' });
    return;
  }
  if (auth.isOwner == null) {
    auth.isOwner = lib.isComboOwner(auth.user) || authFn === deps.requireOwner;
  }

  const rate = (deps.rateLimiter || probeRate).check((auth.user && (auth.user.id || auth.user.email)), deps.now());
  if (!rate.ok) {
    json(res, rate.status || 429, { ok: false, error: rate.error, retryAfterMs: rate.retryAfterMs || null });
    return;
  }

  const resolved = await resolveProbeCreds(auth);
  if (!resolved.ok) {
    json(res, resolved.status || 400, resolved.body);
    return;
  }
  const creds = resolved.creds;

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
      json(res, result.status || 502, {
        ok: false,
        error: result.error,
        upstreamError: result.upstreamError || null,
        outsideCollection: result.outsideCollection || null,
        marketTicker: result.marketTicker || null,
        collection: result.collection || null,
      });
      return;
    }
    (deps.rateLimiter || probeRate).mark((auth.user && (auth.user.id || auth.user.email)), deps.now());
    json(res, 200, { ...result, credsSource: resolved.source });
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
module.exports._requireProbeUser = requireProbeUser;
module.exports._loadUserKalshiCreds = loadUserKalshiCreds;
module.exports._resolveProbeCreds = resolveProbeCreds;
