'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const handler = require('./desk-protect-sweep');
const { createMemoryProtectStore } = require('../lib/desk-protect-registry');
const { createMemoryOrderTrackStore } = require('../lib/desk-order-tracks');
const { runProtectSweep } = require('../lib/desk-protect-sweep');

const SECRET = 'desk-sweep-secret';
const SLUG = 'aec-nfl-lac-ten-2025-11-02';

{
  const text = fs.readFileSync(path.join(__dirname, 'desk-protect-sweep.js'), 'utf8');
  assert.doesNotMatch(text, /require\('\.\.\/src\//);
  assert.match(text, /X-Desk-Protect-Secret/);
  assert.match(text, /adverse-only/);
  const vercel = require('../vercel.json');
  assert.equal(vercel.functions['api/desk-protect-sweep.js'].maxDuration, 15);
  const loaded = spawnSync(process.execPath, [
    '--no-experimental-require-module',
    '-e',
    'require("./api/desk-protect-sweep.js"); console.log("loaded")',
  ], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(loaded.status, 0, loaded.stderr || loaded.stdout);
}

function mockRes() {
  const out = { statusCode: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(code) { out.statusCode = code; return this; },
    json(body) { out.body = body; return this; },
  };
}

function goodCreds() {
  return {
    ok: true,
    keyId: '550e8400-e29b-41d4-a716-446655440000',
    secretKey: crypto.randomBytes(32).toString('base64'),
    apiBase: 'https://api.polymarket.us',
    gatewayBase: 'https://gateway.polymarket.us',
  };
}

function bbo(bid, ask, at = 1_700_000_000_000) {
  return {
    marketData: {
      bestBid: { value: String(bid), currency: 'USD' },
      bestAsk: { value: String(ask), currency: 'USD' },
      timestamp: new Date(at).toISOString(),
    },
  };
}

function resting(id, qty, yesPrice) {
  return {
    id,
    marketSlug: SLUG,
    intent: 'ORDER_INTENT_BUY_LONG',
    price: { value: yesPrice, currency: 'USD' },
    quantity: qty,
    leavesQuantity: qty,
    state: 'ORDER_STATE_NEW',
  };
}

function armedRow(overrides) {
  return {
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
    title: 'Los Angeles vs. Tennessee',
    outcome_name: 'Los Angeles Chargers',
    tick: 0.005,
    min_qty: 1,
    ...overrides,
  };
}

function fakeClient({ open, book }) {
  const calls = { cancel: [], create: [] };
  const state = {
    open: open.map((row) => ({ ...row, price: { ...row.price } })),
    canceled: {},
  };
  return {
    calls,
    async listOpenOrders() {
      return { orders: state.open.map((row) => ({ ...row, price: { ...row.price } })) };
    },
    async getOrder(id) {
      const row = state.canceled[id] || state.open.find((item) => item.id === id);
      if (!row) {
        const err = new Error('missing');
        err.statusCode = 404;
        throw err;
      }
      return {
        order: {
          ...row,
          state: state.canceled[id] ? 'ORDER_STATE_CANCELED' : row.state,
          cumQuantity: 0,
          leavesQuantity: state.canceled[id] ? 0 : row.leavesQuantity,
        },
      };
    },
    async getMarketBySlug() {
      return {
        slug: SLUG,
        question: 'Los Angeles vs. Tennessee',
        active: true,
        closed: false,
        orderPriceMinTickSize: 0.005,
        minimumTradeQty: 1,
        marketSides: [
          { long: true, description: 'Chargers', team: { name: 'Los Angeles Chargers' } },
          { long: false, description: 'Titans', team: { name: 'Tennessee Titans' } },
        ],
      };
    },
    async getMarketBbo() { return book; },
    async getMarketBook() {
      const md = book && book.marketData;
      const bids = state.open
        .filter((order) => String(order.intent || '').includes('BUY_LONG') || String(order.intent || '').includes('SELL_SHORT'))
        .map((order) => ({ px: order.price, qty: String(order.leavesQuantity != null ? order.leavesQuantity : order.quantity) }));
      const offers = state.open
        .filter((order) => !(String(order.intent || '').includes('BUY_LONG') || String(order.intent || '').includes('SELL_SHORT')))
        .map((order) => ({ px: order.price, qty: String(order.leavesQuantity != null ? order.leavesQuantity : order.quantity) }));
      const maxBid = bids.reduce((m, level) => Math.max(m, Number(level.px.value)), 0);
      const minAsk = offers.reduce((m, level) => Math.min(m, Number(level.px.value)), 1);
      if (md && md.bestBid && Number(md.bestBid.value) < minAsk - 1e-9) bids.push({ px: md.bestBid, qty: '1000' });
      if (md && md.bestAsk && Number(md.bestAsk.value) > maxBid + 1e-9) offers.push({ px: md.bestAsk, qty: '1000' });
      bids.sort((a, b) => Number(b.px.value) - Number(a.px.value));
      offers.sort((a, b) => Number(a.px.value) - Number(b.px.value));
      return { marketData: { bids, offers, transactTime: md && (md.transactTime || md.timestamp) } };
    },
    async cancelOrder(id) {
      calls.cancel.push(id);
      const row = state.open.find((item) => item.id === id);
      if (row) state.canceled[id] = row;
      state.open = state.open.filter((item) => item.id !== id);
    },
    async createOrder(body) {
      calls.create.push(body);
      const id = 'ord-new-' + calls.create.length;
      state.open.push({
        id,
        marketSlug: body.marketSlug,
        intent: body.intent,
        price: body.price,
        quantity: body.quantity,
        leavesQuantity: body.quantity,
        state: 'ORDER_STATE_NEW',
      });
      return { id };
    },
  };
}

async function post(headers, body) {
  const res = mockRes();
  await handler({ method: 'POST', headers, body }, res);
  return res.out;
}

(async () => {
  const prevAdmin = process.env.ADMIN_API_SECRET;
  const prevDedicated = process.env.DESK_PROTECT_SWEEP_SECRET;
  process.env.ADMIN_API_SECRET = SECRET;
  delete process.env.DESK_PROTECT_SWEEP_SECRET;
  handler._resetDeps();

  let sweeps = 0;
  handler._setDeps({
    creds: goodCreds,
    authorized: (req) => handler._sweepAuthorized(req),
    runSweep: async () => {
      sweeps += 1;
      return { ok: true, actions: [] };
    },
  });

  const missing = await post({}, { op: 'sweep', mode: 'adverse-only' });
  assert.equal(missing.statusCode, 401);
  assert.equal(sweeps, 0);

  const wrong = await post(
    { 'X-Desk-Protect-Secret': 'not-the-secret-value' },
    { op: 'sweep', mode: 'adverse-only' },
  );
  assert.equal(wrong.statusCode, 401);
  assert.equal(sweeps, 0);

  const short = await post(
    { 'X-Desk-Protect-Secret': 'short-secret' },
    { op: 'sweep', mode: 'adverse-only' },
  );
  assert.equal(short.statusCode, 401);

  const place = await post(
    { 'X-Desk-Protect-Secret': SECRET },
    { op: 'place', marketSlug: SLUG, outcome: 'long', action: 'buy', american: -150, dollars: 25 },
  );
  assert.equal(place.statusCode, 400);
  assert.equal(sweeps, 0, 'sweep secret cannot place');

  const chase = await post(
    { 'X-Desk-Protect-Secret': SECRET },
    { op: 'sweep', mode: 'chase' },
  );
  assert.equal(chase.statusCode, 400);
  assert.equal(sweeps, 0);

  handler._setDeps({
    runSweep: async () => ({
      ok: true,
      actions: [{
        result: 'rereset',
        orderId: 'ord-1',
        newOrderId: 'ord-2',
        marketSlug: SLUG,
        action: 'buy',
        outcomeName: 'Los Angeles Chargers',
        oldAmerican: '-150',
        newAmerican: '-122',
        oldCents: '60¢',
        newCents: '55¢',
        telegram: true,
      }],
    }),
  });
  const quiet = await post(
    { 'X-Desk-Protect-Secret': SECRET },
    { op: 'sweep', mode: 'adverse-only', defaults: { throughCents: 3, restOffsetCents: 1 }, ackedIds: [] },
  );
  assert.equal(quiet.statusCode, 200);
  assert.deepEqual(quiet.body.events, [], 'desk ping already sent, poller must not ping again');

  const now = 1_700_000_000_000;
  const client = fakeClient({
    open: [resting('ord-1', 41, '0.600')],
    book: bbo(0.55, 0.57),
  });
  const store = createMemoryProtectStore([armedRow()]);
  handler._setDeps({
    creds: goodCreds,
    protectStore: () => store,
    clientFromCreds: () => client,
    notify: async () => ({ ok: false }),
    now: () => now,
    runSweep: runProtectSweep,
    trackStore: () => createMemoryOrderTrackStore(),
  });
  const fired = await post(
    { 'X-Desk-Protect-Secret': SECRET },
    { op: 'sweep', mode: 'adverse-only' },
  );
  assert.equal(fired.statusCode, 200, JSON.stringify(fired.body));
  assert.equal(client.calls.cancel.length, 1);
  assert.equal(client.calls.create.length, 1);
  assert.equal(client.calls.create[0].price.value, '0.540');
  assert.equal(client.calls.create[0].quantity, 41);
  assert.equal(fired.body.events.length, 1);
  assert.equal(fired.body.events[0].kind, 'adverse-reprice');
  assert.equal(fired.body.events[0].chase, false);
  assert.match(fired.body.events[0].label, /-117/);
  assert.equal(fired.body.events[0].fromCents, 60);
  assert.equal(fired.body.events[0].toCents, 54);

  const again = await post(
    { 'X-Desk-Protect-Secret': SECRET },
    { op: 'sweep', mode: 'adverse-only' },
  );
  assert.equal(again.body.events.length, 0);
  assert.equal(client.calls.cancel.length, 1, 'same mid does not chase');
  assert.equal(client.calls.create.length, 1);

  const favorClient = fakeClient({
    open: [resting('ord-1', 41, '0.600')],
    book: bbo(0.62, 0.64),
  });
  handler._setDeps({
    protectStore: () => createMemoryProtectStore([armedRow()]),
    clientFromCreds: () => favorClient,
  });
  const favor = await post(
    { 'X-Desk-Protect-Secret': SECRET },
    { op: 'sweep', mode: 'adverse-only' },
  );
  assert.equal(favor.body.events.length, 0);
  assert.equal(favorClient.calls.cancel.length, 0);
  assert.equal(favorClient.calls.create.length, 0);

  const idleClient = fakeClient({
    open: [resting('plain-1', 41, '0.600')],
    book: bbo(0.55, 0.57),
  });
  handler._setDeps({
    protectStore: () => createMemoryProtectStore([]),
    clientFromCreds: () => idleClient,
  });
  const idle = await post(
    { 'X-Desk-Protect-Secret': SECRET },
    { op: 'sweep', mode: 'adverse-only' },
  );
  assert.equal(idle.body.events.length, 0);
  assert.equal(idleClient.calls.cancel.length, 0, 'Protect-off orders are not in the registry');

  const keepClient = fakeClient({
    open: [resting('ord-1', 833, '0.600')],
    book: bbo(0.55, 0.57),
  });
  handler._setDeps({
    protectStore: () => createMemoryProtectStore([armedRow({ contracts: 833 })]),
    clientFromCreds: () => keepClient,
  });
  const kept = await post(
    { 'X-Desk-Protect-Secret': SECRET },
    { op: 'sweep', mode: 'adverse-only' },
  );
  assert.equal(kept.body.events.length, 1);
  assert.equal(keepClient.calls.create[0].quantity, 833, 'a ~$500 rest is re-rested in full');

  const capClient = fakeClient({
    open: [resting('ord-1', 5000, '0.600')],
    book: bbo(0.55, 0.57),
  });
  handler._setDeps({
    protectStore: () => createMemoryProtectStore([armedRow({ contracts: 5000 })]),
    clientFromCreds: () => capClient,
  });
  const capped = await post(
    { 'X-Desk-Protect-Secret': SECRET },
    { op: 'sweep', mode: 'adverse-only' },
  );
  assert.equal(capped.body.events.length, 1);
  const qty = capClient.calls.create[0].quantity;
  const px = Number(capClient.calls.create[0].price.value);
  assert.ok(qty * px <= 1000 + 1e-6, 're-rest risk ' + (qty * px));
  assert.ok(qty < 5000);

  handler._setDeps({
    runSweep: async () => {
      throw new Error('relation "public.desk_protect_rests" does not exist');
    },
  });
  const origError = console.error;
  console.error = () => {};
  const thrown = await post(
    { 'X-Desk-Protect-Secret': SECRET },
    { op: 'sweep', mode: 'adverse-only' },
  );
  console.error = origError;
  assert.equal(thrown.statusCode, 502);
  assert.equal(thrown.body.ok, false);
  assert.equal(thrown.body.error, 'Sweep failed');
  assert.match(thrown.body.detail, /desk_protect_rests" does not exist/, '502 carries the underlying message');
  assert.equal(handler._sweepErrorDetail(null), 'unknown error');
  assert.equal(handler._sweepErrorDetail(new Error('x'.repeat(500))).length, 300);

  let handoffs = 0;
  const sweepsBefore = sweeps;
  handler._setDeps({
    creds: goodCreds,
    runSweep: async () => {
      sweeps += 1;
      return { ok: true, actions: [] };
    },
    runHandoff: async (input) => {
      handoffs += 1;
      assert.equal(input.orderId, 'ord-1');
      assert.equal(input.trigger, 'ws-through');
      assert.equal(input.canceled, true);
      assert.equal(input.latencyMs, 21);
      return { ok: true, fired: 0, actions: [{ result: 'cancelled', reason: 'chain-cap', orderId: 'ord-1' }] };
    },
  });
  const denied = await post({}, { op: 'ws-replace', mode: 'adverse-only', orderId: 'ord-1' });
  assert.equal(denied.statusCode, 401);
  assert.equal(handoffs, 0);
  const handed = await post(
    { 'X-Admin-Secret': SECRET },
    { op: 'ws-replace', mode: 'adverse-only', orderId: 'ord-1', trigger: 'ws-through', canceled: true, latencyMs: 21 },
  );
  assert.equal(handed.statusCode, 200);
  assert.equal(handed.body.ok, true);
  assert.equal(handed.body.actions[0].reason, 'chain-cap');
  assert.equal(handoffs, 1);
  assert.equal(sweeps, sweepsBefore, 'ws-replace does not run the REST sweep');

  if (prevAdmin == null) delete process.env.ADMIN_API_SECRET;
  else process.env.ADMIN_API_SECRET = prevAdmin;
  if (prevDedicated == null) delete process.env.DESK_PROTECT_SWEEP_SECRET;
  else process.env.DESK_PROTECT_SWEEP_SECRET = prevDedicated;
  handler._resetDeps();
  console.log('desk-protect-sweep.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
