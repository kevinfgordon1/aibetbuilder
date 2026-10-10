'use strict';

const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('crypto');
const lib = require('./combo-probe-lib');
const sign = require('./kalshi-sign');
const handler = require('./combo-probe.js');

// ── wait clamp ──
assert.equal(lib.clampWaitMs(undefined), 4000);
assert.equal(lib.clampWaitMs(4000), 4000);
assert.equal(lib.clampWaitMs(500), 2000);
assert.equal(lib.clampWaitMs(20000), 8000);
assert.equal(lib.clampWaitMs('3500'), 3500);

// ── American / NO conversion (same ComboLocks fill-after-fee convention) ──
assert.equal(lib.americanFromNoBid(0.92), 1150);
assert.equal(lib.americanFromProb(0.08), 1150);
assert.equal(lib.impliedYesFromNo(0.92), 0.08);

const fillFrom92 = lib.fillAmericanFromNoBid(0.92);
assert.ok(fillFrom92 > 1150, `after-fee American should be longer than raw +1150, got ${fillFrom92}`);
assert.equal(lib.fillAmericanFromNoBid(0.50), lib.americanFromProb(lib.fillProbFromNoBid(0.50)));

const tick = lib.tickBetterNoBid(0.92);
assert.equal(tick, 0.93);
assert.ok(lib.fillAmericanFromNoBid(tick) > fillFrom92);

// Inverse: fill field → no_bid (floor cents, ComboLocks fillView). Rounding
// after the maker-fee invert can land one cent below the source NO bid.
{
  const back = lib.noBidFromFillAmerican(fillFrom92);
  assert.ok(back <= 0.92 && back >= 0.90, `expected ~0.91–0.92, got ${back}`);
}

// ── pick best competing NO (highest > 0; ignore declined / cancelled) ──
{
  const best = lib.pickBestQuote([
    { id: 'a', no_bid_dollars: '0.88', yes_bid_dollars: '0.10', status: 'open' },
    { id: 'b', no_bid_dollars: '0.92', yes_bid_dollars: '0.07', status: 'open' },
    { id: 'c', no_bid: '0.00', yes_bid: '0.20', status: 'open' },
    { id: 'd', no_bid_dollars: '0.95', yes_bid_dollars: '0.04', status: 'cancelled' },
  ]);
  assert.equal(best.bestNoBid, 0.92);
  assert.equal(best.bestYesBid, 0.07);
  assert.equal(best.quoteCount, 4);
  assert.equal(best.usableQuoteCount, 2);
  assert.equal(best.quoteId, 'b');
  assert.equal(best.bestAmerican, lib.fillAmericanFromNoBid(0.92));
  assert.equal(best.suggestFillAmerican, lib.fillAmericanFromNoBid(0.93));
}

{
  const empty = lib.pickBestQuote([]);
  assert.equal(empty.bestNoBid, null);
  assert.equal(empty.bestAmerican, null);
  assert.equal(empty.quoteCount, 0);
  assert.equal(empty.usableQuoteCount, 0);
}

// Cents-style no_bid (88 = $0.88) must count as a usable maker quote.
{
  const cents = lib.pickBestQuote([
    { id: 'cents', no_bid: 88, yes_bid: 11, status: 'open' },
  ]);
  assert.equal(cents.bestNoBid, 0.88);
  assert.equal(cents.usableQuoteCount, 1);
  assert.equal(cents.quoteCount, 1);
}

{
  const declined = lib.pickBestQuote([
    { id: 'd1', no_bid_dollars: '0.00', yes_bid_dollars: '0.20', status: 'open' },
    { id: 'd2', no_bid: 0, yes_bid: 20, status: 'open' },
  ]);
  assert.equal(declined.bestNoBid, null);
  assert.equal(declined.quoteCount, 2);
  assert.equal(declined.usableQuoteCount, 0);
}

assert.equal(lib.parseBidPrice(88), 0.88);
assert.equal(lib.parseBidPrice('0.92'), 0.92);
assert.equal(lib.parseBidPrice(0), 0);
assert.match(lib.quotesListPath('rfq-1'), /rfq_id=rfq-1/);
assert.match(lib.quotesListPath('rfq-1'), /rfq_user_filter=self/);
assert.doesNotMatch(lib.quotesListPath('rfq-1'), /[?&]user_filter=/);

assert.equal(lib.fillBeatsMarket(1300, 1200), true);
assert.equal(lib.fillBeatsMarket(1200, 1200), false);

// ── legs / contracts / event ticker ──
assert.equal(lib.eventTickerFromMarket('KXNFLGAME-26SEP09NESEA-NE'), 'KXNFLGAME-26SEP09NESEA');
assert.equal(lib.eventTickerFromMarket('KXMLBTOTAL-26AUG071905PHIATL-9'), 'KXMLBTOTAL-26AUG071905PHIATL');

