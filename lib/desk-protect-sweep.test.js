'use strict';

const assert = require('node:assert/strict');
const { createMemoryProtectStore } = require('./desk-protect-registry');
const { runProtectSweep } = require('./desk-protect-sweep');
const { sendProtectTelegram, KEVIN_ADMIN_CHAT_ID } = require('./desk-protect-notify');

const SLUG = 'aec-nfl-lac-ten-2025-11-02';
const MARKET = {
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

function bbo(bid, ask) {
  return {
    marketData: {
      bestBid: { value: String(bid), currency: 'USD' },
      bestAsk: { value: String(ask), currency: 'USD' },
    },
  };
}

function resting(id, intent, yesPrice, qty) {
  return {
    id,
    marketSlug: SLUG,
    intent,
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

function fakeClient({ open, book, failCreates = 0, market = MARKET, idPrefix = 'ord-new-' } = {}) {
  const calls = { cancel: [], create: [] };
  let creates = 0;
  const state = { open: open.map((row) => ({ ...row, price: { ...row.price } })) };
  return {
    calls,
    state,
    async listOpenOrders() {
      return { orders: state.open.map((row) => ({ ...row, price: { ...row.price } })) };
    },
    async getMarketBySlug() { return market; },
    async getMarketBbo() { return book; },
    async cancelOrder(id) {
      calls.cancel.push(id);
      state.open = state.open.filter((row) => row.id !== id);
    },
    async createOrder(body) {
      calls.create.push(body);
      creates += 1;
      if (creates <= failCreates) {
        const err = new Error('create failed');
        err.statusCode = 500;
        throw err;
      }
      const id = idPrefix + calls.create.length;
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

(async () => {
  const pings = [];
  const notify = async (text) => {
    pings.push(text);
    return { ok: true };
  };
  const now = 1_700_000_000_000;

  {
    pings.length = 0;
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.ok, true);
    assert.equal(out.fired, 1);
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 1);
    const body = client.calls.create[0];
    assert.equal(body.price.value, '0.550');
    assert.equal(body.intent, 'ORDER_INTENT_BUY_LONG');
    assert.equal(body.quantity, 41);
    assert.equal(body.type, 'ORDER_TYPE_LIMIT');
    assert.equal(body.marketSlug, SLUG);
    const action = out.actions[0];
    assert.equal(action.result, 'rereset');
    assert.equal(action.oldAmerican, '-150');
    assert.equal(action.newAmerican, '-122');
    assert.equal(action.newCents, '55¢');
    assert.match(pings[0], /^Bet Protect · /);
    assert.match(pings[0], /Cancelled → re-rested/);
    assert.match(pings[0], /-150/);
    assert.match(pings[0], /-122/);
    const old = await store.get('ord-1');
    assert.equal(old.status, 'replaced');
    const next = await store.get(action.newOrderId);
    assert.equal(next.status, 'armed');
    assert.equal(next.protect_count, 1);
    assert.equal(next.x_cents, 3);
    assert.equal(next.y_cents, 1);
    assert.equal(next.lineage_id, 'ord-1');
    assert.equal(next.submitted_outcome_micro, 600000);
    assert.notEqual(next.outcome_micro, 600000);

    const again = await runProtectSweep({ client, store, notify, now: () => now + 5_000 });
    assert.equal(again.fired, 0);
    assert.equal(client.calls.cancel.length, 1, 'same mid does not re-cancel the improved rest');
    assert.equal(client.calls.create.length, 1);

    const moved = fakeClient({
      open: client.state.open,
      book: bbo(0.48, 0.50),
      idPrefix: 'ord-next-',
    });
    const second = await runProtectSweep({ client: moved, store, notify, now: () => now + 5_000 });
    assert.equal(second.fired, 1);
    assert.equal(second.actions[0].result, 'rereset');
    const latest = await store.get(second.actions[0].newOrderId);
    assert.equal(latest.protect_count, 2);
    assert.equal(latest.submitted_outcome_micro, 600000);
    assert.equal(latest.outcome_micro, 480000);
    assert.equal((await store.listImproved([SLUG])).length, 2);
  }

  {
    pings.length = 0;
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.62, 0.64),
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.fired, 0);
    assert.equal(out.parked, 1);
    assert.equal(client.calls.cancel.length, 0);
    assert.equal(client.calls.create.length, 0);
    assert.equal(pings.length, 0);
    assert.equal((await store.get('ord-1')).status, 'armed');
  }

  {
    const store = createMemoryProtectStore([armedRow({ protect_count: 8 })]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    pings.length = 0;
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.fired, 1);
    assert.equal(out.actions[0].result, 'cancelled');
    assert.equal(out.actions[0].reason, 'capped');
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 0);
    assert.match(pings[0], /Bet Protect cap/);
    assert.match(pings[0], /^Bet Protect · /);
    assert.equal((await store.get('ord-1')).status, 'capped');
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
      failCreates: 1,
    });
    pings.length = 0;
    const first = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(first.actions[0].result, 'pending');
    assert.equal(client.calls.cancel.length, 1);
    assert.equal((await store.get('ord-1')).status, 'pending_rereset');
    const second = await runProtectSweep({ client, store, notify, now: () => now + 5_000 });
    assert.equal(second.fired, 1);
    assert.equal(second.actions[0].result, 'rereset');
    assert.equal(client.calls.cancel.length, 1, 'retry does not cancel again');
    assert.equal(client.calls.create.length, 2);
    assert.equal((await store.get('ord-1')).status, 'replaced');
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [],
      book: bbo(0.55, 0.57),
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(client.calls.cancel.length, 0);
    assert.equal(out.actions[0].result, 'gone');
    assert.equal((await store.get('ord-1')).status, 'gone');
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    const [a, b] = await Promise.all([
      runProtectSweep({ client, store, notify, now: () => now }),
      runProtectSweep({ client, store, notify, now: () => now }),
    ]);
    const fired = a.fired + b.fired;
    assert.equal(fired, 1);
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 1);
  }

  {
    const sell = armedRow({
      outcome: 'short',
      action: 'buy',
      yes_price: '0.580',
      outcome_micro: 420000,
      outcome_name: 'Tennessee Titans',
    });
    const store = createMemoryProtectStore([sell]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_SHORT', '0.580', 41)],
      book: bbo(0.61, 0.63),
    });
    pings.length = 0;
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.fired, 1, JSON.stringify(out));
    assert.equal(client.calls.create[0].intent, 'ORDER_INTENT_BUY_SHORT');
    assert.equal(client.calls.create[0].price.value, '0.630');
    assert.equal(out.actions[0].newAmerican, '+170');
    assert.match(pings[0], /\+170/);
    assert.match(pings[0], /Tennessee Titans/);
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    const orig = client.cancelOrder.bind(client);
    client.cancelOrder = async (id) => {
      await orig(id);
      await store.disarm('ord-1');
    };
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 0, 'manual cancel during the sweep does not re-rest');
    assert.equal(out.fired, 0);
    assert.equal((await store.get('ord-1')).status, 'disarmed');
  }

  {
    const store = createMemoryProtectStore([armedRow({
      status: 'pending_rereset',
      replaced_by: 'ord-hidden',
      pending_yes_price: '0.550',
      pending_contracts: 41,
      pending_intent: 'ORDER_INTENT_BUY_LONG',
      sweep_token: null,
    })]);
    const client = fakeClient({ open: [], book: bbo(0.55, 0.57) });
    client.getOrder = async (id) => ({
      id,
      marketSlug: SLUG,
      intent: 'ORDER_INTENT_BUY_LONG',
      price: { value: '0.550', currency: 'USD' },
      quantity: 41,
      leavesQuantity: 41,
      state: 'ORDER_STATE_NEW',
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.actions[0].result, 'rereset');
    assert.equal(out.actions[0].newOrderId, 'ord-hidden');
    assert.equal(out.actions[0].adopted, true);
    assert.equal(client.calls.create.length, 0, 'visible-on-getOrder rest is adopted');
    assert.equal((await store.get('ord-hidden')).status, 'armed');
  }

  {
    const claimed = createMemoryProtectStore([armedRow()]);
    const first = await claimed.claim('ord-1', 'tok-a', { nowIso: new Date(now).toISOString(), fromStatus: 'armed' });
    const second = await claimed.claim('ord-1', 'tok-b', { nowIso: new Date(now).toISOString(), fromStatus: 'armed' });
    assert.ok(first);
    assert.equal(second, null);
    await claimed.releaseStale(new Date(now + 60_000).toISOString());
    assert.equal((await claimed.get('ord-1')).status, 'armed');
  }

  {
    // Exactly 3¢ through does not fire. More than 3¢ does, once.
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.56, 0.58),
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.fired, 0);
    assert.equal(client.calls.cancel.length, 0);
    assert.equal((await store.get('ord-1')).status, 'armed');
  }

  {
    // An open order that was never armed is left alone, even when it is through.
    const store = createMemoryProtectStore([armedRow({ order_id: 'armed-only', yes_price: '0.600' })]);
    const client = fakeClient({
      open: [
        resting('armed-only', 'ORDER_INTENT_BUY_LONG', '0.600', 41),
        resting('plain-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41),
      ],
      book: bbo(0.55, 0.57),
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.fired, 1);
    assert.deepEqual(client.calls.cancel, ['armed-only']);
    assert.equal(client.state.open.some((row) => row.id === 'plain-1'), true);
  }

  {
    const store = createMemoryProtectStore([]);
    const client = fakeClient({
      open: [resting('plain-1', 'ORDER_INTENT_BUY_LONG', '0.600', 500)],
      book: bbo(0.55, 0.57),
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.checked, 0);
    assert.equal(client.calls.cancel.length, 0);
    assert.equal(client.calls.create.length, 0);
  }

  {
    // 500 contracts at 60¢ would risk $300. Re-rest must stay at or under $100.
    const store = createMemoryProtectStore([armedRow({ contracts: 500 })]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 500)],
      book: bbo(0.55, 0.57),
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.actions[0].result, 'rereset');
    const qty = client.calls.create[0].quantity;
    const price = Number(client.calls.create[0].price.value);
    assert.ok(qty * price <= 100 + 1e-6, 're-rest risk ' + (qty * price));
    assert.ok(qty < 500);
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 1);
  }

  {
    // After one improve, a drift in Kevin's favor and small further moves do not walk the price.
    pings.length = 0;
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    const first = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(first.fired, 1);
    const books = [bbo(0.62, 0.64), bbo(0.545, 0.555), bbo(0.53, 0.55), bbo(0.52, 0.54)];
    for (let i = 0; i < books.length; i++) {
      client.getMarketBbo = async () => books[i];
      const next = await runProtectSweep({ client, store, notify, now: () => now + 5000 + i });
      assert.equal(next.fired, 0, 'step ' + i + ' ' + JSON.stringify(next));
    }
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 1);
  }

  {
    const seen = [];
    const result = await sendProtectTelegram('Protect · test', {
      env: { TELEGRAM_BOT_TOKEN: 'tok-1', TELEGRAM_ALERT_CHAT_ID: '111' },
      fetchImpl: async (url, opts) => {
        seen.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, json: async () => ({ ok: true }) };
      },
    });
    assert.equal(result.ok, true);
    assert.match(seen[0].url, /bottok-1\/sendMessage/);
    assert.equal(seen[0].body.chat_id, '111');
    const fallback = [];
    await sendProtectTelegram('Protect · fallback', {
      env: { TELEGRAM_BOT_TOKEN: 'tok-2' },
      fetchImpl: async (url, opts) => {
        fallback.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({ ok: true }) };
      },
    });
    assert.equal(fallback[0].chat_id, KEVIN_ADMIN_CHAT_ID);
    const skipped = await sendProtectTelegram('x', { env: {}, fetchImpl: async () => { throw new Error('no'); } });
    assert.equal(skipped.skipped, true);
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'desk-protect-notify.js'), 'utf8');
    assert.match(src, /TELEGRAM_BOT_TOKEN/);
    assert.doesNotMatch(src, /EVPARLAYS_ALERT_TELEGRAM_BOT_TOKEN/);
  }

  console.log('desk-protect-sweep.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
