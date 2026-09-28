'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const { spawnSync } = require('node:child_process');
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
  assert.doesNotMatch(text, /sendMessage/);
  assert.match(text, /protect-sweep/);
  assert.doesNotMatch(text, /require\('\.\.\/src\/comboAccess\.js'\)/);
  assert.doesNotMatch(text, /require\('\.\.\/src\/liveDeskPrice\.js'\)/);
  assert.doesNotMatch(text, /require\('\.\.\/src\/liveDeskProtect\.js'\)/);
  assert.match(text, /import\('\.\.\/src\/comboAccess\.js'\)/);
  assert.match(text, /import\('\.\.\/src\/liveDeskPrice\.js'\)/);
  assert.match(text, /import\('\.\.\/src\/liveDeskGames\.js'\)/);
  assert.match(text, /import\('\.\.\/src\/liveDeskProtect\.js'\)/);
  assert.doesNotMatch(text, /require\('\.\.\/src\/liveDeskGames\.js'\)/);
  const sweepSrc = fs.readFileSync(path.join(__dirname, '../lib/desk-protect-sweep.js'), 'utf8');
  assert.doesNotMatch(sweepSrc, /require\('\.\.\/src\/liveDeskPrice\.js'\)/);
  assert.doesNotMatch(sweepSrc, /require\('\.\.\/src\/liveDeskProtect\.js'\)/);
  assert.match(sweepSrc, /import\('\.\.\/src\/liveDeskPrice\.js'\)/);
  const vercel = require('../vercel.json');
  assert.equal(vercel.functions['api/live-trading-desk.js'].maxDuration, 15);
  const ui = fs.readFileSync(path.join(__dirname, '../src/LiveTradingDesk.jsx'), 'utf8');
  assert.match(ui, /getDerivedStateFromError/);
  assert.match(ui, /Array\.isArray\(board && board\.positions\)/);
  assert.match(ui, /deskErrorText/);
  assert.match(ui, /id="desk-game"/);
  assert.match(ui, /id="desk-market"/);
  assert.match(ui, /id="desk-order-line"/);
  assert.match(ui, /id="desk-allow-cross"/);
  assert.match(ui, /useState\("buy"\)/);
  assert.doesNotMatch(ui, /useState\("sell"\)/);
  assert.doesNotMatch(ui, /setAction\("sell"\);/);
  assert.match(ui, /function preferBuy\(\) \{\s*setAction\("buy"\);/);
  assert.equal((ui.match(/preferBuy\(\)/g) || []).length, 3);
  const submitFn = ui.slice(ui.indexOf("async function submit"), ui.indexOf("async function cancel"));
  const rejectedAt = submitFn.indexOf("Order was not accepted");
  const clearedAt = submitFn.indexOf("clearRestForm()");
  assert.ok(rejectedAt > 0 && clearedAt > rejectedAt, "a rejected rest keeps the typed ticket");
  assert.equal((submitFn.slice(0, rejectedAt).match(/clearRestForm\(\)/g) || []).length, 0);
  assert.equal((submitFn.match(/clearRestForm\(\)/g) || []).length, 1);
  assert.match(ui, /function clearRestForm\(\) \{[\s\S]*setAction\(reset\.action\)/);
  assert.match(ui, /setProtect\(reset\.protect\)/);
  assert.match(ui, /setGameId\(reset\.gameId\)/);
  assert.match(ui, /setSlug\(reset\.slug\)/);
  assert.match(ui, /setOutcome\(reset\.outcome\)/);
  assert.equal(submitFn.includes("Rested."), false);
  assert.doesNotMatch(ui, /setAmerican\(reset\.american\)/);
  assert.doesNotMatch(ui, /setDollars\(reset\.dollars\)/);
  assert.match(ui, /Moneyline only for now/);
  assert.match(ui, /fat-finger cannot rest a large order/);
  assert.doesNotMatch(ui, /trial only/);
  assert.doesNotMatch(ui, /Small size/);
  assert.match(ui, /id="desk-protect"/);
  assert.match(ui, /const \[protect, setProtect\] = useState\(true\)/, 'Bet Protect starts on');
  assert.doesNotMatch(ui, /Off unless you arm/);
  assert.match(ui, /protectFill/);
  assert.match(ui, /row\.avgAmerican/);
  assert.match(ui, /document\.visibilityState === "hidden"/);
  assert.match(ui, /positionsStale/);
  assert.match(ui, /ordersStale/);
  assert.match(ui, /deskRefreshDelayMs/);
  assert.match(ui, /mergeDeskBoard/);
  assert.match(ui, /No open Polymarket US positions/);
  assert.match(text, /Promise\.allSettled/);
  assert.match(text, /MARKET_LOOKUP_CONCURRENCY = 4/);
  assert.match(text, /TRADE_HISTORY_LIMIT = 20/);
  assert.match(text, /MARKET_CACHE_TTL_MS = 10 \* 60 \* 1000/);
  assert.doesNotMatch(text, /allTrades/);
  assert.doesNotMatch(ui, /"Short "/);
  assert.doesNotMatch(ui, /"Long "/);
  assert.match(ui, /useState\(false\)/);
  assert.doesNotMatch(ui, /quote\.centsLabel/);
  assert.doesNotMatch(ui, /order\.centsLabel/);
}

{
  const loaded = spawnSync(process.execPath, [
    '--no-experimental-require-module',
    '-e',
    'require("./api/live-trading-desk.js"); console.log("loaded")',
  ], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(loaded.status, 0, loaded.stderr || loaded.stdout);
  assert.match(loaded.stdout, /loaded/);
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

function jsonRes(status, body, headers) {
  const text = body == null ? '' : JSON.stringify(body);
  const bag = new Map();
  if (headers) {
    for (const [k, v] of Object.entries(headers)) bag.set(String(k).toLowerCase(), String(v));
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase();
        return bag.has(key) ? bag.get(key) : null;
      },
    },
  };
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

const GB = {
  slug: 'aec-nfl-atl-gb-2026-09-24',
  question: 'Atlanta Falcons vs. Green Bay Packers',
  active: true,
  closed: false,
  orderPriceMinTickSize: 0.001,
  minimumTradeQty: 0.01,
  marketSides: [
    { long: true, description: 'Falcons', team: { name: 'Atlanta Falcons' } },
    { long: false, description: 'Packers', team: { name: 'Green Bay Packers' } },
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
  let bboPayload = {
    marketData: {
      bestBid: { value: '0.20', currency: 'USD' },
      bestAsk: { value: '0.80', currency: 'USD' },
    },
  };
  const priceMod = await import('../src/liveDeskPrice.js');
  function confirmFor(body, market) {
    const sides = priceMod.readMarketSides(market || MARKET);
    const quote = priceMod.quoteRestingOrder({
      american: body.american,
      outcome: body.outcome,
      action: body.action,
      tick: sides.tick,
      dollars: body.dollars,
      minQty: sides.minQty,
    });
    if (!quote.ok) throw new Error(quote.error || 'quote failed');
    const team = quote.outcome === 'short' ? sides.shortName : sides.longName;
    return priceMod.orderTicket(quote, team);
  }
  handler._setDeps({
    requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
    creds: goodCreds,
    fetchImpl: async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const u = new URL(url);
      calls.push({ method, host: u.host, path: u.pathname, search: u.search, headers: opts.headers || {}, body: opts.body });
      if (u.host === 'gateway.polymarket.us') {
        assert.equal(opts.headers['X-PM-Access-Key'], undefined);
        if (u.pathname.endsWith('/bbo')) return jsonRes(200, bboPayload);
        if (u.pathname.includes('aec-nfl-atl-gb-2026-09-24')) return jsonRes(200, GB);
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
    assert.equal(res.out.body.capDollars, 1000);
    assert.equal(res.out.body.defaultDollars, 25);
  }

  {
    const res = mockRes();
    const titansBuy = {
      op: 'place',
      marketSlug: 'aec-nfl-lac-ten-2025-11-02',
      outcome: 'short',
      action: 'buy',
      american: '−150',
      dollars: 25,
    };
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...titansBuy, confirm: confirmFor(titansBuy) },
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
    assert.equal(sent.participateDontInitiate, true);
    assert.equal(sent.side, undefined);
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
        dollars: 1001,
      },
    }, res);
    assert.equal(res.out.statusCode, 400);
    assert.match(res.out.body.error, /\$1000/);
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

  {
    const before = calls.length;
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: {
        op: 'place',
        marketSlug: 'aec-nfl-lac-ten-2025-11-02',
        gameId: 'nfl-atl-gb-2026-09-24',
        outcome: 'long',
        action: 'sell',
        american: -150,
        dollars: 25,
      },
    }, res);
    assert.equal(res.out.statusCode, 400);
    assert.match(res.out.body.error, /selected NFL game/);
    assert.equal(calls.length, before, 'wrong game is rejected before Polymarket');
  }

  {
    const before = calls.length;
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: {
        op: 'place',
        marketSlug: 'asc-nfl-lac-ten-2025-11-02-pos-3pt5',
        outcome: 'long',
        action: 'sell',
        american: -150,
        dollars: 25,
      },
    }, res);
    assert.equal(res.out.statusCode, 400);
    assert.match(res.out.body.error, /moneyline/);
    assert.equal(calls.length, before, 'spread slug is rejected before Polymarket');
  }

  {
    const res = mockRes();
    const body = {
      op: 'place',
      marketSlug: 'aec-nfl-lac-ten-2025-11-02',
      gameId: 'nfl-lac-ten-2025-11-02',
      outcome: 'short',
      action: 'buy',
      american: '−150',
      dollars: 25,
    };
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...body, confirm: confirmFor(body) },
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.snap.outcomeName, 'Tennessee Titans');
  }

  {
    const combos = [
      ['long', 'buy', 'ORDER_INTENT_BUY_LONG', 'buy', '0.600', 166.66, 'Atlanta Falcons'],
      ['long', 'sell', 'ORDER_INTENT_SELL_LONG', 'sell', '0.600', 250, 'Atlanta Falcons'],
      ['short', 'buy', 'ORDER_INTENT_BUY_SHORT', 'sell', '0.400', 166.66, 'Green Bay Packers'],
      ['short', 'sell', 'ORDER_INTENT_SELL_SHORT', 'buy', '0.400', 250, 'Green Bay Packers'],
    ];
    for (const [outcome, action, intent, bookSide, yesPrice, qty, team] of combos) {
      const beforePosts = calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST').length;
      const res = mockRes();
      const body = {
        op: 'place',
        marketSlug: 'aec-nfl-atl-gb-2026-09-24',
        gameId: 'nfl-atl-gb-2026-09-24',
        outcome,
        action,
        american: -150,
        dollars: 100,
      };
      await handler({
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: { ...body, confirm: confirmFor(body, GB) },
      }, res);
      assert.equal(res.out.statusCode, 200, outcome + ' ' + action + ' ' + JSON.stringify(res.out.body));
      assert.equal(res.out.body.snap.intent, intent);
      assert.equal(res.out.body.snap.bookSide, bookSide);
      assert.equal(res.out.body.snap.yesPriceValue, yesPrice);
      assert.equal(res.out.body.snap.contracts, qty);
      assert.equal(res.out.body.snap.outcomeName, team);
      if (outcome === 'short' && action === 'buy') {
        assert.equal(
          res.out.body.snap.line,
          'You will BUY Green Bay Packers at -150 (60c) · 166.66 contracts · max cost $100',
        );
      }
      const posted = calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST');
      assert.equal(posted.length, beforePosts + 1);
      const sent = JSON.parse(posted[posted.length - 1].body);
      assert.equal(sent.intent, intent);
      assert.equal(sent.price.value, yesPrice);
      assert.equal(sent.quantity, qty);
      assert.equal(sent.participateDontInitiate, true);
      assert.notEqual(sent.quantity, outcome === 'short' && action === 'buy' ? 250 : -1);
    }
  }

  {
    const beforePosts = calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST').length;
    const res = mockRes();
    const body = {
      op: 'place',
      marketSlug: 'aec-nfl-atl-gb-2026-09-24',
      outcome: 'short',
      action: 'buy',
      american: -150,
      dollars: 100,
      quantity: 250,
      intent: 'ORDER_INTENT_SELL_SHORT',
      price: { value: '0.400' },
    };
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...body, confirm: confirmFor(body, GB) },
    }, res);
    assert.equal(res.out.statusCode, 400, JSON.stringify(res.out.body));
    assert.match(res.out.body.error, /does not match/);
    assert.equal(calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST').length, beforePosts);
  }

  {
    bboPayload = {
      marketData: {
        bestBid: { value: '0.32', currency: 'USD' },
        bestAsk: { value: '0.355', currency: 'USD' },
      },
    };
    const sellGb = {
      op: 'place',
      marketSlug: 'aec-nfl-atl-gb-2026-09-24',
      outcome: 'short',
      action: 'sell',
      american: -150,
      dollars: 100,
    };
    const beforePosts = calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST').length;
    const blocked = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...sellGb, confirm: confirmFor(sellGb, GB) },
    }, blocked);
    assert.equal(blocked.out.statusCode, 400, JSON.stringify(blocked.out.body));
    assert.match(blocked.out.body.error, /cross/);
    assert.equal(calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST').length, beforePosts);

    const buyGb = {
      op: 'place',
      marketSlug: 'aec-nfl-atl-gb-2026-09-24',
      outcome: 'short',
      action: 'buy',
      american: -150,
      dollars: 100,
    };
    const rested = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...buyGb, confirm: confirmFor(buyGb, GB) },
    }, rested);
    assert.equal(rested.out.statusCode, 200, JSON.stringify(rested.out.body));
    assert.equal(rested.out.body.snap.contracts, 166.66);
    assert.equal(rested.out.body.snap.intent, 'ORDER_INTENT_BUY_SHORT');
    const buySent = JSON.parse(calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST').pop().body);
    assert.equal(buySent.quantity, 166.66);
    assert.equal(buySent.price.value, '0.400');
    assert.equal(buySent.intent, 'ORDER_INTENT_BUY_SHORT');
    assert.equal(buySent.participateDontInitiate, true);

    const crossed = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...sellGb, allowCross: true, confirm: confirmFor(sellGb, GB) },
    }, crossed);
    assert.equal(crossed.out.statusCode, 200, JSON.stringify(crossed.out.body));
    const sellSent = JSON.parse(calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST').pop().body);
    assert.equal(sellSent.intent, 'ORDER_INTENT_SELL_SHORT');
    assert.equal(sellSent.quantity, 250);
    assert.equal(sellSent.price.value, '0.400');
    assert.equal(sellSent.participateDontInitiate, false);

    bboPayload = null;
    const missing = mockRes();
    const beforeMissing = calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST').length;
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...buyGb, confirm: confirmFor(buyGb, GB) },
    }, missing);
    assert.equal(missing.out.statusCode, 400, JSON.stringify(missing.out.body));
    assert.match(missing.out.body.error, /book/);
    assert.equal(calls.filter((c) => c.path === '/v1/orders' && c.method === 'POST').length, beforeMissing);
    bboPayload = {
      marketData: {
        bestBid: { value: '0.20', currency: 'USD' },
        bestAsk: { value: '0.80', currency: 'USD' },
      },
    };
  }

  handler._setDeps({
    requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
    creds: goodCreds,
    fetchImpl: async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const u = new URL(url);
      if (u.host === 'gateway.polymarket.us') return jsonRes(200, MARKET);
      if (method === 'GET' && u.pathname === '/v1/portfolio/positions') {
        return jsonRes(200, {
          positions: {
            'aec-nfl-lac-ten-2025-11-02': {
              netPositionDecimal: '3',
              marketMetadata: { slug: 'aec-nfl-lac-ten-2025-11-02', title: 'Los Angeles vs. Tennessee' },
            },
          },
          eof: true,
        });
      }
      if (method === 'GET' && u.pathname === '/v1/orders/open') return jsonRes(200, { orders: { not: 'an array' } });
      if (method === 'GET' && u.pathname === '/v1/portfolio/activities') return jsonRes(200, { activities: { not: 'an array' } });
      return jsonRes(500, { message: 'unexpected ' + method + ' ' + u.pathname });
    },
  });
  {
    const res = mockRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer tok' }, url: '/api/live-trading-desk' }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.ok, true);
    assert.equal(Array.isArray(res.out.body.positions), true);
    assert.equal(res.out.body.positions.length, 1);
    assert.deepEqual(res.out.body.orders, []);
    assert.deepEqual(res.out.body.activity, []);
    assert.equal(Array.isArray(res.out.body.games), true);
    assert.deepEqual(res.out.body.marketTypes.map((t) => t.id), ['moneyline']);
    assert.equal(res.out.body.positions[0].protectFill, undefined);
  }

  {
    const { createMemoryProtectStore } = require('../lib/desk-protect-registry');
    const store = createMemoryProtectStore([
      {
        order_id: 'filled-gb',
        owner_email: 'kev120909@gmail.com',
        market_slug: 'aec-nfl-lac-ten-2025-11-02',
        outcome: 'short',
        action: 'buy',
        yes_price: '0.600',
        outcome_micro: 400000,
        submitted_outcome_micro: 434783,
        contracts: 10,
        x_cents: 3,
        y_cents: 1,
        lineage_id: 'first-gb',
        protect_count: 2,
        status: 'gone',
        outcome_name: 'Tennessee Titans',
      },
      {
        order_id: 'plain-lac',
        owner_email: 'kev120909@gmail.com',
        market_slug: 'aec-nfl-lac-ten-2025-11-02',
        outcome: 'long',
        action: 'buy',
        yes_price: '0.600',
        outcome_micro: 600000,
        submitted_outcome_micro: 600000,
        contracts: 12,
        x_cents: 3,
        y_cents: 1,
        lineage_id: 'plain-lac',
        protect_count: 0,
        status: 'gone',
      },
    ]);
    handler._setDeps({
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      creds: goodCreds,
      protectStore: () => store,
      fetchImpl: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const u = new URL(url);
        if (u.host === 'gateway.polymarket.us') return jsonRes(200, MARKET);
        if (method === 'GET' && u.pathname === '/v1/portfolio/positions') {
          return jsonRes(200, {
            positions: {
              'aec-nfl-lac-ten-2025-11-02': {
                netPositionDecimal: '-10',
                cost: { value: '4.00', currency: 'USD' },
                marketMetadata: { slug: 'aec-nfl-lac-ten-2025-11-02', title: 'Los Angeles vs. Tennessee' },
              },
            },
            eof: true,
          });
        }
        if (method === 'GET' && u.pathname === '/v1/orders/open') return jsonRes(200, { orders: [] });
        if (method === 'GET' && u.pathname === '/v1/portfolio/activities') return jsonRes(200, { activities: [] });
        return jsonRes(500, { message: 'unexpected ' + method + ' ' + u.pathname });
      },
    });
    const noted = mockRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer tok' }, url: '/api/live-trading-desk' }, noted);
    assert.equal(noted.out.statusCode, 200, JSON.stringify(noted.out.body));
    assert.equal(noted.out.body.positions.length, 1);
    assert.equal(
      noted.out.body.positions[0].protectFill,
      'Tennessee Titans +150 (submitted +130 · improved by Bet Protect)',
    );
    assert.doesNotMatch(noted.out.body.positions[0].protectFill, /¢/);
  }

  handler._resetDeps();
  {
    const kick = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const league = {
      events: [{
        slug: 'nfl-atl-gb-2026-09-24',
        markets: [
          {
            id: 'spread-1',
            slug: 'asc-nfl-atl-gb-2026-09-24-pos-3pt5',
            marketType: 'spreads',
            sportsMarketType: 'football_team_full_game_spread',
            sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_SPREAD',
            line: 3.5,
            gameStartTime: kick,
          },
          {
            id: 'total-1',
            slug: 'tsc-nfl-atl-gb-2026-09-24-47pt5',
            marketType: 'totals',
            sportsMarketType: 'football_team_full_game_total',
            sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_TOTAL',
            line: 47.5,
            gameStartTime: kick,
          },
          {
            id: 'ml-1',
            slug: 'aec-nfl-atl-gb-2026-09-24',
            marketType: 'moneyline',
            sportsMarketType: 'football_team_full_game_winner',
            sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_MONEYLINE',
            gameStartTime: kick,
            marketSides: [
              { long: true, team: { safeName: 'ATL Falcons', ordering: 'away' } },
              { long: false, team: { safeName: 'GB Packers', ordering: 'home' } },
            ],
          },
        ],
      }],
    };
    const seen = [];
    handler._setDeps({
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      creds: goodCreds,
      fetchImpl: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const u = new URL(url);
        seen.push(u.pathname);
        if (u.pathname.startsWith('/v2/leagues/nfl/events')) return jsonRes(200, league);
        if (u.host === 'gateway.polymarket.us') return jsonRes(200, MARKET);
        if (method === 'GET' && u.pathname === '/v1/portfolio/positions') return jsonRes(200, { positions: {}, eof: true });
        if (method === 'GET' && u.pathname === '/v1/orders/open') return jsonRes(200, { orders: [] });
        if (method === 'GET' && u.pathname === '/v1/portfolio/activities') return jsonRes(200, { activities: [] });
        return jsonRes(500, { message: 'unexpected ' + method + ' ' + u.pathname });
      },
    });
    const res = mockRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer tok' }, url: '/api/live-trading-desk' }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.games.length, 1);
    assert.equal(res.out.body.games[0].id, 'nfl-atl-gb-2026-09-24');
    assert.equal(res.out.body.games[0].markets.length, 1);
    assert.equal(res.out.body.games[0].markets[0].id, 'moneyline');
    assert.equal(res.out.body.games[0].markets[0].slug, 'aec-nfl-atl-gb-2026-09-24');
    assert.equal(res.out.body.games[0].markets.some((m) => m.id !== 'moneyline'), false);
    assert.match(res.out.body.games[0].label, /NFL · ATL Falcons @ GB Packers/);
    assert.ok(seen.some((p) => p.startsWith('/v2/leagues/nfl/events')));
    assert.equal(res.out.body.market, null);
  }

  const { createMemoryProtectStore } = require('../lib/desk-protect-registry');

  {
    const store = createMemoryProtectStore();
    let creates = 0;
    handler._setDeps({
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      creds: goodCreds,
      protectStore: () => store,
      notify: async () => ({ ok: true }),
      now: () => 1_700_000_000_000,
      fetchImpl: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const u = new URL(url);
        if (u.host === 'gateway.polymarket.us') {
          if (u.pathname.endsWith('/bbo')) {
            return jsonRes(200, {
              marketData: {
                bestBid: { value: '0.20', currency: 'USD' },
                bestAsk: { value: '0.80', currency: 'USD' },
              },
            });
          }
          return jsonRes(200, MARKET);
        }
        if (method === 'POST' && u.pathname === '/v1/orders') {
          creates += 1;
          return jsonRes(200, { id: 'ord-protect-' + creates });
        }
        if (method === 'POST' && u.pathname.endsWith('/cancel')) return jsonRes(200, {});
        return jsonRes(500, { message: 'unexpected ' + method + ' ' + u.pathname });
      },
    });
    const defaultBody = {
      op: 'place',
      marketSlug: 'aec-nfl-lac-ten-2025-11-02',
      outcome: 'long',
      action: 'buy',
      american: -150,
      dollars: 25,
    };
    const byDefault = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...defaultBody, confirm: confirmFor(defaultBody) },
    }, byDefault);
    assert.equal(byDefault.out.statusCode, 200, JSON.stringify(byDefault.out.body));
    assert.equal(byDefault.out.body.snap.protect.on, true, 'omitted flag arms Bet Protect by default');
    assert.equal(byDefault.out.body.snap.protect.xCents, 3);
    assert.equal(byDefault.out.body.snap.protect.yCents, 1);
    assert.equal((await store.get(byDefault.out.body.orderId)).status, 'armed');

    const plainBody = { ...defaultBody, protect: false };
    const plain = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...plainBody, confirm: confirmFor(plainBody) },
    }, plain);
    assert.equal(plain.out.statusCode, 200, JSON.stringify(plain.out.body));
    assert.equal(plain.out.body.snap.protect.on, false);
    assert.equal(await store.get(plain.out.body.orderId), null);

    const armedBody = { ...plainBody, protect: true };
    const armed = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...armedBody, confirm: confirmFor(armedBody) },
    }, armed);
    assert.equal(armed.out.statusCode, 200, JSON.stringify(armed.out.body));
    assert.equal(armed.out.body.snap.protect.on, true);
    assert.equal(armed.out.body.snap.protect.xCents, 3);
    assert.equal(armed.out.body.snap.protect.yCents, 1);
    assert.equal(armed.out.body.snap.americanLabel, '-150');
    const saved = await store.get(armed.out.body.orderId);
    assert.equal(saved.status, 'armed');
    assert.equal(saved.owner_email, 'kev120909@gmail.com');
    assert.equal(saved.x_cents, 3);
    assert.equal(saved.y_cents, 1);
    assert.equal(saved.submitted_outcome_micro, saved.outcome_micro);
    assert.equal(saved.submitted_outcome_micro, 600000);
    assert.ok(saved.contracts <= 1000 / 0.6 + 1e-6);

    const fiveHundred = { ...defaultBody, dollars: 500 };
    const covered = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...fiveHundred, confirm: confirmFor(fiveHundred) },
    }, covered);
    assert.equal(covered.out.statusCode, 200, JSON.stringify(covered.out.body));
    assert.equal(covered.out.body.snap.protect.on, true, 'a $500 rest stays under Bet Protect');
    assert.equal(covered.out.body.snap.protect.overCap, undefined);
    const coveredRow = await store.get(covered.out.body.orderId);
    assert.equal(coveredRow.status, 'armed');
    assert.ok(coveredRow.contracts > 100 / 0.6, 'larger than the old $100 size');
    assert.ok(coveredRow.contracts <= 1000 / 0.6 + 1e-6);

    const createsBeforeBlock = creates;
    handler._setDeps({ protectStore: () => ({ configured: false, async listArmed() { return []; } }) });
    const blocked = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...armedBody, confirm: confirmFor(armedBody) },
    }, blocked);
    assert.equal(blocked.out.statusCode, 503);
    assert.match(blocked.out.body.error, /desk_protect_rests/);
    assert.equal(creates, createsBeforeBlock, 'unconfigured protect does not rest');

    const fallback = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...defaultBody, confirm: confirmFor(defaultBody) },
    }, fallback);
    assert.equal(fallback.out.statusCode, 200, JSON.stringify(fallback.out.body));
    assert.equal(fallback.out.body.snap.protect.on, false);
    assert.match(fallback.out.body.snap.protect.note, /rests unprotected/);
  }

  {
    const prev = process.env.ADMIN_API_SECRET;
    process.env.ADMIN_API_SECRET = 'desk-sweep-secret';
    handler._resetDeps();
    const store = createMemoryProtectStore();
    let ownerHits = 0;
    let polymarketHits = 0;
    handler._setDeps({
      requireOwner: async () => { ownerHits += 1; return { ok: false, status: 401, error: 'Sign in required' }; },
      creds: goodCreds,
      protectStore: () => store,
      notify: async () => ({ ok: true }),
      fetchImpl: async () => { polymarketHits += 1; return jsonRes(200, { orders: [] }); },
    });
    const denied = mockRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { op: 'protect-sweep' },
    }, denied);
    assert.equal(denied.out.statusCode, 401);
    assert.equal(ownerHits, 1);
    assert.equal(polymarketHits, 0);

    const placeDenied = mockRes();
    await handler({
      method: 'POST',
      headers: { 'x-admin-secret': 'desk-sweep-secret' },
      body: { op: 'place', marketSlug: 'aec-nfl-lac-ten-2025-11-02', outcome: 'long', action: 'buy', american: -150, dollars: 25 },
    }, placeDenied);
    assert.equal(placeDenied.out.statusCode, 401, 'shared secret cannot place');

    const allowed = mockRes();
    await handler({
      method: 'POST',
      headers: { 'x-admin-secret': 'desk-sweep-secret' },
      body: { op: 'protect-sweep' },
    }, allowed);
    assert.equal(allowed.out.statusCode, 200, JSON.stringify(allowed.out.body));
    assert.equal(allowed.out.body.ok, true);
    assert.equal(allowed.out.body.checked, 0);
    assert.equal(ownerHits, 2, 'shared secret skips the owner session only for the sweep');
    if (prev == null) delete process.env.ADMIN_API_SECRET;
    else process.env.ADMIN_API_SECRET = prev;
    handler._resetDeps();
  }

  handler._resetDeps();
  {
    // ATL @ GB: position pages are legs, the title says Packers, the long
    // instrument is Falcons. Trade history is one page (the desk shows 20).
    const gbSlug = 'aec-nfl-atl-gb-2026-09-24';
    let positionPages = 0;
    let activityPages = 0;
    handler._setDeps({
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      creds: goodCreds,
      fetchImpl: async (url) => {
        const u = new URL(url);
        const cursor = u.searchParams.get('cursor') || '';
        if (u.pathname.startsWith('/v2/leagues')) return jsonRes(200, { events: [] });
        if (u.host === 'gateway.polymarket.us') return jsonRes(200, GB);
        if (u.pathname === '/v1/portfolio/positions') {
          positionPages += 1;
          if (!cursor) {
            return jsonRes(200, {
              positions: {
                [gbSlug]: {
                  netPositionDecimal: '-197',
                  cost: { value: '80.00', currency: 'USD' },
                  marketMetadata: { slug: gbSlug, title: 'Packers', outcome: 'Packers' },
                },
              },
              eof: false,
              nextCursor: 'pos-2',
            });
          }
          assert.equal(cursor, 'pos-2');
          return jsonRes(200, {
            positions: {
              [gbSlug + ':leg2']: {
                netPositionDecimal: '-884',
                cost: { value: '352.40', currency: 'USD' },
                marketMetadata: { slug: gbSlug, title: 'Packers', outcome: 'Packers' },
              },
            },
            eof: true,
          });
        }
        if (u.pathname === '/v1/orders/open') return jsonRes(200, { orders: [] });
        if (u.pathname === '/v1/portfolio/activities') {
          activityPages += 1;
          assert.equal(cursor, '', 'trade history is a single page');
          assert.equal(u.searchParams.get('limit'), '20');
          return jsonRes(200, {
            activities: [{
              type: 'ACTIVITY_TYPE_TRADE',
              trade: {
                id: 'early',
                marketSlug: gbSlug,
                intent: 'ORDER_INTENT_BUY_SHORT',
                qtyDecimal: '10',
                price: { value: '0.600', currency: 'USD' },
                createTime: '2026-09-24T17:00:00Z',
              },
            }],
            eof: false,
            nextCursor: 'act-2',
          });
        }
        return jsonRes(500, { message: 'unexpected ' + u.pathname });
      },
    });
    const res = mockRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      url: '/api/live-trading-desk',
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(positionPages, 2, 'positions are paginated');
    assert.equal(activityPages, 1, 'trade history is a single page');
    assert.equal(res.out.body.positions.length, 1);
    const row = res.out.body.positions[0];
    assert.equal(row.team, 'Green Bay Packers');
    assert.notEqual(row.team, 'Atlanta Falcons');
    assert.equal(row.net, 1081);
    assert.notEqual(row.net, 197);
    assert.equal(row.side, 'short');
    assert.equal(row.avgAmerican, '+150');
    assert.equal(row.cost, 432.4);
    assert.equal(row.title, 'Atlanta Falcons vs. Green Bay Packers');
    assert.notEqual(row.title, 'Packers');
    assert.doesNotMatch(String(row.avgAmerican), /¢/);
    handler._resetDeps();
  }

  const CF_1015 = {
    title: 'Error 1015: You are being rate limited',
    status: 429,
    detail: 'You are being rate limited',
    error_code: 1015,
  };

  handler._resetDeps();
  {
    // Account calls 1015, but the public slate still fills the game dropdown.
    // After the slate cache expires, a slate 429 is served from that cache.
    const kick = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const league = {
      events: [{
        slug: 'nfl-lar-den-2026-09-27',
        markets: [{
          id: 'ml-lar-den',
          slug: 'aec-nfl-lar-den-2026-09-27',
          marketType: 'moneyline',
          sportsMarketType: 'football_team_full_game_winner',
          sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_MONEYLINE',
          gameStartTime: kick,
          marketSides: [
            { long: true, team: { safeName: 'LAR Rams', ordering: 'away' } },
            { long: false, team: { safeName: 'DEN Broncos', ordering: 'home' } },
          ],
        }],
      }],
    };
    let now = Date.now();
    let slateStatus = 200;
    let slateHits = 0;
    let positionCalls = 0;
    let orderCalls = 0;
    let activityCalls = 0;
    let marketCalls = 0;
    handler._setDeps({
      now: () => now,
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      creds: goodCreds,
      fetchImpl: async (url) => {
        const u = new URL(url);
        if (u.pathname.startsWith('/v2/leagues/nfl/events')) {
          slateHits += 1;
          if (slateStatus !== 200) return jsonRes(slateStatus, CF_1015, { 'Retry-After': '37' });
          return jsonRes(200, league);
        }
        if (u.pathname.startsWith('/v1/market/slug/')) {
          marketCalls += 1;
          return jsonRes(429, CF_1015, { 'Retry-After': '37' });
        }
        if (u.pathname === '/v1/portfolio/positions') {
          positionCalls += 1;
          return jsonRes(429, CF_1015, { 'Retry-After': '37' });
        }
        if (u.pathname === '/v1/orders/open') {
          orderCalls += 1;
          return jsonRes(429, CF_1015, { 'Retry-After': '37' });
        }
        if (u.pathname === '/v1/portfolio/activities') {
          activityCalls += 1;
          return jsonRes(429, CF_1015, { 'Retry-After': '37' });
        }
        return jsonRes(500, { message: 'unexpected ' + u.pathname });
      },
    });
    const res = mockRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      url: '/api/live-trading-desk',
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.ok, true);
    assert.equal(res.out.body.rateLimited, true);
    assert.equal(res.out.body.retryAfter, 37);
    assert.equal(res.out.body.error, 'Polymarket is rate-limiting us, retrying in 37s');
    assert.equal(res.out.body.positions, null);
    assert.equal(res.out.body.orders, null);
    assert.equal(res.out.body.activity, null);
    assert.match(res.out.body.sectionErrors.positions, /Polymarket is rate-limiting us, retrying in 37s/);
    assert.match(res.out.body.sectionErrors.orders, /rate-limiting us/);
    assert.match(res.out.body.sectionErrors.activity, /rate-limiting us/);
    assert.equal(res.out.body.games.length, 1);
    assert.equal(res.out.body.games[0].id, 'nfl-lar-den-2026-09-27');
    assert.equal(res.out.body.games[0].markets[0].slug, 'aec-nfl-lar-den-2026-09-27');
    assert.equal(JSON.stringify(res.out.body).includes('Error 1015'), false);
    assert.equal(JSON.stringify(res.out.body).includes('error_code'), false);
    assert.equal(positionCalls, 1);
    assert.equal(orderCalls, 1);
    assert.equal(activityCalls, 1);
    assert.equal(marketCalls, 0, 'a 1015 skips uncached market lookups');
    assert.equal(slateHits, 1);
    assert.equal(res.out.body.capDollars, 1000);
    assert.equal(res.out.body.defaultDollars, 25);

    const again = mockRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      url: '/api/live-trading-desk',
    }, again);
    assert.equal(slateHits, 1, 'slate cache serves the dropdown inside the TTL');
    assert.equal(again.out.body.games[0].id, 'nfl-lar-den-2026-09-27');

    now += 61 * 1000;
    slateStatus = 429;
    const stale = mockRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      url: '/api/live-trading-desk',
    }, stale);
    assert.equal(stale.out.statusCode, 200, JSON.stringify(stale.out.body));
    assert.equal(slateHits, 2);
    assert.equal(stale.out.body.games.length, 1);
    assert.equal(stale.out.body.games[0].id, 'nfl-lar-den-2026-09-27');
    assert.equal(stale.out.body.gamesError, '');
    assert.equal(stale.out.body.rateLimited, true);
    assert.equal(JSON.stringify(stale.out.body).includes('Error 1015'), false);
    handler._resetDeps();
  }

  handler._resetDeps();
  {
    // Market lookups cover positions, open orders, and the selected game.
    // Trade-history slugs are not fetched. At most 4 lookups run at once,
    // and a second poll inside 10 minutes uses the module cache.
    const posSlugs = [1, 2, 3, 4, 5, 6].map((n) => 'aec-nfl-p' + n + '-aa-2026-09-27');
    const orderSlug = 'aec-nfl-ord-one-2026-09-27';
    const historySlug = 'aec-nfl-hist-ory-2026-09-27';
    const selected = 'aec-nfl-sel-ect-2026-09-27';
    const wanted = new Set([...posSlugs, orderSlug, selected]);
    let now = Date.now();
    let inFlight = 0;
    let maxInFlight = 0;
    let marketCalls = 0;
    let activityCalls = 0;
    const seen = new Set();
    let releaseAll = () => {};
    let opened = new Promise((resolve) => { releaseAll = resolve; });
    let waiting = 0;
    function marketBody(slug) {
      return {
        ...MARKET,
        slug,
        question: slug,
      };
    }
    handler._setDeps({
      now: () => now,
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      creds: goodCreds,
      fetchImpl: async (url) => {
        const u = new URL(url);
        if (u.pathname.startsWith('/v2/leagues')) return jsonRes(200, { events: [] });
        if (u.pathname.startsWith('/v1/market/slug/')) {
          const slug = decodeURIComponent(u.pathname.slice('/v1/market/slug/'.length));
          seen.add(slug);
          marketCalls += 1;
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          waiting += 1;
          if (waiting >= 4) releaseAll();
          await opened;
          inFlight -= 1;
          return jsonRes(200, marketBody(slug));
        }
        if (u.pathname.endsWith('/bbo')) {
          return jsonRes(200, {
            marketData: {
              bestBid: { value: '0.20', currency: 'USD' },
              bestAsk: { value: '0.80', currency: 'USD' },
            },
          });
        }
        if (u.pathname === '/v1/portfolio/positions') {
          const positions = {};
          posSlugs.forEach((slug, i) => {
            positions[slug] = {
              netPositionDecimal: String(i + 1),
              marketMetadata: { slug, title: slug },
            };
          });
          return jsonRes(200, { positions, eof: true });
        }
        if (u.pathname === '/v1/orders/open') {
          return jsonRes(200, {
            orders: [{
              id: 'ord-scope-1',
              marketSlug: orderSlug,
              side: 'ORDER_SIDE_BUY',
              intent: 'ORDER_INTENT_BUY_LONG',
              price: { value: '0.400', currency: 'USD' },
              leavesQuantity: 10,
              state: 'ORDER_STATE_PENDING_NEW',
            }],
          });
        }
        if (u.pathname === '/v1/portfolio/activities') {
          activityCalls += 1;
          assert.equal(u.searchParams.get('cursor') || '', '');
          return jsonRes(200, {
            activities: [{
              type: 'ACTIVITY_TYPE_TRADE',
              trade: {
                id: 'hist-1',
                marketSlug: historySlug,
                price: { value: '0.500', currency: 'USD' },
                qtyDecimal: '1',
              },
            }],
            eof: false,
            nextCursor: 'hist-2',
          });
        }
        return jsonRes(500, { message: 'unexpected ' + u.pathname });
      },
    });
    const res = mockRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      url: '/api/live-trading-desk?slug=' + selected,
    }, res);
    assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
    assert.equal(res.out.body.positions.length, 6);
    assert.equal(maxInFlight, 4, 'market lookups are capped at 4');
    assert.equal(marketCalls, wanted.size);
    assert.equal(activityCalls, 1);
    for (const slug of wanted) assert.equal(seen.has(slug), true, slug);
    assert.equal(seen.has(historySlug), false, 'trade history markets are not looked up');
    assert.equal(res.out.body.market && res.out.body.market.slug, selected);

    const cached = mockRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      url: '/api/live-trading-desk?slug=' + selected,
    }, cached);
    assert.equal(cached.out.statusCode, 200, JSON.stringify(cached.out.body));
    assert.equal(marketCalls, wanted.size, 'market details stay cached for 10 minutes');
    assert.equal(cached.out.body.market.slug, selected);

    now += (10 * 60 * 1000) + 1;
    waiting = 0;
    opened = new Promise((resolve) => { releaseAll = resolve; });
    const cold = mockRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      url: '/api/live-trading-desk?slug=' + selected,
    }, cold);
    assert.equal(cold.out.statusCode, 200, JSON.stringify(cold.out.body));
    assert.equal(marketCalls, wanted.size * 2, 'market cache expires after 10 minutes');
    assert.equal(maxInFlight, 4);
    handler._resetDeps();
  }

  handler._resetDeps();
  {
    const res = mockRes();
    const body = {
      op: 'place',
      marketSlug: 'aec-nfl-lac-ten-2025-11-02',
      outcome: 'short',
      action: 'buy',
      american: '−150',
      dollars: 25,
    };
    handler._setDeps({
      requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
      creds: goodCreds,
      fetchImpl: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const u = new URL(url);
        if (u.host === 'gateway.polymarket.us' && u.pathname.endsWith('/bbo')) {
          return jsonRes(200, {
            marketData: {
              bestBid: { value: '0.20', currency: 'USD' },
              bestAsk: { value: '0.80', currency: 'USD' },
            },
          });
        }
        if (u.host === 'gateway.polymarket.us') return jsonRes(200, MARKET);
        if (method === 'POST' && u.pathname === '/v1/orders') {
          return jsonRes(429, CF_1015, { 'Retry-After': '42' });
        }
        return jsonRes(500, { message: 'unexpected ' + method + ' ' + u.pathname });
      },
    });
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { ...body, confirm: confirmFor(body) },
    }, res);
    assert.equal(res.out.statusCode, 429, JSON.stringify(res.out.body));
    assert.equal(res.out.body.ok, false);
    assert.equal(res.out.body.rateLimited, true);
    assert.equal(res.out.body.retryAfter, 42);
    assert.equal(res.out.body.error, 'Polymarket is rate-limiting us, retrying in 42s');
    assert.equal(JSON.stringify(res.out.body).includes('Error 1015'), false);
    assert.equal(JSON.stringify(res.out.body).includes('error_code'), false);
    handler._resetDeps();
  }

  console.log('live-trading-desk.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
