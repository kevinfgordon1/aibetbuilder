'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('./polymarket-us-auth');
const { createPolymarketUsClient, createRelayFetch } = require('./polymarket-us-client');

const RELAY = 'https://relay.example';
const SECRET = 'relay-secret-value';
const KEY_ID = 'kid-relay';
const SECRET_KEY = crypto.randomBytes(32).toString('base64');
const SLUG = 'aec-nfl-lac-ten-2025-11-02';

function jsonRes(status, body, headers) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const hdrs = headers || {};
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        for (const [k, v] of Object.entries(hdrs)) {
          if (k.toLowerCase() === key) return v;
        }
        return null;
      },
    },
    text: async () => text,
  };
}

function verifySig(headers, method, signedPath) {
  const pub = crypto.createPublicKey(auth.privateKeyFromSecret(SECRET_KEY));
  const msg = String(headers['X-PM-Timestamp']) + method + signedPath;
  return crypto.verify(null, Buffer.from(msg), pub, Buffer.from(headers['X-PM-Signature'], 'base64'));
}

function clientWith(fetchImpl, extra) {
  return createPolymarketUsClient({
    keyId: KEY_ID,
    secretKey: SECRET_KEY,
    fetchImpl,
    ...(extra || {}),
  });
}

async function withEnv(url, secret, fn) {
  const prevUrl = process.env.POLY_RELAY_URL;
  const prevSecret = process.env.POLY_RELAY_SECRET;
  if (url == null) delete process.env.POLY_RELAY_URL;
  else process.env.POLY_RELAY_URL = url;
  if (secret == null) delete process.env.POLY_RELAY_SECRET;
  else process.env.POLY_RELAY_SECRET = secret;
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => { warns.push(args.map(String).join(' ')); };
  try {
    await fn(warns);
  } finally {
    console.warn = orig;
    if (prevUrl == null) delete process.env.POLY_RELAY_URL;
    else process.env.POLY_RELAY_URL = prevUrl;
    if (prevSecret == null) delete process.env.POLY_RELAY_SECRET;
    else process.env.POLY_RELAY_SECRET = prevSecret;
  }
}

function recordFetch(decide) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(String(url));
    const entry = {
      url: String(url),
      host: u.host,
      path: u.pathname,
      search: u.search,
      method: (init && init.method) || 'GET',
      headers: (init && init.headers) || {},
      body: init && init.body,
      signal: init && init.signal,
    };
    calls.push(entry);
    return decide(entry, calls);
  };
  return { calls, fetchImpl };
}

function assertNoSecretLeak(warns) {
  const blob = warns.join('\n');
  assert.equal(blob.includes(SECRET), false);
  assert.equal(blob.includes('X-PM-Signature'), false);
  assert.equal(/[A-Za-z0-9+/]{40,}={0,2}/.test(blob), false);
}

