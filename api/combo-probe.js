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
const lockCheck = require('./combo-lock-check-lib');
const sign = require('./kalshi-sign');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const probeRate = lib.createProbeRateLimiter(lib.PROBE_COOLDOWN_MS);
const lockCheckRate = lib.createProbeRateLimiter(lockCheck.LOCK_CHECK_COOLDOWN_MS);

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
  lockCheckRateLimiter: lockCheckRate,
  loadParlay: loadParlay,
  setProbePause: setProbePause,
  clearProbePause: clearProbePause,
  liveQuoteIds: liveQuoteIds,
};

let deps = { ...defaults };

function resetDeps() {
  deps = { ...defaults };
  if (deps.rateLimiter && deps.rateLimiter._reset) deps.rateLimiter._reset();
  if (deps.lockCheckRateLimiter && deps.lockCheckRateLimiter._reset) deps.lockCheckRateLimiter._reset();
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

// ── Pending-lock check (body.lockId) ─────────────────────────────────────────

async function loadParlay(id) {
  const client = serviceClient();
  if (!client) return { ok: false, status: 503, error: 'Server is not configured' };
  const { data, error } = await client.from('combo_parlays').select('*').eq('id', id).maybeSingle();
  if (error) return { ok: false, status: 502, error: 'Could not load that lock' };
  return { ok: true, parlay: data || null };
}

// Same signal family as the lock's Active toggle (combo-worker polls it every ~5s and cancels
// open quotes), but a separate, self-expiring column so a check never touches the user's own
// paused flag and the worker can drop a stale probe pause after 30s.
async function setProbePause(id, nowMs) {
  const client = serviceClient();
  if (!client) return { ok: false, error: 'Server is not configured' };
  const patch = lockCheck.probePausePatch(nowMs);
  const { error } = await client.from('combo_parlays').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message, missingColumn: lockCheck.isMissingProbePauseColumn(error) };
  return { ok: true, pausedAt: patch.probe_paused_at };
}

async function clearProbePause(id, pausedAt) {
  const client = serviceClient();
  if (!client) return { ok: false };
  let q = client.from('combo_parlays').update(lockCheck.PROBE_RESUME_PATCH).eq('id', id);
  if (pausedAt) q = q.eq('probe_paused_at', pausedAt); // only clear our own pause
  const { error } = await q;
  return { ok: !error, error: error && error.message };
}

async function liveQuoteIds(parlayId) {
  const client = serviceClient();
  if (!client) return { ok: false, ids: [] };
  const { data, error } = await client.from('combo_submissions').select('quote_id')
    .eq('parlay_id', parlayId).eq('is_live', true);
  if (error) return { ok: false, ids: [] };
  return { ok: true, ids: (data || []).map((r) => r && r.quote_id).filter(Boolean) };
}

async function selfCommunicationsId(creds) {
  try {
    const res = await kalshi('GET', '/communications/id', { creds });
    if (res.ok && res.data) return res.data.communications_id || res.data.id || null;
  } catch (_) { /* best effort */ }
  return null;
}

// Wait (≤ PAUSE_SETTLE_MAX_MS) for the worker to pull this lock's open quotes.
async function waitForPauseSettle(parlayId) {
  const start = deps.now();
  const seen = new Set();
  let live = 0;
  while (true) {
    const r = await deps.liveQuoteIds(parlayId);
    live = r.ids.length;
    r.ids.forEach((id) => seen.add(id));
    if (!r.ok || live === 0) break;
    if (deps.now() - start >= lockCheck.PAUSE_SETTLE_MAX_MS) break;
    await deps.sleep(1000);
  }
  return { ownQuoteIds: [...seen], stillLive: live, waitedMs: deps.now() - start };
}

// Full-window collection: no early exit. Keep every quote seen open at any point.
async function collectQuotes(rfqId, waitMs, creds) {
  const start = deps.now();
  const byId = new Map();
  let lastErr = null;
  while (true) {
    const listed = await listQuotes(rfqId, creds);
    if (listed.ok) {
      lastErr = null;
      listed.quotes.forEach((q, i) => {
        const key = (q && q.id) || `idx-${i}`;
        const prev = byId.get(key);
        if (!prev || !/^(open|quoted|)$/i.test(String(prev.status || 'open'))) byId.set(key, q);
      });
    } else lastErr = listed.error;
    const t = deps.now();
    if (t - start >= waitMs) break;
    await deps.sleep(Math.min(500, Math.max(0, start + waitMs - t)));
  }
  return { quotes: [...byId.values()], waitedMs: deps.now() - start, listError: lastErr };
}

