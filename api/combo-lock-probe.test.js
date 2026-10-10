'use strict';
// Check market price on a pending lock (api/combo-probe.js, body.parlay_id).
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('crypto');
const lib = require('./combo-probe-lib');
const handler = require('./combo-probe.js');

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const KEVIN = { email: 'kev120909@gmail.com', id: lib.OWNER_USER_ID };
const KENNY = { email: 'kmguido97@gmail.com', id: '42b5ee16-68d5-4b3b-a931-40aa17cd1a47' };
const HIGGINS = { email: 'c.w.higgins1@gmail.com', id: '721c1166-be0b-4856-8a88-6de3a8b047b9' };
const LOCK_ID = '11111111-2222-4333-8444-555555555555';

function mockRes() {
  const out = { statusCode: 0, body: null, headers: {} };
  return { out, setHeader(k, v) { out.headers[k] = v; }, status(c) { out.statusCode = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
}

// Minimal supabase-js query builder over in-memory tables, logging writes.
function fakeDb(tables, log) {
  return {
    from(table) {
      const q = { table, filters: [], op: 'select', patch: null };
      const run = () => {
        const rows = (tables[table] || []).filter((r) => q.filters.every(([k, op, v]) => (op === 'eq' ? String(r[k]) === String(v) : String(r[k]) >= String(v))));
        if (q.op === 'update') {
          if (q.failUpdate) return { data: null, error: { message: q.failUpdate } };
          log.push({ table, patch: q.patch, filters: q.filters.slice() });
          rows.forEach((r) => Object.assign(r, q.patch));
        }
        return { data: rows, error: null };
      };
      const b = {
        select() { return b; },
        update(patch) { q.op = 'update'; q.patch = patch; if (tables.__failHold && 'probe_hold_until' in patch) q.failUpdate = tables.__failHold; return b; },
        eq(k, v) { q.filters.push([k, 'eq', v]); return b; },
        gte(k, v) { q.filters.push([k, 'gte', v]); return b; },
        async maybeSingle() { const r = run(); return { data: (r.data || [])[0] || null, error: r.error }; },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return b;
    },
  };
}

function kalshiFake(calls, { quotes, holdSeen }) {
  return async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const path = new URL(url).pathname;
    calls.push({ method, path, keyId: opts && opts.headers && (opts.headers['KALSHI-ACCESS-KEY'] || opts.headers['kalshi-access-key']) });
    if (/accept|confirm/i.test(path)) throw new Error('MUST NOT accept/confirm');
    const json = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body), clone() { return this; } });
    if (method === 'GET' && /multivariate_event_collections\//.test(path)) return json(404, {});
    if (method === 'GET' && /\/series\//.test(path)) return json(200, { series: { fee_type: 'quadratic', fee_multiplier: 1 } });
    if (method === 'POST' && /multivariate_event_collections\//.test(path)) {
      if (holdSeen) holdSeen();
      return json(200, { market_ticker: 'KXMVECROSSCATEGORY-S2026ABC-1' });
    }
    if (method === 'POST' && path.endsWith('/communications/rfqs')) return json(201, { id: 'rfq-lock-1' });
    if (method === 'GET' && path.endsWith('/communications/rfqs/rfq-lock-1')) return json(200, { rfq: { id: 'rfq-lock-1', creator_id: 'me-acct' } });
    if (method === 'GET' && path.endsWith('/communications/quotes')) return json(200, { quotes });
    if (method === 'DELETE' && path.endsWith('/communications/rfqs/rfq-lock-1')) return json(204, null);
    throw new Error(`unexpected ${method} ${path}`);
  };
}

function lockRow(over = {}) {
  return {
    id: LOCK_ID, user_id: KENNY.id, active: true, fill_american: 1188, max_contracts: 120,
    mve_collection: 'KXMVECROSSCATEGORY-R', combo_ticker: null, probe_hold_until: null,
    legs: [{ ticker: 'KXNFLGAME-26OCT11INDLV-IND', side: 'yes' }, { ticker: 'KXNFLTD-26OCT11INDLV-INDDJONES17-1', side: 'yes' }],
    ...over,
  };
}

(async () => {
  // ── pure helpers ──
  assert.equal(lib.isPolyLock({ combo_ticker: 'caoc-abc' }), true);
  assert.equal(lib.isPolyLock({ venue: 'polymarket' }), true);
  assert.equal(lib.isPolyLock(lockRow()), false);
  assert.equal(lib.lockProbeContracts({ max_contracts: 100 }, 30), 70);
  assert.equal(lib.lockProbeContracts({ max_contracts: 100 }, 150), 1);
  assert.equal(lib.lockProbeContracts({ max_contracts: 0 }), null);
  {
    const f = lib.excludeOwnQuotes([
      { id: 'a', creator_id: 'me-acct', no_bid_dollars: '0.95' },
      { id: 'b', creator_id: 'other', no_bid_dollars: '0.92' },
      { id: 'own-q', creator_id: 'x', no_bid_dollars: '0.94' },
    ], { creatorId: 'me-acct', ownQuoteIds: ['own-q'] });
    assert.deepEqual(f.quotes.map((q) => q.id), ['b']);
    assert.equal(f.excluded, 2);
  }
  assert.equal(lib.rfqCreatorId({ rfq: { creator_id: 'z' } }), 'z');

  // ── tester lock: tester's own Vault key, hold set then cleared, own quote excluded ──
  {
    const tables = {
      combo_parlays: [lockRow()],
      combo_fills: [{ parlay_id: LOCK_ID, count: 20, is_combo: true, is_taker: false }],
      combo_submissions: [{ parlay_id: LOCK_ID, quote_id: 'our-quote', created_at: new Date(2_000_000_000_000).toISOString() }],
    };
    const writes = [];
    const calls = [];
    let now = 2_000_000_000_000;
    let holdAtRfq = null;
    const loaded = [];
    handler._resetDeps();
    handler._setDeps({
      requireProbeUser: async () => ({ ok: true, user: KENNY, isOwner: false }),
      kalshiCreds: () => { throw new Error('tester must never use the server key'); },
      loadUserKalshiCreds: async (uid) => { loaded.push(uid); return { ok: true, keyId: 'kenny-key', pem }; },
      serviceClient: () => fakeDb(tables, writes),
      now: () => now,
      sleep: async (ms) => { now += ms; },
      fetchImpl: kalshiFake(calls, {
        holdSeen: () => { holdAtRfq = tables.combo_parlays[0].probe_hold_until; },
        quotes: [
          { id: 'our-quote', creator_id: 'kenny-acct', no_bid_dollars: '0.925', status: 'open' },
          { id: 'self', creator_id: 'me-acct', no_bid_dollars: '0.93', status: 'open' },
          { id: 'c1', creator_id: 'mm1', no_bid_dollars: '0.91', status: 'open' },
          { id: 'c2', creator_id: 'mm2', no_bid_dollars: '0.915', status: 'open' },
        ],
      }),
    });
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { parlay_id: LOCK_ID } }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    const b = res.out.body;
    assert.equal(b.lockProbe, true);
    assert.equal(b.credsSource, 'user-vault');
    assert.deepEqual(loaded, [KENNY.id]);
    assert.equal(b.bestNoBid, 0.915, 'own quotes (by id and by account) never count as competitors');
    assert.equal(b.ownQuotesExcluded, 2);
    assert.equal(b.contracts, 100, 'remaining cap');
    assert.equal(b.makerRate, 0);
    assert.ok(b.checkedAt);
    assert.ok(holdAtRfq, 'quotes are held before the RFQ goes out');
    assert.ok(Date.parse(holdAtRfq) - 2_000_000_000_000 <= 30000);
    assert.equal(tables.combo_parlays[0].probe_hold_until, null, 'hold cleared after');
    assert.ok(calls.some((c) => c.method === 'DELETE'), 'RFQ cancelled');
    assert.ok(calls.every((c) => !/accept|confirm/i.test(c.path)));
    // Rate limited per user.
    const again = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { parlay_id: LOCK_ID } }, again);
    assert.equal(again.out.statusCode, 429);
  }

  // ── Kevin's own lock: server key ──
  {
    const tables = { combo_parlays: [lockRow({ user_id: KEVIN.id })], combo_fills: [], combo_submissions: [] };
    let now = 3_000_000_000_000;
    handler._resetDeps();
    handler._setDeps({
      requireProbeUser: async () => ({ ok: true, user: KEVIN, isOwner: true }),
      kalshiCreds: () => ({ ok: true, keyId: 'server', pem }),
      loadUserKalshiCreds: async () => { throw new Error('Kevin uses the server key'); },
      serviceClient: () => fakeDb(tables, []),
      now: () => now, sleep: async (ms) => { now += ms; },
      fetchImpl: kalshiFake([], { quotes: [] }),
    });
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { parlay_id: LOCK_ID } }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.credsSource, 'owner-env');
    assert.equal(res.out.body.bestNoBid, null);
  }

  // ── Kevin checking a tester's lock: the TESTER's key, never Kevin's ──
  {
    const tables = { combo_parlays: [lockRow({ user_id: HIGGINS.id })], combo_fills: [], combo_submissions: [] };
    let now = 4_000_000_000_000;
    const loaded = [];
    handler._resetDeps();
    handler._setDeps({
      requireProbeUser: async () => ({ ok: true, user: KEVIN, isOwner: true }),
      kalshiCreds: () => { throw new Error('never Kevin key for a tester lock'); },
      loadUserKalshiCreds: async (uid) => { loaded.push(uid); return { ok: true, keyId: 'h', pem }; },
      serviceClient: () => fakeDb(tables, []),
      now: () => now, sleep: async (ms) => { now += ms; },
      fetchImpl: kalshiFake([], { quotes: [] }),
    });
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { parlay_id: LOCK_ID } }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.deepEqual(loaded, [HIGGINS.id]);
  }

  // ── someone else's lock: 403, nothing paused ──
  {
    const tables = { combo_parlays: [lockRow({ user_id: HIGGINS.id })] };
    handler._resetDeps();
    handler._setDeps({ requireProbeUser: async () => ({ ok: true, user: KENNY, isOwner: false }), serviceClient: () => fakeDb(tables, []) });
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { parlay_id: LOCK_ID } }, res);
    assert.equal(res.out.statusCode, 403);
    assert.equal(tables.combo_parlays[0].probe_hold_until, null);
  }

  // ── Polymarket lock: not available yet ──
  {
    const tables = { combo_parlays: [lockRow({ combo_ticker: 'caoc-xyz' })] };
    handler._resetDeps();
    handler._setDeps({ requireProbeUser: async () => ({ ok: true, user: KENNY, isOwner: false }), serviceClient: () => fakeDb(tables, []) });
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { parlay_id: LOCK_ID } }, res);
    assert.equal(res.out.statusCode, 400);
    assert.equal(res.out.body.error, lib.POLY_NOT_AVAILABLE_ERROR);
  }

  // ── Kalshi error mid-probe: hold still cleared ──
  {
    const tables = { combo_parlays: [lockRow()], combo_fills: [], combo_submissions: [] };
    let now = 5_000_000_000_000;
    handler._resetDeps();
    handler._setDeps({
      requireProbeUser: async () => ({ ok: true, user: KENNY, isOwner: false }),
      loadUserKalshiCreds: async () => ({ ok: true, keyId: 'k', pem }),
      serviceClient: () => fakeDb(tables, []),
      now: () => now, sleep: async (ms) => { now += ms; },
      fetchImpl: async (url, opts) => {
        const path = new URL(url).pathname;
        if ((opts.method || 'GET') === 'POST' && /multivariate_event_collections\//.test(path)) throw new Error('network down');
        return { status: 404, ok: false, text: async () => '{}' };
      },
    });
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { parlay_id: LOCK_ID } }, res);
    assert.equal(res.out.statusCode, 502);
    assert.equal(tables.combo_parlays[0].probe_hold_until, null, 'resume on error');
  }

  // ── tester without a key: Connect Kalshi, nothing paused ──
  {
    const tables = { combo_parlays: [lockRow()] };
    handler._resetDeps();
    handler._setDeps({
      requireProbeUser: async () => ({ ok: true, user: KENNY, isOwner: false }),
      loadUserKalshiCreds: async () => ({ ok: false, status: 400, error: lib.CONNECT_KALSHI_ERROR, needKalshiKey: true }),
      serviceClient: () => fakeDb(tables, []),
    });
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { parlay_id: LOCK_ID } }, res);
    assert.equal(res.out.statusCode, 400);
    assert.equal(res.out.body.needKalshiKey, true);
    assert.equal(tables.combo_parlays[0].probe_hold_until, null);
  }

  // ── hold column missing: clear message, no RFQ ──
  {
    const tables = { combo_parlays: [lockRow()], __failHold: "Could not find the 'probe_hold_until' column of 'combo_parlays'" };
    const calls = [];
    handler._resetDeps();
    handler._setDeps({
      requireProbeUser: async () => ({ ok: true, user: KENNY, isOwner: false }),
      loadUserKalshiCreds: async () => ({ ok: true, keyId: 'k', pem }),
      serviceClient: () => fakeDb(tables, []),
      fetchImpl: kalshiFake(calls, { quotes: [] }),
    });
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { parlay_id: LOCK_ID } }, res);
    assert.equal(res.out.statusCode, 503);
    assert.match(res.out.body.error, /database update/);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  }

  handler._resetDeps();
  console.log('combo-lock-probe.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