(async () => {
  const deskSrc = fs.readFileSync(path.join(__dirname, 'live-trading-desk.js'), 'utf8');
  const sweepSrc = fs.readFileSync(path.join(__dirname, 'desk-protect-sweep.js'), 'utf8');
  const feedsSrc = fs.readFileSync(path.join(__dirname, '../lib/player-td-feeds.js'), 'utf8');
  assert.match(deskSrc, /createPolymarketUsClient\(/);
  assert.match(sweepSrc, /createPolymarketUsClient\(/);
  assert.doesNotMatch(feedsSrc, /POLY_RELAY/);
  assert.doesNotMatch(feedsSrc, /X-Poly-Relay/);
  assert.match(feedsSrc, /gateway\.polymarket\.us/);

  await withEnv(null, null, async (warns) => {
    const { calls, fetchImpl } = recordFetch(() => jsonRes(200, { id: 'direct' }));
    const client = clientWith(fetchImpl);
    const placed = await client.createOrder({ marketSlug: SLUG, qty: 1 });
    assert.equal(placed.id, 'direct');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].host, 'api.polymarket.us');
    assert.equal(calls[0].headers['X-Poly-Relay-Secret'], undefined);
    assert.equal(calls[0].headers['X-Poly-Relay-Host'], undefined);
    assert.equal(warns.length, 0);
  });

  await withEnv(RELAY, null, async () => {
    const { calls, fetchImpl } = recordFetch(() => jsonRes(200, { id: 'only-url' }));
    await clientWith(fetchImpl).createOrder({ marketSlug: SLUG });
    assert.equal(calls[0].host, 'api.polymarket.us');
    assert.equal(calls[0].headers['X-Poly-Relay-Secret'], undefined);
  });

  await withEnv(null, SECRET, async () => {
    const { calls, fetchImpl } = recordFetch(() => jsonRes(200, { id: 'only-secret' }));
    await clientWith(fetchImpl).createOrder({ marketSlug: SLUG });
    assert.equal(calls[0].host, 'api.polymarket.us');
    assert.equal(calls[0].headers['X-Poly-Relay-Host'], undefined);
  });

  await withEnv(RELAY + '/', '"' + SECRET + '"', async (warns) => {
    const body = { marketSlug: SLUG, qty: 2 };
    const { calls, fetchImpl } = recordFetch((entry) => {
      assert.equal(entry.host, 'relay.example');
      return jsonRes(200, { id: 'via-relay' });
    });
    const placed = await clientWith(fetchImpl).createOrder(body);
    assert.equal(placed.id, 'via-relay');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, RELAY + '/v1/orders');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].body, JSON.stringify(body));
    assert.equal(calls[0].headers['X-Poly-Relay-Secret'], SECRET);
    assert.equal(calls[0].headers['X-Poly-Relay-Host'], 'api.polymarket.us');
    assert.equal(calls[0].headers['X-PM-Access-Key'], KEY_ID);
    assert.ok(calls[0].headers['X-PM-Timestamp']);
    assert.ok(verifySig(calls[0].headers, 'POST', '/v1/orders'));
    assert.equal(warns.length, 0);
  });

  await withEnv(RELAY, SECRET, async () => {
    const { calls, fetchImpl } = recordFetch(() => jsonRes(200, '{"events":[]}'));
    const text = await clientWith(fetchImpl).getNflLeagueEventsText();
    assert.equal(text, '{"events":[]}');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      RELAY + '/v2/leagues/nfl/events?limit=80&active=true&closed=false',
    );
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].headers['X-Poly-Relay-Host'], 'gateway.polymarket.us');
    assert.equal(calls[0].headers['X-Poly-Relay-Secret'], SECRET);
    assert.equal(calls[0].headers['X-PM-Access-Key'], undefined);
    assert.equal(calls[0].headers['X-PM-Signature'], undefined);
    assert.equal(calls[0].signal instanceof AbortSignal, true);
  });

  await withEnv(RELAY, SECRET, async () => {
    const { calls, fetchImpl } = recordFetch(() => jsonRes(200, {
      market: { slug: SLUG, marketSides: [{ description: 'Yes' }] },
    }));
    const market = await clientWith(fetchImpl).getMarketBySlug(SLUG);
    assert.equal(market.slug, SLUG);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, RELAY + '/v1/market/slug/' + encodeURIComponent(SLUG));
    assert.equal(calls[0].headers['X-Poly-Relay-Host'], 'gateway.polymarket.us');
    assert.equal(calls[0].headers['X-PM-Access-Key'], undefined);
  });

  await withEnv(RELAY, SECRET, async (warns) => {
    const { calls, fetchImpl } = recordFetch(() => jsonRes(401, { message: 'unauthorized' }));
    await assert.rejects(
      () => clientWith(fetchImpl).listOpenOrders({ limit: 20 }),
      (err) => err.statusCode === 401,
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0].host, 'relay.example');
    assert.equal(calls[1].host, 'relay.example');
    assert.equal(calls[0].path, '/v1/orders/open');
    assert.equal(calls[0].search, '?limit=20');
    assert.equal(calls[1].search, '?limit=20');
    assert.ok(verifySig(calls[0].headers, 'GET', '/v1/orders/open'));
    assert.ok(verifySig(calls[1].headers, 'GET', '/v1/orders/open?limit=20'));
    assert.equal(calls[0].headers['X-Poly-Relay-Host'], 'api.polymarket.us');
    assert.equal(calls[1].headers['X-Poly-Relay-Host'], 'api.polymarket.us');
    assert.equal(warns.length, 0);
  });

  await withEnv(RELAY, SECRET, async (warns) => {
    const { calls, fetchImpl } = recordFetch(() => jsonRes(403, { message: 'forbidden' }));
    await assert.rejects(
      () => clientWith(fetchImpl).createOrder({ marketSlug: SLUG }),
      (err) => err.statusCode === 403 && err.publicMessage === 'forbidden',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].host, 'relay.example');
    assert.equal(warns.length, 0);
  });

  for (const status of [502, 503, 504]) {
    await withEnv(RELAY, SECRET, async (warns) => {
      const { calls, fetchImpl } = recordFetch((entry) => {
        if (entry.host === 'relay.example') {
          return jsonRes(status, { ok: false, error: 'upstream_unreachable' });
        }
        assert.equal(entry.headers['X-Poly-Relay-Secret'], undefined);
        assert.equal(entry.headers['X-Poly-Relay-Host'], undefined);
        assert.equal(entry.headers['X-PM-Access-Key'], KEY_ID);
        assert.ok(verifySig(entry.headers, 'POST', '/v1/orders'));
        return jsonRes(200, { id: 'direct-' + status });
      });
      const placed = await clientWith(fetchImpl).createOrder({ marketSlug: SLUG });
      assert.equal(placed.id, 'direct-' + status);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].host, 'relay.example');
      assert.equal(calls[1].host, 'api.polymarket.us');
      assert.equal(calls[1].path, '/v1/orders');
      assert.equal(warns.length, 1);
      assert.match(warns[0], /falling back to direct Polymarket after status /);
      assert.match(warns[0], new RegExp('status ' + status));
      assertNoSecretLeak(warns);
    });
  }

  await withEnv(RELAY, SECRET, async (warns) => {
    const { calls, fetchImpl } = recordFetch((entry) => {
      if (entry.host === 'relay.example') throw new Error('socket hang up');
      assert.equal(entry.headers['X-Poly-Relay-Secret'], undefined);
      return jsonRes(200, { id: 'direct-net' });
    });
    const placed = await clientWith(fetchImpl).createOrder({ marketSlug: SLUG });
    assert.equal(placed.id, 'direct-net');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].host, 'api.polymarket.us');
    assert.equal(warns.length, 1);
    assert.match(warns[0], /after network/);
    assertNoSecretLeak(warns);
  });

  for (const [status, body, reason] of [
    [401, { ok: false, error: 'unauthorized' }, '401 unauthorized'],
    [403, { ok: false, error: 'upstream_not_allowed' }, '403 upstream_not_allowed'],
  ]) {
    await withEnv(RELAY, SECRET, async (warns) => {
      const { calls, fetchImpl } = recordFetch((entry) => {
        if (entry.host === 'relay.example') return jsonRes(status, body);
        assert.equal(entry.headers['X-Poly-Relay-Secret'], undefined);
        return jsonRes(200, { id: 'direct-auth' });
      });
      const placed = await clientWith(fetchImpl).createOrder({ marketSlug: SLUG });
      assert.equal(placed.id, 'direct-auth');
      assert.equal(calls.length, 2);
      assert.equal(calls[1].host, 'api.polymarket.us');
      assert.match(warns[0], new RegExp(reason));
      assertNoSecretLeak(warns);
    });
  }

  await withEnv(RELAY, SECRET, async (warns) => {
    const limited = jsonRes(429, { ok: false, error: 'relay_rate_limited' }, { 'Retry-After': '17' });
    const { calls, fetchImpl } = recordFetch((entry) => {
      assert.equal(entry.host, 'relay.example');
      return limited;
    });
    await assert.rejects(
      () => clientWith(fetchImpl).createOrder({ marketSlug: SLUG }),
      (err) => err.statusCode === 429 && err.publicMessage === 'relay_rate_limited',
    );
    assert.equal(calls.length, 1);
    assert.equal(limited.headers.get('Retry-After'), '17');
    assert.equal(warns.length, 0);

    const wrapped = createRelayFetch(async () => limited);
    const passed = await wrapped('https://api.polymarket.us/v1/orders', {
      method: 'POST',
      headers: { 'X-PM-Access-Key': KEY_ID },
      body: '{}',
    });
    assert.equal(passed, limited);
    assert.equal(passed.headers.get('retry-after'), '17');
  });

  await withEnv(RELAY, SECRET, async (warns) => {
    const { calls, fetchImpl } = recordFetch(() => jsonRes(429, {
      title: 'Error 1015: You are being rate limited',
      status: 429,
      error_code: 1015,
    }, { 'Retry-After': '9' }));
    await assert.rejects(
      () => clientWith(fetchImpl).getNflLeagueEventsText(),
      (err) => err.statusCode === 429,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].host, 'relay.example');
    assert.equal(warns.length, 0);
  });

  await withEnv(RELAY, SECRET, async (warns) => {
    const { calls, fetchImpl } = recordFetch(() => jsonRes(413, { ok: false, error: 'body_too_large' }));
    await assert.rejects(
      () => clientWith(fetchImpl).createOrder({ marketSlug: SLUG }),
      (err) => err.statusCode === 413 && err.publicMessage === 'body_too_large',
    );
    assert.equal(calls.length, 1);
    assert.equal(warns.length, 0);
  });

  await withEnv(RELAY, SECRET, async () => {
    const { calls, fetchImpl } = recordFetch((entry) => {
      assert.equal(entry.host, 'example.com');
      return jsonRes(200, { id: 'other' });
    });
    const placed = await clientWith(fetchImpl, { apiBase: 'https://example.com' }).createOrder({ ok: true });
    assert.equal(placed.id, 'other');
    assert.equal(calls[0].headers['X-Poly-Relay-Secret'], undefined);
  });

  await withEnv(RELAY, SECRET, async () => {
    const desk = require('./live-trading-desk');
    desk._resetDeps();
    const calls = [];
    desk._setDeps({
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      creds: () => ({
        ok: true,
        keyId: KEY_ID,
        secretKey: SECRET_KEY,
        apiBase: 'https://api.polymarket.us',
        gatewayBase: 'https://gateway.polymarket.us',
      }),
      protectStore: () => ({ configured: false }),
      fetchImpl: async (url, init) => {
        const u = new URL(String(url));
        calls.push({
          host: u.host,
          path: u.pathname,
          search: u.search,
          relayHost: init && init.headers && init.headers['X-Poly-Relay-Host'],
          secret: init && init.headers && init.headers['X-Poly-Relay-Secret'],
          access: init && init.headers && init.headers['X-PM-Access-Key'],
        });
        if (u.pathname === '/v1/portfolio/positions') return jsonRes(200, { positions: {}, eof: true });
        if (u.pathname === '/v1/orders/open') return jsonRes(200, { orders: [] });
        if (u.pathname === '/v1/portfolio/activities') return jsonRes(200, { activities: [], eof: true });
        return jsonRes(200, { events: [] });
      },
    });
    const res = {
      out: {},
      setHeader() {},
      status(code) { this.out.statusCode = code; return this; },
      json(body) { this.out.body = body; return this; },
    };
    await desk({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      url: '/api/live-trading-desk',
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.ok(calls.length >= 3);
    for (const call of calls) {
      assert.equal(call.host, 'relay.example');
      assert.equal(call.secret, SECRET);
      assert.ok(call.relayHost === 'api.polymarket.us' || call.relayHost === 'gateway.polymarket.us');
      if (call.relayHost === 'api.polymarket.us') assert.equal(call.access, KEY_ID);
      if (call.relayHost === 'gateway.polymarket.us') assert.equal(call.access, undefined);
    }
    const signed = calls.filter((call) => call.relayHost === 'api.polymarket.us').map((call) => call.path);
    assert.ok(signed.includes('/v1/portfolio/positions'));
    assert.ok(signed.includes('/v1/orders/open'));
    assert.ok(signed.includes('/v1/portfolio/activities'));
    desk._resetDeps();
  });

  await withEnv(null, null, async () => {
    const desk = require('./live-trading-desk');
    desk._resetDeps();
    const calls = [];
    desk._setDeps({
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      creds: () => ({
        ok: true,
        keyId: KEY_ID,
        secretKey: SECRET_KEY,
        apiBase: 'https://api.polymarket.us',
        gatewayBase: 'https://gateway.polymarket.us',
      }),
      protectStore: () => ({ configured: false }),
      fetchImpl: async (url, init) => {
        const u = new URL(String(url));
        calls.push({
          host: u.host,
          secret: init && init.headers && init.headers['X-Poly-Relay-Secret'],
        });
        if (u.pathname === '/v1/portfolio/positions') return jsonRes(200, { positions: {}, eof: true });
        if (u.pathname === '/v1/orders/open') return jsonRes(200, { orders: [] });
        if (u.pathname === '/v1/portfolio/activities') return jsonRes(200, { activities: [], eof: true });
        return jsonRes(200, { events: [] });
      },
    });
    const res = {
      out: {},
      setHeader() {},
      status(code) { this.out.statusCode = code; return this; },
      json(body) { this.out.body = body; return this; },
    };
    await desk({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      url: '/api/live-trading-desk',
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.ok(calls.length >= 3);
    for (const call of calls) {
      assert.ok(call.host === 'api.polymarket.us' || call.host === 'gateway.polymarket.us');
      assert.equal(call.secret, undefined);
    }
    desk._resetDeps();
  });

  await withEnv(RELAY, SECRET, async () => {
    const sweep = require('./desk-protect-sweep');
    const { createMemoryProtectStore } = require('../lib/desk-protect-registry');
    sweep._resetDeps();
    const idleCalls = [];
    sweep._setDeps({
      authorized: () => true,
      creds: () => ({
        ok: true,
        keyId: KEY_ID,
        secretKey: SECRET_KEY,
        apiBase: 'https://api.polymarket.us',
        gatewayBase: 'https://gateway.polymarket.us',
      }),
      protectStore: () => createMemoryProtectStore([]),
      notify: async () => {},
      fetchImpl: async (url) => {
        idleCalls.push(String(url));
        return jsonRes(200, {});
      },
    });
    const idleRes = {
      out: {},
      setHeader() {},
      status(code) { this.out.statusCode = code; return this; },
      json(body) { this.out.body = body; return this; },
    };
    await sweep({
      method: 'POST',
      headers: {},
      body: { op: 'sweep', mode: 'adverse-only' },
    }, idleRes);
    assert.equal(idleRes.out.statusCode, 200, JSON.stringify(idleRes.out.body));
    assert.equal(idleCalls.length, 0);

    const armedCalls = [];
    sweep._setDeps({
      protectStore: () => createMemoryProtectStore([{
        order_id: 'ord-1',
        owner_email: 'kev120909@gmail.com',
        market_slug: SLUG,
        outcome: 'long',
        action: 'buy',
        yes_price: '0.600',
        outcome_micro: 600000,
        contracts: 41,
        x_cents: 3,
        y_cents: 1,
        lineage_id: 'ord-1',
        protect_count: 0,
        status: 'armed',
        tick: 0.005,
        min_qty: 1,
      }]),
      fetchImpl: async (url, init) => {
        const u = new URL(String(url));
        armedCalls.push({
          host: u.host,
          path: u.pathname,
          relayHost: init.headers['X-Poly-Relay-Host'],
          secret: init.headers['X-Poly-Relay-Secret'],
          access: init.headers['X-PM-Access-Key'],
        });
        if (u.pathname === '/v1/orders/open') return jsonRes(200, { orders: [] });
        if (u.pathname.includes('/bbo')) {
          return jsonRes(200, { marketData: { bestBid: { value: '0.55' }, bestAsk: { value: '0.57' } } });
        }
        return jsonRes(200, { market: { slug: SLUG, marketSides: [{ description: 'Yes' }] } });
      },
    });
    const armedRes = {
      out: {},
      setHeader() {},
      status(code) { this.out.statusCode = code; return this; },
      json(body) { this.out.body = body; return this; },
    };
    await sweep({
      method: 'POST',
      headers: {},
      body: { op: 'sweep', mode: 'adverse-only' },
    }, armedRes);
    assert.equal(armedRes.out.statusCode, 200, JSON.stringify(armedRes.out.body));
    assert.ok(armedCalls.length >= 1);
    for (const call of armedCalls) {
      assert.equal(call.host, 'relay.example');
      assert.equal(call.secret, SECRET);
      assert.ok(call.relayHost === 'api.polymarket.us' || call.relayHost === 'gateway.polymarket.us');
    }
    assert.ok(armedCalls.some((call) => call.path === '/v1/orders/open' && call.access === KEY_ID));
    sweep._resetDeps();
  });

  console.log('polymarket-us-relay tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
