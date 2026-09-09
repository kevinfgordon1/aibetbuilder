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
  assert.equal(best.quoteId, 'b');
  assert.equal(best.bestAmerican, lib.fillAmericanFromNoBid(0.92));
  assert.equal(best.suggestFillAmerican, lib.fillAmericanFromNoBid(0.93));
}

{
  const empty = lib.pickBestQuote([]);
  assert.equal(empty.bestNoBid, null);
  assert.equal(empty.bestAmerican, null);
  assert.equal(empty.quoteCount, 0);
}

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
assert.equal(lib.parseContracts(750), 750);
assert.equal(lib.parseContracts(0), null);
assert.equal(lib.parseContracts(-3), null);

// ── owner allowlist (same as Combo Locks UI) ──
assert.equal(lib.canSeeComboLocks({ email: 'kev120909@gmail.com' }, {}), true);
assert.equal(lib.canSeeComboLocks({ email: 'stranger@gmail.com' }, {}), false);
assert.equal(lib.canSeeComboLocks({ email: 'tester@gmail.com' }, { VITE_COMBO_LOCKS_ALLOWLIST: 'tester@gmail.com' }), true);
assert.equal(lib.canSeeComboLocks(null, {}), false);

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
  assert.equal(sign.signPathOf('https://api.elections.kalshi.com/trade-api/v2/communications/quotes?rfq_id=x'), '/trade-api/v2/communications/quotes');
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
  const vercel = require('../vercel.json');
  assert.equal(vercel.functions['api/combo-probe.js'].maxDuration, 20);
  assert.equal(handler.config.maxDuration, 20);
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
    assert.equal(res.out.body.bestAmerican, lib.fillAmericanFromNoBid(0.92));
    assert.equal(res.out.body.suggestFillAmerican, lib.fillAmericanFromNoBid(0.93));
    assert.equal(res.out.body.contracts, 750);
    assert.ok(res.out.body.waitedMs >= 4000);
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/rfqs/rfq-probe-1')));
    assert.ok(calls.every((c) => !/accept|confirm/i.test(c.path)));
    assert.ok(calls.every((c) => c.method === 'GET' || c.method === 'POST' || c.method === 'DELETE'));
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

  handler._resetDeps();
  console.log('combo-probe api tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
