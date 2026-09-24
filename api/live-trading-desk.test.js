'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('./polymarket-us-auth');
const { createPolymarketUsClient } = require('./polymarket-us-client');
const handler = require('./live-trading-desk');
const access = require('../src/comboAccess.js');

assert.equal(access.canSeeOwnerTools({ email: 'kev120909@gmail.com' }), true);
assert.equal(access.canSeeOwnerTools({ email: 'kmguido97@gmail.com' }), false);
assert.equal(access.canSeeOwnerTools({ email: 'tester@gmail.com' }), false);

{
  const text = fs.readFileSync(path.join(__dirname, 'live-trading-desk.js'), 'utf8');
  assert.match(text, /canSeeOwnerTools\(user\)/);
  assert.doesNotMatch(text, /canSeeComboLocks/);
  assert.doesNotMatch(text, /clob\.polymarket\.com/);
  assert.doesNotMatch(text, /telegram/i);
  const vercel = require('../vercel.json');
  assert.equal(vercel.functions['api/live-trading-desk.js'].maxDuration, 15);
}

{
  const seed = crypto.randomBytes(32);
  const secret = seed.toString('base64');
  const headers = auth.authHeaders({
    keyId: '550e8400-e29b-41d4-a716-446655440000',
    secretKey: secret,
    method: 'POST',
    path: '/v1/orders?ignored=1',
    ts: 1700000000000,
  });
  assert.equal(headers['X-PM-Access-Key'], '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(headers['X-PM-Timestamp'], '1700000000000');
  const key = auth.privateKeyFromSecret(secret);
  const ok = crypto.verify(
    null,
    Buffer.from('1700000000000POST/v1/orders'),
    key,
    Buffer.from(headers['X-PM-Signature'], 'base64'),
  );
  assert.equal(ok, true, 'signature is pathname only');
  const withQuery = auth.sign(secret, 1700000000000, 'POST', '/v1/orders?ignored=1', { includeQuery: true });
  assert.notEqual(withQuery, headers['X-PM-Signature']);
}

{
  const creds = auth.readPolymarketCreds({ POLYMARKET_KEY_ID: '', POLYMARKET_SECRET_KEY: '' });
  assert.equal(creds.ok, false);
  assert.ok(creds.missing.includes('POLYMARKET_KEY_ID'));
  assert.ok(creds.missing.includes('POLYMARKET_SECRET_KEY'));
  assert.match(auth.missingKeysError(creds.missing).error, /Vercel/);
  assert.match(auth.missingKeysError(creds.missing).error, /CLOB/);
}

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

function jsonRes(status, body) {
  const text = body == null ? '' : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}

const MARKET = {
  slug: 'aec-nfl-lac-ten-2025-11-02',
  question: 'Los Angeles vs. Tennessee',
  active: true,
  closed: false,
  orderPriceMinTickSize: 0.005,
  minimumTradeQty: 1,
  outcomes: '["Titans","Chargers"]',
  marketSides: [
    { long: true, description: 'Chargers', team: { name: 'Los Angeles Chargers' } },
    { long: false, description: 'Titans', team: { name: 'Tennessee Titans' } },
  ],
};

const seed = crypto.randomBytes(32);
const secret = seed.toString('base64');
const goodCreds = () => ({
  ok: true,
  keyId: 'kid-1',
  secretKey: secret,
  missing: [],
  apiBase: 'https://api.polymarket.us',
  gatewayBase: 'https://gateway.polymarket.us',
});

(async () => {
  handler._resetDeps();

  {
    const res = mockRes();
    await handler({ method: 'PUT', headers: {} }, res);
    assert.equal(res.out.statusCode, 405);
  }

  handler._setDeps({
    requireOwner: async () => ({ ok: false, status: 401, error: 'Sign in required' }),
    creds: goodCreds,
  });
  {
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, url: '/api/live-trading-desk' }, res);
    assert.equal(res.out.statusCode, 401);
  }

  handler._setDeps({
    requireOwner: async () => ({ ok: false, status: 403, error: 'Not allowed' }),
    creds: goodCreds,
    fetchImpl: async () => { throw new Error('must not call Polymarket'); },
  });
  {
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer tok' }, body: { op: 'place', dollars: 25 } }, res);
    assert.equal(res.out.statusCode, 403);
  }

  handler._setDeps({
    requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
    creds: () => auth.readPolymarketCreds({}),
    fetchImpl: async () => { throw new Error('must not call Polymarket'); },
  });
  {
    const res = mockRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer tok' }, url: '/api/live-trading-desk' }, res);
    assert.equal(res.out.statusCode, 503);
    assert.match(res.out.body.error, /POLYMARKET_KEY_ID/);
    assert.match(res.out.body.error, /Vercel/);
    assert.equal(JSON.stringify(res.out.body).includes(secret), false);
  }

  const calls = [];
  handler._setDeps({
    requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
    creds: goodCreds,
    fetchImpl: async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const u = new URL(url);
      calls.push({ method, host: u.host, path: u.pathname, search: u.search, headers: opts.headers || {}, body: opts.body });
      if (u.host === 'gateway.polymarket.us') {
        assert.equal(opts.headers['X-PM-Access-Key'], undefined);
        return jsonRes(200, MARKET);
      }
      assert.equal(u.host, 'api.polymarket.us');
      assert.equal(opts.headers['X-PM-Access-Key'], 'kid-1');
      assert.ok(opts.headers['X-PM-Signature']);
      if (method === 'GET' && u.pathname === '/v1/portfolio/positions') {
        return jsonRes(200, {
          positions: {
            'aec-nfl-lac-ten-2025-11-02': {
              netPositionDecimal: '12',
              cost: { value: '7.20', currency: 'USD' },
              marketMetadata: { slug: 'aec-nfl-lac-ten-2025-11-02', title: 'Los Angeles vs. Tennessee' },
            },
            flat: { netPositionDecimal: '0', marketMetadata: { slug: 'flat', title: 'Flat' } },
          },
          eof: true,
        });
      }
      if (method === 'GET' && u.pathname === '/v1/orders/open') {
        return jsonRes(200, { orders: [] });
      }
      if (method === 'GET' && u.pathname === '/v1/portfolio/activities') {
        return jsonRes(200, {
          activities: [{
            type: 'ACTIVITY_TYPE_TRADE',
            trade: {
              id: 't1',
              marketSlug: 'aec-nfl-lac-ten-2025-11-02',
              price: { value: '0.600', currency: 'USD' },
              qtyDecimal: '10',
              createTime: '2026-09-24T00:00:00Z',
            },
          }],
        });
      }
      if (method === 'POST' && u.pathname === '/v1/orders') {
        return jsonRes(200, { id: 'ord-rest-1' });
      }
      if (method === 'POST' && u.pathname.endsWith('/cancel')) {
        return jsonRes(200, {});
      }
      return jsonRes(500, { message: 'unexpected ' + method + ' ' + u.pathname });
    },
  });

  {
    const res = mockRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      url: '/api/live-trading-desk?slug=aec-nfl-lac-ten-2025-11-02',
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.positions.length, 1);
    assert.equal(res.out.body.positions[0].team, 'Los Angeles Chargers');
    assert.equal(res.out.body.market.longName, 'Los Angeles Chargers');
    assert.equal(res.out.body.market.shortName, 'Tennessee Titans');
    assert.notEqual(res.out.body.market.longName, 'Titans');
    assert.equal(res.out.body.activity[0].americanLabel, '-150');
    assert.equal(res.out.body.capDollars, 100);
    assert.equal(res.out.body.defaultDollars, 25);
  }

  {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: {
        op: 'place',
        marketSlug: 'aec-nfl-lac-ten-2025-11-02',
        outcome: 'short',
        action: 'buy',
        american: '−150',
        dollars: 25,
        price: { value: '0.990' },
      },
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.orderId, 'ord-rest-1');
    assert.equal(res.out.body.snap.intent, 'ORDER_INTENT_BUY_SHORT');
    assert.equal(res.out.body.snap.yesPriceValue, '0.400');
    assert.equal(res.out.body.snap.americanLabel, '-150');
    assert.equal(res.out.body.snap.outcomeName, 'Tennessee Titans');
    assert.equal(res.out.body.snap.contracts, 41);
    const posted = calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST').pop();
    const sent = JSON.parse(posted.body);
    assert.equal(sent.price.value, '0.400');
    assert.equal(sent.intent, 'ORDER_INTENT_BUY_SHORT');
    assert.equal(sent.type, 'ORDER_TYPE_LIMIT');
    assert.equal(sent.quantity, 41);
    assert.notEqual(sent.price.value, '0.990');
    assert.equal(posted.host, 'api.polymarket.us');
  }

  {
    const before = calls.length;
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: {
        op: 'place',
        marketSlug: 'aec-nfl-lac-ten-2025-11-02',
        outcome: 'long',
        action: 'buy',
        american: -150,
        dollars: 250,
      },
    }, res);
    assert.equal(res.out.statusCode, 400);
    assert.match(res.out.body.error, /\$100/);
    assert.equal(calls.length, before + 1, 'cap rejects before create');
    assert.equal(calls[calls.length - 1].host, 'gateway.polymarket.us');
  }

  {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { op: 'cancel', orderId: 'ord-rest-1', marketSlug: 'aec-nfl-lac-ten-2025-11-02' },
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    const posted = calls.filter((c) => c.path.endsWith('/cancel')).pop();
    assert.equal(posted.method, 'POST');
    assert.equal(posted.path, '/v1/order/ord-rest-1/cancel');
    assert.deepEqual(JSON.parse(posted.body), { marketSlug: 'aec-nfl-lac-ten-2025-11-02' });
  }

  {
    const seen = [];
    const client = createPolymarketUsClient({
      keyId: 'kid-1',
      secretKey: secret,
      fetchImpl: async (url, opts) => {
        const u = new URL(url);
        seen.push(u.pathname + u.search + ' signed=' + (opts.headers['X-PM-Signature'] || '').slice(0, 8));
        if (u.search && !seen.some((s) => s.includes('retry'))) {
          seen.push('retry-marker');
          return jsonRes(401, { message: 'unauthorized' });
        }
        return jsonRes(200, { orders: [] });
      },
    });
    const out = await client.listOpenOrders({ slugs: 'aec-nfl-lac-ten-2025-11-02' });
    assert.deepEqual(out, { orders: [] });
    assert.ok(seen[0].startsWith('/v1/orders/open?'));
    assert.ok(seen.some((s) => s.startsWith('/v1/orders/open?')));
    assert.equal(seen.filter((s) => s.startsWith('/v1/orders/open')).length, 2);
  }

  {
    const hosts = [];
    const client = createPolymarketUsClient({
      keyId: 'kid-1',
      secretKey: secret,
      fetchImpl: async (url, opts) => {
        const u = new URL(url);
        hosts.push(u.host + ' ' + (opts.method || 'GET'));
        if (u.host === 'gateway.polymarket.us') throw new Error('gateway down');
        assert.equal(opts.headers['X-PM-Access-Key'], 'kid-1');
        return jsonRes(200, MARKET);
      },
    });
    const market = await client.getMarketBySlug('aec-nfl-lac-ten-2025-11-02');
    assert.equal(market.slug, MARKET.slug);
    assert.deepEqual(hosts, [
      'gateway.polymarket.us GET',
      'api.polymarket.us GET',
    ]);
  }

  console.log('live-trading-desk.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