async function runLockCheck({ parlay, creds }) {
  const legsRes = lib.normalizeLegs(parlay.legs);
  if (!legsRes.ok) return { ok: false, status: 400, error: legsRes.error };
  const contracts = lockCheck.lockContracts(parlay);
  if (!contracts) return { ok: false, status: 400, error: 'This lock has no contract size yet' };
  const alreadyPaused = parlay.paused === true;
  let pausedAt = null;
  if (!alreadyPaused) {
    const p = await deps.setProbePause(parlay.id, deps.now());
    if (!p.ok) {
      return { ok: false, status: p.missingColumn ? 503 : 502,
        error: p.missingColumn ? 'Check market price needs a database update (sql/20261010_combo_probe_pause.sql)'
          : 'Could not pause your quotes for the check' };
    }
    pausedAt = p.pausedAt;
  }
  let resumed = alreadyPaused;
  try {
    const settle = alreadyPaused ? { ownQuoteIds: [], stillLive: 0, waitedMs: 0 } : await waitForPauseSettle(parlay.id);
    const picked = await pickCollection(legsRes.legs, String(parlay.mve_collection || lib.COMBO_COLLECTION));
    if (!picked.ok) return picked;
    const market = await ensureComboMarket(picked.legs, picked.collection, creds);
    if (!market.ok) return { ...market, collection: picked.collection };
    const [fee, selfId] = await Promise.all([makerRateForMarket(market.marketTicker), selfCommunicationsId(creds)]);
    const created = await createRfq(market.marketTicker, contracts, creds);
    if (!created.ok) return { ...created, marketTicker: market.marketTicker };
    let poll;
    try {
      poll = await collectQuotes(created.rfqId, lockCheck.LOCK_CHECK_WAIT_MS, creds);
    } finally {
      await deleteRfq(created.rfqId, creds); // never accept / confirm
    }
    const competitors = lockCheck.competitorQuotes(poll.quotes, { selfCreatorId: selfId, ownQuoteIds: settle.ownQuoteIds });
    const best = lib.pickBestQuote(competitors, fee.makerRate);
    return {
      ok: true,
      lockId: parlay.id,
      collection: picked.collection,
      marketTicker: market.marketTicker,
      feeSeries: fee.series,
      makerRate: fee.makerRate,
      bestNoBid: best.bestNoBid,
      bestYesBid: best.bestYesBid,
      bestAmerican: best.bestAmerican,
      quoteCount: poll.quotes.length,
      competitorCount: best.usableQuoteCount,
      ownQuotesExcluded: poll.quotes.length - competitors.length,
      contracts,
      waitedMs: poll.waitedMs,
      pauseSettleMs: settle.waitedMs,
      ownQuotesStillLive: settle.stillLive,
      alreadyPaused,
      checkedAt: new Date(deps.now()).toISOString(),
      listError: poll.listError || null,
    };
  } finally {
    if (!alreadyPaused) {
      const c = await deps.clearProbePause(parlay.id, pausedAt).catch(() => ({ ok: false }));
      resumed = !!(c && c.ok);
      if (!resumed) console.error('[combo-probe] lock check: resume failed; worker safety net expires it in 30s', parlay.id);
    }
  }
}

async function handleLockCheck(req, res, auth, body) {
  const limiter = deps.lockCheckRateLimiter || lockCheckRate;
  const uid = auth.user && auth.user.id;
  const rate = limiter.check(uid, deps.now());
  if (!rate.ok) { json(res, 429, { ok: false, error: rate.error, retryAfterMs: rate.retryAfterMs || null }); return; }
  const loaded = await deps.loadParlay(String(body.lockId));
  if (!loaded.ok) { json(res, loaded.status || 502, { ok: false, error: loaded.error }); return; }
  const access = lockCheck.lockCheckAccess(loaded.parlay, auth.user);
  if (!access.ok) {
    json(res, access.status, { ok: false, error: access.error, polyNotAvailable: !!access.polyNotAvailable });
    return;
  }
  const parlay = loaded.parlay;
  // The lock owner's key: Kevin's lock → server key; a tester's lock → that tester's Vault key, never Kevin's.
  const plan = lockCheck.credsPlanFor(parlay, lib.OWNER_USER_ID);
  const resolved = await resolveProbeCreds({ user: { id: parlay.user_id }, isOwner: plan === 'owner-env' && auth.isOwner });
  if (!resolved.ok) { json(res, resolved.status || 400, resolved.body); return; }
  limiter.mark(uid, deps.now()); // a started check (pause + RFQ) counts, even if it errors
  try {
    const result = await runLockCheck({ parlay, creds: resolved.creds });
    if (!result.ok) {
      json(res, result.status || 502, { ok: false, error: result.error, outsideCollection: result.outsideCollection || null });
      return;
    }
    json(res, 200, { ...result, credsSource: resolved.source });
  } catch (e) {
    json(res, 502, { ok: false, error: String(e && e.message || e) });
  }
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

  const parsedBody = lib.parseBody(req);
  if (parsedBody && parsedBody.lockId) {
    await handleLockCheck(req, res, auth, parsedBody);
    return;
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

handler.config = { maxDuration: 30 };
module.exports = handler;
module.exports.config = { maxDuration: 30 };
module.exports._helpers = lib;
module.exports._sign = sign;
module.exports._runProbe = runProbe;
module.exports._runLockCheck = runLockCheck;
module.exports._lockCheck = lockCheck;
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
module.exports._requireComboOwner = requireComboOwner;
module.exports._requireProbeUser = requireProbeUser;
module.exports._loadUserKalshiCreds = loadUserKalshiCreds;
module.exports._resolveProbeCreds = resolveProbeCreds;