{
  const bad = lib.normalizeLegs([{ ticker: 'A', side: 'yes' }]);
  assert.equal(bad.ok, false);
}
{
  const ok = lib.normalizeLegs([
    { ticker: 'KXNFLGAME-26SEP09NESEA-NE', side: 'yes' },
    { ticker: 'KXNFLGAME-26SEP09NESEA-SEA', side: 'YES' },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.legs[0].event_ticker, 'KXNFLGAME-26SEP09NESEA');
  assert.equal(ok.legs[1].side, 'yes');
}

// ── upstream error text: show Kalshi message + details, not just the code ──
assert.equal(lib.kalshiErrorText({ error: { code: 'invalid_parameters', message: 'invalid parameters' } }), 'invalid parameters');
assert.equal(
  lib.kalshiErrorText({ error: { code: 'invalid_parameters', message: 'invalid parameters', details: 'market not in collection' } }),
  'invalid parameters: market not in collection',
);
assert.equal(lib.kalshiErrorText({ error: { code: 'rfq_too_big', message: 'contracts exceed max' } }), 'contracts exceed max (rfq_too_big)');
assert.equal(lib.kalshiErrorText({ error: { code: 'bad_thing' } }), 'bad_thing');
assert.equal(lib.kalshiErrorCode({ error: { code: 'invalid_parameters' } }), 'invalid_parameters');

// ── legs outside the combo collection (Kalshi 400 invalid_parameters) ──
{
  const events = lib.collectionEventTickers({ multivariate_contract: {
    associated_event_tickers: ['KXMLBGAME-26SEP251940COLCWS', 'KXMLBGAME-26SEP252140AZSD'],
    associated_events: [{ ticker: 'KXMLBGAME-26SEP271520BALNYY' }],
  } });
  assert.ok(events.has('KXMLBGAME-26SEP271520BALNYY'));
  const legs = lib.normalizeLegs([
    { ticker: 'KXMLBGAME-26SEP251940COLCWS-COL', side: 'yes', label: 'Colorado' },
    { ticker: 'KXMLBGAME-26SEP251905BALNYY-NYY', side: 'yes', label: 'New York Y' },
    { ticker: 'KXMLBGAME-26SEP252140AZSD-AZ', side: 'yes' },
  ]).legs;
  const bad = lib.legsOutsideCollection(legs, events);
  assert.deepEqual(bad.map((l) => l.ticker), ['KXMLBGAME-26SEP251905BALNYY-NYY']);
  assert.deepEqual(lib.legsOutsideCollection(legs, null), []);
  const msg = lib.outsideCollectionError(bad, 'KXMVESPORTSMULTIGAMEEXTENDED-R', 'invalid parameters');
  assert.match(msg, /New York Y \(KXMLBGAME-26SEP251905BALNYY-NYY\)/);
  assert.match(msg, /invalid parameters/);
  assert.match(msg, /not in Kalshi's combo collection/);
}
assert.equal(lib.parseContracts(750), 750);
assert.equal(lib.parseContracts(0), null);
assert.equal(lib.parseContracts(-3), null);

// ── Combo Locks visibility: hardcoded accounts (email AND uid), env ignored ──
assert.equal(lib.COMBO_LOCKS_ACCOUNTS.length, 5);
assert.equal(lib.canSeeComboLocks({ email: 'kev120909@gmail.com', id: '79ae1610-097e-4b46-a622-1e952f18e936' }, {}), true);
assert.equal(lib.canSeeComboLocks({ email: 'Kevin.F.Gordon1@gmail.com', id: '968efed8-54db-48a6-808b-194a7a03a4cb' }), true);
assert.equal(lib.canSeeComboLocks({ email: 'gmoneyvikes@gmail.com', id: 'dd23a3a8-cb45-4866-be11-df72b4767c26' }), true);
assert.equal(lib.canSeeComboLocks({ email: 'kev120909@gmail.com' }, {}), false, 'uid required');
assert.equal(lib.canSeeComboLocks({ email: 'kev120909@gmail.com', id: 'u-lookalike' }), false);
assert.equal(lib.canSeeComboLocks({ email: 'gmoneyvikes@gmail.com', id: '79ae1610-097e-4b46-a622-1e952f18e936' }), false, 'pairs do not mix');
assert.equal(lib.canSeeComboLocks({ email: 'kmguido97@gmail.com', id: '42b5ee16-68d5-4b3b-a931-40aa17cd1a47' }), true, 'Kenneth: Combo Locks (approved 2026-10-09)');
assert.equal(lib.canSeeComboLocks({ email: 'stranger@gmail.com', id: 'u2' }, {}), false);
assert.equal(lib.canSeeComboLocks({ email: 'tester@gmail.com', id: 't1' }, { VITE_COMBO_LOCKS_ALLOWLIST: 'tester@gmail.com', COMBO_LOCKS_ALLOWLIST: 'tester@gmail.com' }), false, 'env allowlist ignored');
assert.equal(lib.canSeeComboLocks(null, {}), false);
assert.equal(lib.comboLocksAllowlist({ VITE_COMBO_LOCKS_ALLOWLIST: 'x@y.com' }).has('x@y.com'), false);

// ── Owner check still Kevin-only; probe auth separately allows Combo Locks testers ──
const KEVIN_ID = '79ae1610-097e-4b46-a622-1e952f18e936';
assert.equal(lib.OWNER_USER_ID, KEVIN_ID);
assert.equal(lib.isComboOwner({ email: 'kev120909@gmail.com', id: KEVIN_ID }), true);
assert.equal(lib.isComboOwner({ email: ' KEV120909@gmail.com ', id: KEVIN_ID.toUpperCase() }), true);
assert.equal(lib.isComboOwner({ email: 'kev120909@gmail.com', id: '11111111-2222-4333-8444-555555555555' }), false);
assert.equal(lib.isComboOwner({ email: 'tester@gmail.com', id: KEVIN_ID }), false);
assert.equal(lib.isComboOwner({ id: KEVIN_ID }), false);
assert.equal(lib.isComboOwner(null), false);
{
  const allow = { VITE_COMBO_LOCKS_ALLOWLIST: 'tester@gmail.com', COMBO_LOCKS_ALLOWLIST: 'tester@gmail.com' };
  const tester = { email: 'gmoneyvikes@gmail.com', id: 'dd23a3a8-cb45-4866-be11-df72b4767c26' };
  assert.equal(lib.canSeeComboLocks(tester, allow), true);
  assert.equal(lib.isComboOwner(tester), false);
  assert.equal(lib.isComboOwner({ email: 'kevin.f.gordon1@gmail.com', id: '968efed8-54db-48a6-808b-194a7a03a4cb' }), false);
}
{
  const src = require('fs').readFileSync(require('path').join(__dirname, 'combo-probe.js'), 'utf8');
  assert.ok(/lib\.isComboOwner\(user\)/.test(src), 'combo-probe still has isComboOwner');
  assert.ok(/canSeeComboLocks/.test(src), 'combo-probe allows Combo Locks testers via canSeeComboLocks');
  assert.ok(/loadUserKalshiCreds/.test(src), 'tester path loads user vault key');
  assert.ok(/combo_exchange_key_get/.test(src), 'tester key via combo_exchange_key_get');
  assert.ok(/pickCollection|COMBO_COLLECTION_CANDIDATES/.test(src), 'probe picks collection like owner path');
  assert.ok(/makerRateForMarket/.test(src), 'probe prices with series maker fee');
  const bucket = require('fs').readFileSync(require('path').join(__dirname, 'combo-bucket.js'), 'utf8');
  assert.ok(/lib\.isComboOwner\(user\)/.test(bucket), 'combo-bucket uses the same owner check');
}

// ── signer: PEM normalize + RSA-PSS round-trip ──
{
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const headers = sign.authHeaders({
    keyId: 'key-1',
    pem,
    method: 'POST',
    signPath: '/trade-api/v2/communications/rfqs',
    ts: 1700000000000,
  });
  assert.equal(headers['KALSHI-ACCESS-KEY'], 'key-1');
  assert.equal(headers['KALSHI-ACCESS-TIMESTAMP'], '1700000000000');
  const crypto = require('crypto');
  const msg = Buffer.from('1700000000000POST/trade-api/v2/communications/rfqs');
  const ok = crypto.verify(
    'sha256',
    msg,
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
    Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'], 'base64'),
  );
  assert.equal(ok, true);
  assert.ok(sign.normalizePem(pem.replace(/-----BEGIN[\s\S]+?-----\n/, '').replace(/\n-----END[\s\S]+/, '')).includes('BEGIN RSA PRIVATE KEY'));
  assert.equal(sign.signPathOf('https://api.elections.kalshi.com/trade-api/v2/communications/quotes?rfq_id=x&rfq_user_filter=self'), '/trade-api/v2/communications/quotes');
  assert.equal(sign.isForbiddenKalshiPath('/trade-api/v2/communications/quotes/abc/accept'), true);
  assert.equal(sign.isForbiddenKalshiPath('/trade-api/v2/communications/rfqs'), false);
}

{
  const creds = sign.readKalshiCreds({ KALSHI_KEY_ID: '', Kalshi_combo_key: '' });
  assert.equal(creds.ok, false);
  assert.ok(creds.missing.includes('KALSHI_KEY_ID'));
}

// signedFetch must refuse accept/confirm — asserted again in the async suite.

function mockRes() {
  const out = { statusCode: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(code) { out.statusCode = code; return this; },
    json(body) { out.body = body; return this; },
    end() { return this; },
  };
}

function src() {
  return require('node:fs').readFileSync(require('node:path').join(__dirname, 'combo-probe.js'), 'utf8');
}

{
  const text = src();
  assert.match(text, /DELETE/);
  assert.doesNotMatch(text, /\/accept|\/confirm/);
  assert.match(text, /rest_remainder:\s*false/);
  assert.match(text, /never accept/i);
  assert.match(text, /quotesListPath|rfq_user_filter=self/);
  const vercel = require('../vercel.json');
  assert.equal(vercel.functions['api/combo-probe.js'].maxDuration, 30);
  assert.equal(handler.config.maxDuration, 30);
}

(async () => {
  const probeKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    .export({ type: 'pkcs1', format: 'pem' });
  const probeCreds = () => ({ ok: true, keyId: 'k', pem: probeKey, missing: [] });

  await assert.rejects(
    () => sign.signedFetch('https://api.elections.kalshi.com/trade-api/v2/communications/quotes/q1/accept', {
      method: 'PUT',
      keyId: 'k',
      pem: 'x',
      fetchImpl: async () => { throw new Error('should not fetch'); },
    }),
    /never accepts or confirms/,
  );

  handler._resetDeps();

  {
    const res = mockRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.out.statusCode, 405);
  }

  // Real requireComboOwner with a mocked Supabase getUser: allowlisted tester => 403.
  {
    const saved = { ...process.env };
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.COMBO_LOCKS_ALLOWLIST = 'tester@gmail.com';
    const fake = (user) => () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } });
    const tester = { email: 'tester@gmail.com', id: '42b5ee16-68d5-4b3b-a931-40aa17cd1a47' };
    const req = { headers: { authorization: 'Bearer tok' } };
    assert.equal((await handler._requireComboOwner({ headers: {} }, fake(tester))).status, 401);
    assert.equal((await handler._requireComboOwner(req, fake(tester))).status, 403, 'owner gate still refuses tester');
    assert.equal((await handler._requireComboOwner(req, fake({ email: 'kev120909@gmail.com', id: '79ae1610-097e-4b46-a622-1e952f18e936' }))).ok, true);
    assert.equal((await handler._requireComboOwner(req, fake(null))).status, 401);
    // Probe auth: allowlisted tester OK; stranger still 403.
    const kenny = { email: 'kmguido97@gmail.com', id: '42b5ee16-68d5-4b3b-a931-40aa17cd1a47' };
    assert.equal((await handler._requireProbeUser(req, fake(kenny))).ok, true);
    assert.equal((await handler._requireProbeUser(req, fake(kenny))).isOwner, false);
    assert.equal((await handler._requireProbeUser(req, fake({ email: 'stranger@x.com', id: 'x' }))).status, 403);
    assert.equal((await handler._requireProbeUser(req, fake({ email: 'kev120909@gmail.com', id: '79ae1610-097e-4b46-a622-1e952f18e936' }))).isOwner, true);
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'COMBO_LOCKS_ALLOWLIST']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }

  handler._setDeps({
    requireOwner: async () => ({ ok: false, status: 401, error: 'Sign in required' }),
  });
  {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    assert.equal(res.out.statusCode, 401);
    assert.equal(res.out.body.ok, false);
  }

  handler._setDeps({
    requireOwner: async () => ({ ok: false, status: 403, error: 'Not allowed' }),
    kalshiCreds: probeCreds,
  });
  {
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer tok' }, body: { legs: [], contracts: 10 } }, res);
    assert.equal(res.out.statusCode, 403);
  }

  handler._setDeps({
    requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
    kalshiCreds: () => ({ ok: false, keyId: '', pem: '', missing: ['KALSHI_KEY_ID', 'Kalshi_combo_key'] }),
  });
  {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { legs: [{ ticker: 'A-1', side: 'yes' }, { ticker: 'B-1', side: 'yes' }], contracts: 10 },
    }, res);
    assert.equal(res.out.statusCode, 503);
    assert.match(res.out.body.error, /KALSHI_KEY_ID/);
    assert.match(res.out.body.error, /Railway combo-worker/);
  }

  // Happy path: create market → create RFQ → poll quotes → DELETE. Never accept.
  const calls = [];
  let fakeNow = 1_000_000;
  handler._setDeps({
    requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
    kalshiCreds: probeCreds,
    now: () => fakeNow,
    sleep: async (ms) => { fakeNow += ms; },
    fetchImpl: async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const path = new URL(url).pathname;
      calls.push({ method, path, url });
      if (/\/accept|\/confirm/i.test(path)) throw new Error('MUST NOT accept/confirm');
      const json = (status, body) => ({
        status,
        ok: status >= 200 && status < 300,
        text: async () => JSON.stringify(body),
        clone() { return this; },
      });
      if (method === 'POST' && path.includes('/multivariate_event_collections/')) {
        return json(200, { market_ticker: 'KXMV-COMBO-1', event_ticker: 'KXMV-COMBO' });
      }
      if (method === 'POST' && path.endsWith('/communications/rfqs')) {
        const body = JSON.parse(opts.body);
        assert.equal(body.rest_remainder, false);
        assert.equal(body.contracts, 750);
        return json(201, { id: 'rfq-probe-1' });
      }
      if (method === 'GET' && path.endsWith('/communications/quotes')) {
        assert.match(url, /rfq_id=rfq-probe-1/);
        assert.match(url, /rfq_user_filter=self/);
        return json(200, {
          quotes: [
            { id: 'q1', no_bid_dollars: '0.90', yes_bid_dollars: '0.09', status: 'open' },
            { id: 'q2', no_bid_dollars: '0.92', yes_bid_dollars: '0.07', status: 'open' },
          ],
        });
      }
      if (method === 'DELETE' && path.endsWith('/communications/rfqs/rfq-probe-1')) {
        return json(204, null);
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  });

  {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: {
        legs: [
          { ticker: 'KXNFLGAME-26SEP09NESEA-NE', side: 'yes' },
          { ticker: 'KXNFLGAME-26SEP09NESEA-SEA', side: 'no' },
        ],
        contracts: 750,
        waitMs: 4000,
      },
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.ok, true);
    assert.equal(res.out.body.rfqId, 'rfq-probe-1');
    assert.equal(res.out.body.marketTicker, 'KXMV-COMBO-1');
    assert.equal(res.out.body.bestNoBid, 0.92);
    assert.equal(res.out.body.bestYesBid, 0.07);
    assert.equal(res.out.body.quoteCount, 2);
    assert.equal(res.out.body.usableQuoteCount, 2);
    // Series lookup unavailable → conservative 0.035 maker rate (same as the worker).
    assert.equal(res.out.body.makerRate, lib.FALLBACK_MAKER_RATE);
    assert.equal(res.out.body.bestAmerican, lib.fillAmericanFromNoBid(0.92, lib.FALLBACK_MAKER_RATE));
    assert.equal(res.out.body.suggestFillAmerican, lib.fillAmericanFromNoBid(0.93, lib.FALLBACK_MAKER_RATE));
    assert.equal(res.out.body.contracts, 750);
    assert.ok(res.out.body.waitedMs < 4000, 'usable quote should early-exit');
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/rfqs/rfq-probe-1')));
    assert.ok(calls.every((c) => !/accept|confirm/i.test(c.path)));
    assert.ok(calls.every((c) => c.method === 'GET' || c.method === 'POST' || c.method === 'DELETE'));
  }

  // Empty book: wait the full window (no early-exit).
  fakeNow = 1_500_000;
  const emptyCalls = [];
  handler._setDeps({
    requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
    kalshiCreds: probeCreds,
    now: () => fakeNow,
    sleep: async (ms) => { fakeNow += ms; },
    fetchImpl: async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const path = new URL(url).pathname;
      emptyCalls.push({ method, path, url });
      const json = (status, body) => ({
        status,
        ok: status >= 200 && status < 300,
        text: async () => (body == null ? '' : JSON.stringify(body)),
        clone() { return this; },
      });
      if (method === 'POST' && path.includes('multivariate')) return json(200, { market_ticker: 'M-empty' });
      if (method === 'POST' && path.endsWith('/rfqs')) return json(201, { id: 'rfq-empty' });
      if (method === 'GET' && path.endsWith('/communications/quotes')) {
        assert.match(url, /rfq_user_filter=self/);
        return json(200, { quotes: [] });
      }
      if (method === 'DELETE') return json(204, null);
      throw new Error(`unexpected ${method} ${path}`);
    },
  });
  {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: {
        legs: [{ ticker: 'A-1', side: 'yes' }, { ticker: 'B-1', side: 'yes' }],
        contracts: 10,
        waitMs: 2000,
      },
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.ok, true);
    assert.equal(res.out.body.quoteCount, 0);
    assert.equal(res.out.body.usableQuoteCount, 0);
    assert.equal(res.out.body.bestAmerican, null);
    assert.equal(res.out.body.rfqId, 'rfq-empty');
    assert.ok(res.out.body.waitedMs >= 2000);
    assert.ok(emptyCalls.filter((c) => c.method === 'GET').length >= 2);
  }

  // DELETE still runs if listing quotes throws
  fakeNow = 2_000_000;
  const calls2 = [];
  handler._setDeps({
    requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
    kalshiCreds: probeCreds,
    now: () => fakeNow,
    sleep: async (ms) => { fakeNow += ms; },
    fetchImpl: async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const path = new URL(url).pathname;
      calls2.push({ method, path });
      const json = (status, body) => ({
        status,
        ok: status >= 200 && status < 300,
        text: async () => (body == null ? '' : JSON.stringify(body)),
        clone() { return this; },
      });
      if (method === 'POST' && path.includes('multivariate')) return json(200, { market_ticker: 'M-1' });
      if (method === 'POST' && path.endsWith('/rfqs')) return json(201, { id: 'rfq-x' });
      if (method === 'GET') throw new Error('quotes down');
      if (method === 'DELETE') return json(204, null);
      throw new Error(`unexpected ${method} ${path}`);
    },
  });
  {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: {
        legs: [{ ticker: 'A-1', side: 'yes' }, { ticker: 'B-1', side: 'yes' }],
        contracts: 10,
        waitMs: 2000,
      },
    }, res);
    assert.ok(calls2.some((c) => c.method === 'DELETE'));
    assert.equal(res.out.statusCode, 502);
  }

  // Leg not in the combo collection: Kalshi 400 invalid_parameters → name the leg, no RFQ.
  const callsBad = [];
  handler._setDeps({
    requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
    kalshiCreds: probeCreds,
    fetchImpl: async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const path = new URL(url).pathname;
      callsBad.push({ method, path });
      const json = (status, body) => ({
        status,
        ok: status >= 200 && status < 300,
        text: async () => JSON.stringify(body),
        clone() { return this; },
      });
      if (method === 'POST' && path.includes('/multivariate_event_collections/')) {
        return json(400, { error: { code: 'invalid_parameters', message: 'invalid parameters' } });
      }
      if (method === 'GET' && path.includes('/multivariate_event_collections/')) {
        return json(200, { multivariate_contract: {
          associated_event_tickers: ['KXMLBGAME-26SEP251940COLCWS', 'KXMLBGAME-26SEP252140AZSD'],
        } });
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  });
  {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: {
        legs: [
          { ticker: 'KXMLBGAME-26SEP251940COLCWS-COL', side: 'yes', label: 'Colorado' },
          { ticker: 'KXMLBGAME-26SEP251905BALNYY-NYY', side: 'yes', label: 'New York Y' },
          { ticker: 'KXMLBGAME-26SEP252140AZSD-AZ', side: 'yes', label: 'Arizona' },
        ],
        contracts: 9835,
      },
    }, res);
    assert.equal(res.out.statusCode, 400);
    assert.equal(res.out.body.ok, false);
    assert.match(res.out.body.error, /New York Y \(KXMLBGAME-26SEP251905BALNYY-NYY\) isn't in any Kalshi combo collection/);
    assert.match(res.out.body.error, /KXMVESPORTSMULTIGAMEEXTENDED-R, KXMVECROSSCATEGORY-R/);
    assert.match(res.out.body.error, /Try swapping/);
    assert.ok(callsBad.every((c) => c.method !== 'POST'), 'caught before creating the combo market');
    assert.deepEqual(res.out.body.outsideCollection, ['KXMLBGAME-26SEP251905BALNYY-NYY']);
    assert.ok(callsBad.every((c) => !c.path.endsWith('/communications/rfqs')), 'no RFQ on a rejected combo');
  }

  // Collection lookup fails → still surface the real upstream message.
  handler._setDeps({
    fetchImpl: async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const json = (status, body) => ({ status, ok: false, text: async () => JSON.stringify(body), clone() { return this; } });
      if (method === 'POST') return json(400, { error: { code: 'invalid_parameters', message: 'invalid parameters', details: 'bad leg' } });
      throw new Error('collection down');
    },
  });
  {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { legs: [{ ticker: 'A-1', side: 'yes' }, { ticker: 'B-1', side: 'yes' }], contracts: 10 },
    }, res);
    assert.equal(res.out.statusCode, 400);
    assert.match(res.out.body.error, /Kalshi rejected the combo market: invalid parameters: bad leg/);
  }

  // Player-prop TD legs (Kevin 2026-10-10): 4-part market tickers. The event is KXNFLTD-26OCT11INDPIT,
  // not ...-INDDJONES17; resolve it from the collection, send the right event_ticker, and price with
  // the series' real maker fee (quadratic → 0).
  {
    handler._resetDeps();
    const posted = [];
    let fakeNow2 = 5_000_000;
    handler._setDeps({
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      kalshiCreds: probeCreds,
      now: () => fakeNow2,
      sleep: async (ms) => { fakeNow2 += ms; },
      fetchImpl: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const path = new URL(url).pathname;
        const json = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body), clone() { return this; } });
        if (method === 'GET' && path.endsWith('/multivariate_event_collections/KXMVESPORTSMULTIGAMEEXTENDED-R')) {
          return json(200, { multivariate_contract: { associated_events: [
            { ticker: 'KXNFLTD-26OCT11INDPIT' }, { ticker: 'KXNFLTD-26OCT11PHIJAC' }, { ticker: 'KXNFLTEAMFIRSTTD-26OCT11PHIJAC-JAC' },
          ] } });
        }
        if (method === 'POST' && path.includes('/multivariate_event_collections/')) {
          posted.push({ path, body: JSON.parse(opts.body) });
          const evs = JSON.parse(opts.body).selected_markets.map((m) => m.event_ticker);
          if (evs.some((e) => /JONES|SHIPLEY/.test(e))) return json(400, { error: { code: 'invalid_parameters', message: 'invalid parameters' } });
          return json(200, { market_ticker: 'KXMVESPORTSMULTIGAMEEXTENDED-S2026TD-1' });
        }
        if (method === 'GET' && path.endsWith('/series/KXMVESPORTSMULTIGAMEEXTENDED')) {
          return json(200, { series: { fee_type: 'quadratic', fee_multiplier: 1 } });
        }
        if (method === 'POST' && path.endsWith('/communications/rfqs')) return json(201, { id: 'rfq-td' });
        if (method === 'GET' && path.endsWith('/communications/quotes')) {
          return json(200, { quotes: [{ id: 'q', no_bid_dollars: '0.922', yes_bid_dollars: '0.07', status: 'open' }] });
        }
        if (method === 'DELETE') return json(204, null);
        throw new Error(`unexpected ${method} ${path}`);
      },
    });
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: {
        legs: [
          { ticker: 'KXNFLTD-26OCT11INDPIT-INDDJONES17-1', side: 'yes', label: 'Daniel Jones 1+ TD' },
          { ticker: 'KXNFLTD-26OCT11PHIJAC-PHIWSHIPLEY28-1', side: 'yes', label: 'Will Shipley 1+ TD' },
        ],
        contracts: 100,
        collection: 'KXMVESPORTSMULTIGAMEEXTENDED-R',
      },
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.collection, 'KXMVESPORTSMULTIGAMEEXTENDED-R');
    assert.deepEqual(posted[0].body.selected_markets.map((m) => m.event_ticker), ['KXNFLTD-26OCT11INDPIT', 'KXNFLTD-26OCT11PHIJAC']);
    assert.equal(res.out.body.makerRate, 0);
    assert.equal(res.out.body.bestAmerican, lib.fillAmericanFromNoBid(0.922, 0));
    assert.equal(lib.fillAmericanFromNoBid(0.922, 0), lib.americanFromProb(1 - 0.922));
  }

  // Leg missing from the requested collection but present in KXMVECROSSCATEGORY-R → use that one.
  {
    handler._resetDeps(); // clear per-user probe cooldown from the prior success
    const posted = [];
    handler._setDeps({
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      kalshiCreds: probeCreds,
      fetchImpl: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const path = new URL(url).pathname;
        const json = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body), clone() { return this; } });
        if (method === 'GET' && path.endsWith('/KXMVESPORTSMULTIGAMEEXTENDED-R')) return json(200, { associated_event_tickers: ['KXNFLTD-26OCT11INDPIT'] });
        if (method === 'GET' && path.endsWith('/KXMVECROSSCATEGORY-R')) return json(200, { associated_event_tickers: ['KXNFLTD-26OCT11INDPIT', 'KXNFLTD-26OCT11PHIJAC'] });
        if (method === 'POST' && path.includes('/multivariate_event_collections/')) { posted.push(path); return json(400, { error: { code: 'x', message: 'stop here' } }); }
        throw new Error(`unexpected ${method} ${path}`);
      },
    });
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer tok' }, body: {
      legs: [{ ticker: 'KXNFLTD-26OCT11INDPIT-INDDJONES17-1', side: 'yes' }, { ticker: 'KXNFLTD-26OCT11PHIJAC-PHIWSHIPLEY28-1', side: 'yes' }],
      contracts: 10 } }, res);
    assert.deepEqual(posted, ['/trade-api/v2/multivariate_event_collections/KXMVECROSSCATEGORY-R']);
    assert.equal(res.out.body.collection, 'KXMVECROSSCATEGORY-R');
  }

  assert.equal(lib.eventTickerFromMarket('KXNFLTD-26OCT11INDPIT-INDDJONES17-1'), 'KXNFLTD-26OCT11INDPIT');
  assert.equal(lib.resolveEventTicker('KXNFLTEAMFIRSTTD-26OCT11PHIJAC-JAC-JAC', new Set(['KXNFLTEAMFIRSTTD-26OCT11PHIJAC-JAC'])), 'KXNFLTEAMFIRSTTD-26OCT11PHIJAC-JAC');
  assert.equal(lib.makerRateFromSeries('quadratic_with_combo_maker_fees', 1), 0.035);
  assert.equal(lib.noBidFromFillAmerican(1104, 0) != null, true);


  // ── Tester probe uses THEIR key, never Kevin's env key (same collection + fee path) ──
  {
    handler._resetDeps();
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
    const KENNY = { email: 'kmguido97@gmail.com', id: '42b5ee16-68d5-4b3b-a931-40aa17cd1a47' };
    const TESTER_KEY = 'tester-kalshi-key-id-abc';
    const KEVIN_ENV_KEY = 'KEVIN-ENV-KEY-MUST-NOT-APPEAR';
    const calls = [];
    let fakeNow = 3_000_000;
    let loadHits = 0;
    let envCredHits = 0;
    handler._setDeps({
      requireProbeUser: async () => ({ ok: true, user: KENNY, isOwner: false }),
      kalshiCreds: () => {
        envCredHits += 1;
        return { ok: true, keyId: KEVIN_ENV_KEY, pem };
      },
      loadUserKalshiCreds: async (userId) => {
        loadHits += 1;
        assert.equal(String(userId), KENNY.id);
        return { ok: true, keyId: TESTER_KEY, pem };
      },
      now: () => fakeNow,
      sleep: async (ms) => { fakeNow += ms; },
      fetchImpl: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const path = new URL(url).pathname;
        const headers = (opts && opts.headers) || {};
        const keyHeader = headers['KALSHI-ACCESS-KEY'] || headers['kalshi-access-key'] || '';
        calls.push({ method, path, keyHeader });
        if (/\/accept|\/confirm/i.test(path)) throw new Error('MUST NOT accept/confirm');
        const json = (status, body) => ({
          status,
          ok: status >= 200 && status < 300,
          text: async () => JSON.stringify(body),
          clone() { return this; },
        });
        // Collection lookup (unsigned) + series fee — same as owner probe.
        if (method === 'GET' && path.includes('/multivariate_event_collections/')) {
          return json(200, { multivariate_contract: { associated_events: [{ ticker: 'A' }, { ticker: 'B' }] } });
        }
        if (method === 'GET' && path.includes('/series/')) {
          return json(200, { series: { fee_type: 'quadratic_with_maker_fees', fee_multiplier: 1 } });
        }
        if (method === 'POST' && path.includes('/multivariate_event_collections/')) {
          return json(200, { market_ticker: 'KXMVESPORTSMULTIGAMEEXTENDED-S-TEST', event_ticker: 'KXMV-COMBO' });
        }
        if (method === 'POST' && path.endsWith('/communications/rfqs')) {
          return json(201, { id: 'rfq-tester-1' });
        }
        if (method === 'GET' && path.endsWith('/communications/quotes')) {
          return json(200, { quotes: [{ id: 'q1', no_bid_dollars: '0.90', yes_bid_dollars: '0.09', status: 'open' }] });
        }
        if (method === 'DELETE' && path.includes('/communications/rfqs/')) {
          return json(204, {});
        }
        return json(404, { error: 'unexpected ' + method + ' ' + path });
      },
    });
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { legs: [{ ticker: 'A-1', side: 'yes' }, { ticker: 'B-1', side: 'yes' }], contracts: 100, waitMs: 2000 },
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.ok, true);
    assert.equal(res.out.body.credsSource, 'user-vault');
    assert.ok(res.out.body.collection, 'tester probe returns collection');
    assert.ok(typeof res.out.body.makerRate === 'number', 'tester probe returns makerRate');
    assert.equal(loadHits, 1, 'tester key loaded once');
    assert.equal(envCredHits, 0, 'Kevin env kalshiCreds must never be called for a tester');
    const signed = calls.filter((c) => c.keyHeader);
    assert.ok(signed.length >= 3, 'kalshi signed calls happened');
    for (const c of signed) {
      assert.equal(c.keyHeader, TESTER_KEY, 'every Kalshi call must use tester key, got ' + c.keyHeader + ' on ' + c.method + ' ' + c.path);
      assert.notEqual(c.keyHeader, KEVIN_ENV_KEY);
    }
  }

  // Tester with no key → Connect Kalshi copy; never touches Kevin env key
  {
    handler._resetDeps();
    let envCredHits = 0;
    handler._setDeps({
      requireProbeUser: async () => ({ ok: true, user: { email: 'kmguido97@gmail.com', id: '42b5ee16-68d5-4b3b-a931-40aa17cd1a47' }, isOwner: false }),
      kalshiCreds: () => { envCredHits += 1; return { ok: true, keyId: 'KEVIN', pem: 'x' }; },
      loadUserKalshiCreds: async () => ({ ok: false, status: 400, error: lib.CONNECT_KALSHI_ERROR, needKalshiKey: true, missingKey: true }),
    });
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { legs: [{ ticker: 'A-1', side: 'yes' }, { ticker: 'B-1', side: 'yes' }], contracts: 10 },
    }, res);
    assert.equal(res.out.statusCode, 400);
    assert.match(res.out.body.error, /Connect Kalshi to check price/);
    assert.equal(res.out.body.needKalshiKey, true);
    assert.equal(envCredHits, 0);
  }

  // Rate limit per user
  {
    handler._resetDeps();
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
    let fakeNow = 5_000_000;
    const limiter = lib.createProbeRateLimiter(30_000);
    handler._setDeps({
      requireProbeUser: async () => ({ ok: true, user: { email: 'kmguido97@gmail.com', id: '42b5ee16-68d5-4b3b-a931-40aa17cd1a47' }, isOwner: false }),
      loadUserKalshiCreds: async () => ({ ok: true, keyId: 't-key', pem }),
      kalshiCreds: () => ({ ok: true, keyId: 'KEVIN', pem }),
      rateLimiter: limiter,
      now: () => fakeNow,
      sleep: async (ms) => { fakeNow += ms; },
      fetchImpl: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const path = new URL(url).pathname;
        const json = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body), clone() { return this; } });
        if (method === 'GET' && path.includes('/multivariate_event_collections/')) {
          return json(200, { multivariate_contract: { associated_events: [{ ticker: 'A' }, { ticker: 'B' }] } });
        }
        if (method === 'GET' && path.includes('/series/')) return json(200, { series: { fee_type: 'quadratic', fee_multiplier: 1 } });
        if (method === 'POST' && path.includes('/multivariate_event_collections/')) return json(200, { market_ticker: 'M1' });
        if (method === 'POST' && path.endsWith('/communications/rfqs')) return json(201, { id: 'r1' });
        if (method === 'GET' && path.endsWith('/communications/quotes')) return json(200, { quotes: [] });
        if (method === 'DELETE') return json(204, {});
        return json(404, {});
      },
    });
    const body = { legs: [{ ticker: 'A-1', side: 'yes' }, { ticker: 'B-1', side: 'yes' }], contracts: 10, waitMs: 2000 };
    const r1 = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, r1);
    assert.equal(r1.out.statusCode, 200, JSON.stringify(r1.out.body));
    const r2 = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, r2);
    assert.equal(r2.out.statusCode, 429);
    assert.match(r2.out.body.error, /Slow down/);
    fakeNow += 31_000;
    const r3 = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, r3);
    assert.equal(r3.out.statusCode, 200);
  }

  // Owner path still uses env key (credsSource owner-env)
  {
    handler._resetDeps();
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
    let loadHits = 0;
    const calls = [];
    let fakeNowOwner = 9_000_000;
    handler._setDeps({
      requireProbeUser: async () => ({ ok: true, user: { email: 'kev120909@gmail.com', id: '79ae1610-097e-4b46-a622-1e952f18e936' }, isOwner: true }),
      kalshiCreds: () => ({ ok: true, keyId: 'OWNER-ENV-KEY', pem }),
      loadUserKalshiCreds: async () => { loadHits += 1; return { ok: true, keyId: 'SHOULD-NOT', pem }; },
      now: () => fakeNowOwner,
      sleep: async (ms) => { fakeNowOwner += ms; },
      fetchImpl: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const path = new URL(url).pathname;
        const headers = (opts && opts.headers) || {};
        const keyHeader = headers['KALSHI-ACCESS-KEY'] || '';
        if (keyHeader) calls.push(keyHeader);
        const json = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body), clone() { return this; } });
        if (method === 'GET' && path.includes('/multivariate_event_collections/')) {
          return json(200, { multivariate_contract: { associated_events: [{ ticker: 'A' }, { ticker: 'B' }] } });
        }
        if (method === 'GET' && path.includes('/series/')) return json(200, { series: { fee_type: 'quadratic', fee_multiplier: 1 } });
        if (method === 'POST' && path.includes('/multivariate_event_collections/')) return json(200, { market_ticker: 'M1' });
        if (method === 'POST' && path.endsWith('/communications/rfqs')) return json(201, { id: 'r1' });
        if (method === 'GET' && path.endsWith('/communications/quotes')) return json(200, { quotes: [] });
        if (method === 'DELETE') return json(204, {});
        return json(404, {});
      },
    });
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { legs: [{ ticker: 'A-1', side: 'yes' }, { ticker: 'B-1', side: 'yes' }], contracts: 10, waitMs: 2000 },
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.credsSource, 'owner-env');
    assert.equal(loadHits, 0, 'owner must not load vault user key');
    assert.ok(calls.every((k) => k === 'OWNER-ENV-KEY'));
  }

  handler._resetDeps();
  console.log('combo-probe api tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// c.w.higgins1 tester (Kevin approved 2026-10-09)
assert.equal(lib.canSeeComboLocks({ email: 'c.w.higgins1@gmail.com', id: '721c1166-be0b-4856-8a88-6de3a8b047b9' }), true);
assert.equal(lib.canSeeComboLocks({ email: 'c.w.higgins1@gmail.com', id: 'dd23a3a8-cb45-4866-be11-df72b4767c26' }), false);
