'use strict';

const assert = require('node:assert/strict');
const { createMemoryProtectStore } = require('./desk-protect-registry');
const { createMemoryOrderTrackStore } = require('./desk-order-tracks');
const { runProtectSweep, runProtectWsHandoff } = require('./desk-protect-sweep');
const { sendProtectTelegram, KEVIN_ADMIN_CHAT_ID } = require('./desk-protect-notify');
const { createMemoryProtectAudit } = require('./desk-protect-audit');

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

function bbo(bid, ask, at = 1_700_000_000_000) {
  return {
    marketData: {
      bestBid: { value: String(bid), currency: 'USD' },
      bestAsk: { value: String(ask), currency: 'USD' },
      timestamp: new Date(at).toISOString(),
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
  const calls = { cancel: [], create: [], getOrder: [] };
  let creates = 0;
  const state = {
    open: open.map((row) => ({ ...row, price: { ...row.price } })),
    canceled: {},
  };
  return {
    calls,
    state,
    async listOpenOrders() {
      return { orders: state.open.map((row) => ({ ...row, price: { ...row.price } })) };
    },
    async getOrder(id) {
      calls.getOrder.push(id);
      const row = state.canceled[id] || state.open.find((item) => item.id === id);
      if (!row) {
        const err = new Error('missing');
        err.statusCode = 404;
        throw err;
      }
      return {
        order: {
          ...row,
          state: state.canceled[id] ? 'ORDER_STATE_CANCELED' : (row.state || 'ORDER_STATE_NEW'),
          cumQuantity: row.cumQuantity == null ? 0 : row.cumQuantity,
          leavesQuantity: state.canceled[id] ? 0 : row.leavesQuantity,
          quantity: row.quantity,
          avgPx: row.avgPx || (row.cumQuantity > 0 ? row.price : undefined),
        },
      };
    },
    async getMarketBySlug() { return market; },
    async getMarketBbo() { return book; },
    async getMarketBook() {
      const md = book && book.marketData;
      const bids = [];
      const offers = [];
      const add = (side, order) => {
        const px = Number(order.price.value);
        const qty = Number(order.leavesQuantity != null ? order.leavesQuantity : order.quantity);
        const list = side === 'bid' ? bids : offers;
        const found = list.find((level) => Math.abs(Number(level.px.value) - px) < 1e-9);
        if (found) found.qty = String(Number(found.qty) + qty);
        else list.push({ px: order.price, qty: String(qty) });
      };
      for (const order of state.open) {
        const yesBid = String(order.intent || '').includes('BUY_LONG') || String(order.intent || '').includes('SELL_SHORT');
        add(yesBid ? 'bid' : 'offer', order);
      }
      const maxBid = bids.reduce((m, level) => Math.max(m, Number(level.px.value)), 0);
      const minAsk = offers.reduce((m, level) => Math.min(m, Number(level.px.value)), 1);
      if (md && md.bestBid && Number(md.bestBid.value) < minAsk - 1e-9) bids.push({ px: md.bestBid, qty: '1000' });
      if (md && md.bestAsk && Number(md.bestAsk.value) > maxBid + 1e-9) offers.push({ px: md.bestAsk, qty: '1000' });
      bids.sort((a, b) => Number(b.px.value) - Number(a.px.value));
      offers.sort((a, b) => Number(a.px.value) - Number(b.px.value));
      return { marketData: { bids, offers, stats: md && md.stats, transactTime: md && (md.transactTime || md.timestamp) } };
    },
    async cancelOrder(id) {
      calls.cancel.push(id);
      const row = state.open.find((item) => item.id === id);
      if (row) state.canceled[id] = row;
      state.open = state.open.filter((item) => item.id !== id);
    },
    async createOrder(body) {
      calls.create.push(body);
      creates += 1;
      if (creates <= failCreates) {
        const err = new Error('create failed');
        err.statusCode = 400;
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
    const tracks = createMemoryOrderTrackStore();
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(out.ok, true);
    assert.equal(out.fired, 1);
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 1);
    const body = client.calls.create[0];
    assert.equal(body.price.value, '0.540');
    assert.equal(body.intent, 'ORDER_INTENT_BUY_LONG');
    assert.equal(body.quantity, 41);
    assert.equal(body.type, 'ORDER_TYPE_LIMIT');
    assert.equal(body.marketSlug, SLUG);
    const action = out.actions[0];
    assert.equal(action.result, 'rereset');
    assert.equal(action.oldAmerican, '-150');
    assert.equal(action.newAmerican, '-117');
    assert.equal(action.newCents, '54¢');
    assert.match(pings[0], /^Bet Protect · /);
    assert.match(pings[0], /Cancelled → re-rested/);
    assert.match(pings[0], /-150/);
    assert.match(pings[0], /-117/);
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

    const again = await runProtectSweep({ client, store, notify, tracks, now: () => now + 5_000 });
    assert.equal(again.fired, 0);
    assert.equal(client.calls.cancel.length, 1, 'same mid does not re-cancel the improved rest');
    assert.equal(client.calls.create.length, 1);

    const moved = fakeClient({
      open: client.state.open,
      book: bbo(0.48, 0.50),
      idPrefix: 'ord-next-',
    });
    const second = await runProtectSweep({ client: moved, store, notify, tracks, now: () => now + 5_000 });
    assert.equal(second.fired, 1);
    assert.equal(second.actions[0].result, 'rereset');
    const latest = await store.get(second.actions[0].newOrderId);
    assert.equal(latest.protect_count, 2);
    assert.equal(latest.submitted_outcome_micro, 600000);
    assert.equal(latest.outcome_micro, 470000);
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
    // Missing from the open list is not a fill. A failed read stays unknown.
    const store = createMemoryProtectStore([armedRow()]);
    const tracks = createMemoryOrderTrackStore();
    const client = fakeClient({
      open: [],
      book: bbo(0.55, 0.57),
    });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(client.calls.cancel.length, 0);
    assert.equal(out.actions[0].result, 'unknown');
    assert.notEqual(out.actions[0].verifiedState, 'filled');
    assert.equal((await store.get('ord-1')).status, 'armed');
    assert.equal((await tracks.get('ord-1')).verifiedState, 'unknown');
    assert.equal((await tracks.get('ord-1')).unknownReason, 'not_found');
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
    assert.equal(client.calls.create[0].price.value, '0.640');
    assert.equal(out.actions[0].newAmerican, '+178');
    assert.match(pings[0], /\+178/);
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
    // Exactly 3¢ above the live bid does not fire. The mid can be closer.
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.57, 0.58),
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
    // 833 contracts at 60¢ is about $500. Re-rest keeps the full size.
    const store = createMemoryProtectStore([armedRow({ contracts: 833 })]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 833)],
      book: bbo(0.55, 0.57),
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.actions[0].result, 'rereset');
    const qty = client.calls.create[0].quantity;
    const price = Number(client.calls.create[0].price.value);
    assert.equal(qty, 833);
    assert.ok(qty * price <= 1000 + 1e-6, 're-rest risk ' + (qty * price));
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 1);
  }

  {
    // 5000 contracts at the improved price would risk more than $1000.
    const store = createMemoryProtectStore([armedRow({ contracts: 5000 })]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 5000)],
      book: bbo(0.55, 0.57),
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.actions[0].result, 'rereset');
    const qty = client.calls.create[0].quantity;
    const price = Number(client.calls.create[0].price.value);
    assert.ok(qty * price <= 1000 + 1e-6, 're-rest risk ' + (qty * price));
    assert.ok(qty < 5000);
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

  {
    const row = resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41);
    row.cumQuantity = 10;
    row.avgPx = { value: '0.600', currency: 'USD' };
    const store = createMemoryProtectStore([armedRow()]);
    const tracks = createMemoryOrderTrackStore();
    const client = fakeClient({ open: [row], book: bbo(0.55, 0.57) });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(out.fired, 1);
    assert.equal(client.calls.create[0].quantity, 31, 'replacement is the unfilled remainder, not the pre-cancel size');
    assert.equal((await tracks.get('ord-1')).verifiedState, 'partial_canceled');
    assert.equal((await tracks.get('ord-1')).cumQty, 10);
    assert.equal((await tracks.get('ord-1')).avgYesPrice, 0.6);
  }

  {
    const row = resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 2100);
    row.cumQuantity = 2000;
    row.avgPx = { value: '0.60', currency: 'USD' };
    const store = createMemoryProtectStore([armedRow({ contracts: 2100 })]);
    const client = fakeClient({ open: [row], book: bbo(0.55, 0.57) });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 0, 'lineage spend above the cap does not open another rest');
    assert.notEqual(out.actions[0].result, 'rereset');
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    client.getOrder = async () => {
      const err = new Error('down');
      err.statusCode = 503;
      throw err;
    };
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 0, 'unknown cancel result does not reprice');
    assert.equal(out.actions[0].reason, 'unconfirmed');
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const tracks = createMemoryOrderTrackStore();
    const client = fakeClient({ open: [], book: bbo(0.55, 0.57) });
    client.getOrder = async () => ({
      order: {
        id: 'ord-1',
        state: 'ORDER_STATE_CANCELED',
        quantity: 41,
        cumQuantity: 12,
        leavesQuantity: 0,
        avgPx: { value: '0.60', currency: 'USD' },
      },
    });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal((await store.get('ord-1')).status, 'partial_canceled');
    assert.equal((await tracks.get('ord-1')).cumQty, 12);
    assert.equal((await tracks.get('ord-1')).avgYesPrice, 0.6);
    assert.notEqual(out.actions[0].result, 'unknown');
    const again = await runProtectSweep({ client, store, notify, tracks, now: () => now + 120000 });
    assert.equal(again.checked, 0, 'a partial cancel is terminal and is not re-armed');
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const tracks = createMemoryOrderTrackStore();
    const client = fakeClient({ open: [], book: bbo(0.55, 0.57) });
    client.getOrder = async () => ({
      order: {
        id: 'ord-1',
        state: 'ORDER_STATE_EXPIRED',
        quantity: 41,
        cumQuantity: 8,
        leavesQuantity: 0,
        avgPx: { value: '0.60', currency: 'USD' },
      },
    });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal((await store.get('ord-1')).status, 'partial_expired');
    assert.equal((await tracks.get('ord-1')).cumQty, 8);
    assert.notEqual(out.actions[0].result, 'unknown');
    const again = await runProtectSweep({ client, store, notify, tracks, now: () => now + 120000 });
    assert.equal(again.checked, 0, 'a partial expiry is terminal and is not re-armed');
  }

  {
    const child = armedRow({
      order_id: 'ord-2',
      replaces: 'ord-1',
      lineage_id: 'ord-1',
      yes_price: '0.500',
      outcome_micro: 500000,
      contracts: 400,
    });
    const store = createMemoryProtectStore([child]);
    const tracks = createMemoryOrderTrackStore([{
      orderId: 'ord-1',
      ownerEmail: 'kev120909@gmail.com',
      marketSlug: SLUG,
      lineageId: 'ord-1',
      verifiedState: 'partial_canceled',
      cumQty: 1500,
      avgYesPrice: 0.6,
      outcome: 'long',
      action: 'buy',
    }]);
    const client = fakeClient({
      open: [resting('ord-2', 'ORDER_INTENT_BUY_LONG', '0.500', 400)],
      book: bbo(0.40, 0.42),
    });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(client.calls.cancel.length, 1);
    const created = client.calls.create[0];
    assert.ok(created, JSON.stringify(out.actions));
    assert.ok(Number(created.quantity) * Number(created.price.value) <= 100 + 1e-6);
    assert.ok(Number(created.quantity) < 400);
  }

  {
    const child = armedRow({
      order_id: 'ord-2',
      replaces: 'ord-1',
      lineage_id: 'ord-1',
      outcome_micro: 500000,
      yes_price: '0.500',
    });
    const store = createMemoryProtectStore([child]);
    const tracks = createMemoryOrderTrackStore([{
      orderId: 'ord-1',
      ownerEmail: 'kev120909@gmail.com',
      marketSlug: SLUG,
      lineageId: 'ord-1',
      verifiedState: 'partial_canceled',
      cumQty: 20,
      avgYesPrice: null,
      outcome: 'long',
      action: 'buy',
    }]);
    const client = fakeClient({
      open: [resting('ord-2', 'ORDER_INTENT_BUY_LONG', '0.500', 40)],
      book: bbo(0.40, 0.42),
    });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(client.calls.create.length, 0, JSON.stringify(out.actions));
    assert.equal(out.actions[0].reason, 'prior-spent-unknown');
  }

  {
    const store = createMemoryProtectStore([armedRow({
      yes_price: '0.500',
      outcome_micro: 500000,
      contracts: 2000,
    })]);
    const tracks = createMemoryOrderTrackStore();
    let failWrites = 1;
    const origUpsert = tracks.upsert.bind(tracks);
    tracks.upsert = async (row) => {
      if (failWrites > 0) {
        failWrites -= 1;
        throw new Error('db down');
      }
      return origUpsert(row);
    };
    const book = bbo(0.40, 0.42);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.500', 2000)],
      book,
    });
    client.getOrder = async () => ({
      order: {
        id: 'ord-1',
        marketSlug: SLUG,
        intent: 'ORDER_INTENT_BUY_LONG',
        price: { value: '0.500', currency: 'USD' },
        state: 'ORDER_STATE_CANCELED',
        quantity: 2000,
        cumQuantity: 1500,
        leavesQuantity: 500,
        avgPx: { value: '0.600', currency: 'USD' },
      },
    });
    const blocked = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 0, JSON.stringify(blocked.actions));
    assert.equal(blocked.actions[0].reason, 'track-unpersisted');
    assert.equal(await tracks.get('ord-1'), null);
    assert.equal((await store.get('ord-1')).status, 'pending_lineage');
    book.marketData.timestamp = new Date(now + 61_000).toISOString();
    const recovered = await runProtectSweep({ client, store, notify, tracks, now: () => now + 61_000 });
    const created = client.calls.create[0];
    assert.ok(created, JSON.stringify(recovered.actions));
    assert.equal(client.calls.create.length, 1);
    assert.equal((await tracks.get('ord-1')).cumQty, 1500);
    assert.ok(Number(created.quantity) * Number(created.price.value) <= 100 + 1e-6);
    assert.ok(Number(created.quantity) < 500);
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    client.cancelOrder = async () => {
      const err = new Error('missing');
      err.statusCode = 404;
      throw err;
    };
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(client.calls.create.length, 0);
    assert.notEqual(out.actions[0].result, 'rereset');
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const staleBook = bbo(0.50, 0.52);
    staleBook.marketData.timestamp = new Date(now - 30_000).toISOString();
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: staleBook,
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.fired, 1, JSON.stringify(out.actions));
    assert.notEqual(out.actions[0].reason, 'stale-feed');
    assert.equal(client.calls.cancel.length, 1);
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const audits = createMemoryProtectAudit();
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.59, 0.62),
    });
    await runProtectSweep({ client, store, notify, audits, now: () => now });
    await runProtectSweep({ client, store, notify, audits, now: () => now + 1000 });
    assert.equal(audits.rows.length, 1, 'unchanged inside checks share one heartbeat');
    assert.equal(audits.rows[0].trigger, 'inside');
    assert.equal(audits.rows[0].action, 'none');
    const moved = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 20)],
      book: bbo(0.55, 0.57),
    });
    const fired = await runProtectSweep({ client: moved, store, notify, audits, now: () => now + 2000 });
    assert.equal(fired.fired, 1);
    assert.equal(moved.calls.create[0].quantity, 20, 'confirmed remainder is what gets re-rested');
    assert.equal(audits.rows[audits.rows.length - 1].action, 'rereset');
    assert.equal(audits.rows[audits.rows.length - 1].cancelResult, 'ok');
  }

  {
    const root = {
      orderId: 'ord-1', ownerEmail: 'kev120909@gmail.com', marketSlug: SLUG, lineageId: 'ord-1',
      verifiedState: 'partial_canceled', cumQty: 1000, avgYesPrice: 0.5, outcome: 'long', action: 'buy',
    };
    const mid = {
      orderId: 'ord-2', ownerEmail: 'kev120909@gmail.com', marketSlug: SLUG, lineageId: 'ord-1',
      replaces: 'ord-1',
      verifiedState: 'partial_canceled', cumQty: 800, avgYesPrice: 0.5, outcome: 'long', action: 'buy',
    };
    const child = armedRow({
      order_id: 'ord-3', replaces: 'ord-2', lineage_id: 'ord-1',
      yes_price: '0.500', outcome_micro: 500000, contracts: 400,
    });
    const store = createMemoryProtectStore([child]);
    const tracks = createMemoryOrderTrackStore([root, mid]);
    const client = fakeClient({
      open: [resting('ord-3', 'ORDER_INTENT_BUY_LONG', '0.500', 400)],
      book: bbo(0.40, 0.42),
    });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    const created = client.calls.create[0];
    assert.ok(created, JSON.stringify(out.actions));
    assert.ok(Number(created.quantity) < 400, 'two earlier generations reduce the room');
    assert.ok(Number(created.quantity) * Number(created.price.value) <= 100 + 1e-6);
  }

  {
    const child = armedRow({
      order_id: 'ord-2',
      replaces: 'ord-1',
      lineage_id: 'ord-1',
      yes_price: '0.500',
      outcome_micro: 500000,
      contracts: 400,
    });
    const store = createMemoryProtectStore([child]);
    const tracks = createMemoryOrderTrackStore();
    const book = bbo(0.40, 0.42);
    const client = fakeClient({
      open: [resting('ord-2', 'ORDER_INTENT_BUY_LONG', '0.500', 400)],
      book,
    });
    const missing = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(client.calls.create.length, 0, JSON.stringify(missing.actions));
    assert.equal(missing.actions[0].reason, 'lineage-incomplete');
    await tracks.upsert({
      orderId: 'ord-1',
      ownerEmail: 'kev120909@gmail.com',
      marketSlug: SLUG,
      lineageId: 'ord-1',
      verifiedState: 'partial_canceled',
      cumQty: 1500,
      avgYesPrice: 0.6,
      outcome: 'long',
      action: 'buy',
    });
    book.marketData.timestamp = new Date(now + 61_000).toISOString();
    const recovered = await runProtectSweep({ client, store, notify, tracks, now: () => now + 61_000 });
    const created = client.calls.create[0];
    assert.ok(created, JSON.stringify(recovered.actions));
    assert.ok(Number(created.quantity) * Number(created.price.value) <= 100 + 1e-6);
  }

  {
    const child = armedRow({
      order_id: 'ord-3', replaces: 'ord-2', lineage_id: 'ord-1',
      yes_price: '0.500', outcome_micro: 500000, contracts: 400,
    });
    const store = createMemoryProtectStore([child]);
    const tracks = createMemoryOrderTrackStore([
      {
        orderId: 'ord-1', ownerEmail: 'kev120909@gmail.com', marketSlug: SLUG, lineageId: 'ord-1',
        verifiedState: 'partial_canceled', cumQty: 1800, avgYesPrice: 0.5, outcome: 'long', action: 'buy',
      },
      {
        orderId: 'ord-2', ownerEmail: 'kev120909@gmail.com', marketSlug: SLUG, lineageId: 'ord-1',
        replaces: 'ord-1', verifiedState: 'canceled', cumQty: 0, outcome: 'long', action: 'buy',
      },
    ]);
    const open = resting('ord-3', 'ORDER_INTENT_BUY_LONG', '0.500', 400);
    const client = fakeClient({ open: [open], book: bbo(0.40, 0.42) });
    client.getOrder = async () => ({
      order: {
        id: 'ord-3', state: 'ORDER_STATE_CANCELED', quantity: 400,
        cumQuantity: 40, leavesQuantity: 360, avgPx: { value: '0.500', currency: 'USD' },
      },
    });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    const created = client.calls.create[0];
    assert.ok(created, JSON.stringify(out.actions));
    assert.ok(Number(created.quantity) < 360, 'cancel-race fill plus prior spend cuts the replacement');
    assert.ok(Number(created.quantity) * Number(created.price.value) <= 80 + 1e-6);
  }

  {
    const child = armedRow({
      order_id: 'ord-2', replaces: 'ord-1', lineage_id: 'ord-1', action: 'sell',
      yes_price: '0.400', outcome_micro: 400000, contracts: 100,
    });
    const store = createMemoryProtectStore([child]);
    const tracks = createMemoryOrderTrackStore([{
      orderId: 'ord-1', ownerEmail: 'kev120909@gmail.com', marketSlug: SLUG, lineageId: 'ord-1',
      verifiedState: 'partial_canceled', cumQty: 2000, avgYesPrice: 0.4, outcome: 'long', action: 'sell',
    }]);
    const client = fakeClient({
      open: [resting('ord-2', 'ORDER_INTENT_SELL_LONG', '0.400', 100)],
      book: bbo(0.30, 0.50),
    });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.create.length, 0, JSON.stringify(out.actions));
    assert.equal(out.actions[0].reason, 'chain-cap');
  }

  {
    const store = createMemoryProtectStore([armedRow({ contracts: 40 })]);
    const ours = resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 100);
    ours.quantity = 100;
    ours.leavesQuantity = 40;
    const other = resting('other', 'ORDER_INTENT_BUY_LONG', '0.600', 80);
    other.quantity = 80;
    other.leavesQuantity = 1;
    const client = fakeClient({ open: [ours, other], book: bbo(0.55, 0.57) });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.fired, 1, JSON.stringify(out.actions));
    assert.equal(client.calls.cancel.length, 1);
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const book = bbo(0.55, 0.57);
    delete book.marketData.timestamp;
    book.marketData.transactTime = new Date(now).toISOString().replace('.000Z', '.072958363Z');
    const fresh = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book,
    });
    const parsed = await runProtectSweep({ client: fresh, store: createMemoryProtectStore([armedRow()]), notify, now: () => now });
    assert.equal(parsed.fired, 1, 'nanosecond transactTime is the exchange time');
    const missing = bbo(0.55, 0.57);
    delete missing.marketData.timestamp;
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: missing,
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.fired, 1, 'a successful fetch with no transactTime is a quiet book');
    assert.notEqual(out.actions[0].reason, 'age-unknown');
  }

  {
    const store = createMemoryProtectStore([armedRow({
      yes_price: '0.500', outcome_micro: 500000, contracts: 400,
    })]);
    const tracks = createMemoryOrderTrackStore();
    const origInsert = store.insert.bind(store);
    const origUpsert = tracks.upsert.bind(tracks);
    let insertFails = 1;
    let writeFails = 1;
    store.insert = async (row) => {
      if (insertFails > 0) {
        insertFails -= 1;
        throw new Error('insert down');
      }
      return origInsert(row);
    };
    tracks.upsert = async (row) => {
      if (writeFails > 0) {
        writeFails -= 1;
        throw new Error('track down');
      }
      return origUpsert(row);
    };
    const book = bbo(0.40, 0.42);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.500', 400)],
      book,
    });
    const blocked = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(client.calls.create.length, 0, JSON.stringify(blocked.actions));
    assert.equal((await store.get('ord-1')).status, 'pending_lineage');
    book.marketData.timestamp = new Date(now + 61_000).toISOString();
    const first = await runProtectSweep({ client, store, notify, tracks, now: () => now + 61_000 });
    assert.equal(client.calls.create.length, 1, JSON.stringify(first.actions));
    assert.equal(first.actions[0].reason, 'registry');
    const parent = await store.get('ord-1');
    assert.equal(parent.status, 'pending_lineage');
    assert.ok(parent.replaced_by && parent.replaced_by !== 'create-unknown');
    book.marketData.timestamp = new Date(now + 122_000).toISOString();
    const second = await runProtectSweep({ client, store, notify, tracks, now: () => now + 122_000 });
    book.marketData.timestamp = new Date(now + 183_000).toISOString();
    const third = await runProtectSweep({ client, store, notify, tracks, now: () => now + 183_000 });
    assert.equal(client.calls.create.length, 1, JSON.stringify([second.actions, third.actions]));
    assert.equal((await store.get('ord-1')).status, 'replaced');
    assert.equal((await store.get(parent.replaced_by)).replaces, 'ord-1');
  }

  {
    const store = createMemoryProtectStore([armedRow({
      yes_price: '0.500', outcome_micro: 500000, contracts: 400,
    })]);
    const tracks = createMemoryOrderTrackStore();
    const origInsert = store.insert.bind(store);
    store.insert = async () => { throw new Error('insert down'); };
    const book = bbo(0.40, 0.42);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.500', 400)],
      book,
    });
    await runProtectSweep({ client, store, notify, tracks, now: () => now });
    book.marketData.timestamp = new Date(now + 61_000).toISOString();
    await runProtectSweep({ client, store, notify, tracks, now: () => now + 61_000 });
    book.marketData.timestamp = new Date(now + 122_000).toISOString();
    await runProtectSweep({ client, store, notify, tracks, now: () => now + 122_000 });
    assert.equal(client.calls.create.length, 1);
    assert.equal((await store.get('ord-1')).replaced_by !== 'create-unknown', true);
    assert.notEqual((await store.get('ord-1')).status, 'armed');
    void origInsert;
  }

  {
    const store = createMemoryProtectStore([armedRow({
      yes_price: '0.500', outcome_micro: 500000, contracts: 400,
    })]);
    const tracks = createMemoryOrderTrackStore();
    const origUpsert = tracks.upsert.bind(tracks);
    let linkFails = 1;
    tracks.upsert = async (row) => {
      if (linkFails > 0 && row.replacedBy) {
        linkFails -= 1;
        throw new Error('link down');
      }
      return origUpsert(row);
    };
    const book = bbo(0.40, 0.42);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.500', 400)],
      book,
    });
    await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(client.calls.create.length, 1);
    book.marketData.timestamp = new Date(now + 61_000).toISOString();
    await runProtectSweep({ client, store, notify, tracks, now: () => now + 61_000 });
    assert.equal(client.calls.create.length, 1);
    assert.equal((await store.get('ord-1')).status, 'replaced');
  }

  {
    const store = createMemoryProtectStore([armedRow({
      yes_price: '0.500', outcome_micro: 500000, contracts: 400,
    })]);
    const tracks = createMemoryOrderTrackStore();
    const book = bbo(0.40, 0.42);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.500', 400)],
      book,
    });
    const origCreate = client.createOrder.bind(client);
    client.createOrder = async () => {
      client.calls.create.push({ timeout: true });
      const err = new Error('timeout');
      throw err;
    };
    const first = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(client.calls.create.length, 1, JSON.stringify(first.actions));
    assert.equal((await store.get('ord-1')).replaced_by, 'create-unknown');
    book.marketData.timestamp = new Date(now + 61_000).toISOString();
    await runProtectSweep({ client, store, notify, tracks, now: () => now + 61_000 });
    book.marketData.timestamp = new Date(now + 122_000).toISOString();
    await runProtectSweep({ client, store, notify, tracks, now: () => now + 122_000 });
    assert.equal(client.calls.create.length, 1);
    void origCreate;
  }

  {
    const store = createMemoryProtectStore([armedRow({
      yes_price: '0.500', outcome_micro: 500000, contracts: 400, status: 'pending_lineage',
      replaced_by: 'R1', pending_yes_price: '0.390', pending_contracts: 400, pending_intent: 'ORDER_INTENT_BUY_LONG',
    })]);
    const tracks = createMemoryOrderTrackStore([{
      orderId: 'ord-1', ownerEmail: 'kev120909@gmail.com', marketSlug: SLUG, lineageId: 'ord-1',
      verifiedState: 'canceled', cumQty: 0, outcome: 'long', action: 'buy',
    }]);
    const restingR1 = resting('R1', 'ORDER_INTENT_BUY_LONG', '0.390', 400);
    const client = fakeClient({ open: [restingR1], book: bbo(0.40, 0.42) });
    await runProtectSweep({ client, store, notify, tracks, now: () => now });
    await runProtectSweep({ client, store, notify, tracks, now: () => now + 61_000 });
    assert.equal(client.calls.create.length, 0);
    assert.equal((await store.get('ord-1')).status, 'replaced');
    assert.equal((await store.get('ord-1')).replaced_by, 'R1');
  }

  {
    let release;
    let started;
    const startedP = new Promise((resolve) => { started = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const store = createMemoryProtectStore([armedRow({
      yes_price: '0.500', outcome_micro: 500000, contracts: 400,
    })]);
    const tracks = createMemoryOrderTrackStore();
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.500', 400)],
      book: bbo(0.40, 0.42),
    });
    const origCreate = client.createOrder.bind(client);
    client.createOrder = async (body) => {
      started();
      await gate;
      return origCreate(body);
    };
    const first = runProtectSweep({ client, store, notify, tracks, now: () => now });
    await startedP;
    const second = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    release();
    await first;
    assert.equal(second.fired, 0);
    assert.equal(client.calls.create.length, 1);
  }

  {
    const store = createMemoryProtectStore([armedRow({
      yes_price: '0.500', outcome_micro: 500000, contracts: 400,
    })]);
    const tracks = createMemoryOrderTrackStore();
    const origInsert = store.insert.bind(store);
    store.insert = async () => { throw new Error('insert down'); };
    const book = bbo(0.40, 0.42);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.500', 400)],
      book,
    });
    await runProtectSweep({ client, store, notify, tracks, now: () => now });
    const replacementId = (await store.get('ord-1')).replaced_by;
    client.getOrder = async (id) => {
      if (id === replacementId) {
        return { order: { id, state: 'ORDER_STATE_FILLED', quantity: 400, cumQuantity: 400, leavesQuantity: 0, avgPx: { value: '0.390', currency: 'USD' }, marketSlug: SLUG, intent: 'ORDER_INTENT_BUY_LONG', price: { value: '0.390', currency: 'USD' } } };
      }
      return { order: { id: 'ord-1', state: 'ORDER_STATE_CANCELED', quantity: 400, cumQuantity: 0, leavesQuantity: 0, marketSlug: SLUG, intent: 'ORDER_INTENT_BUY_LONG', price: { value: '0.500', currency: 'USD' } } };
    };
    client.state.open = [];
    book.marketData.timestamp = new Date(now + 61_000).toISOString();
    await runProtectSweep({ client, store, notify, tracks, now: () => now + 61_000 });
    assert.equal(client.calls.create.length, 1);
    assert.equal((await store.get('ord-1')).status, 'replaced');
    assert.equal((await tracks.get(replacementId)).verifiedState, 'filled');
    assert.equal((await tracks.get(replacementId)).cumQty, 400);
    void origInsert;
  }

  {
    const sibling = armedRow({
      order_id: 'sib', lineage_id: 'ord-1', replaces: 'ord-1', yes_price: '0.410', outcome_micro: 410000, contracts: 200, x_cents: 3,
    });
    const child = armedRow({
      order_id: 'ord-2', replaces: 'ord-1', lineage_id: 'ord-1', yes_price: '0.500', outcome_micro: 500000, contracts: 400,
    });
    const store = createMemoryProtectStore([sibling, child]);
    const tracks = createMemoryOrderTrackStore([{
      orderId: 'ord-1', ownerEmail: 'kev120909@gmail.com', marketSlug: SLUG, lineageId: 'ord-1',
      verifiedState: 'partial_canceled', cumQty: 1500, avgYesPrice: 0.6, outcome: 'long', action: 'buy',
    }]);
    const client = fakeClient({
      open: [
        resting('sib', 'ORDER_INTENT_BUY_LONG', '0.410', 200),
        resting('ord-2', 'ORDER_INTENT_BUY_LONG', '0.500', 400),
      ],
      book: bbo(0.40, 0.42),
    });
    const out = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    const created = client.calls.create[0];
    assert.ok(created, JSON.stringify(out.actions));
    assert.equal(client.calls.create.length, 1);
    assert.ok(Number(created.quantity) * Number(created.price.value) <= 20 + 1e-6);
  }

  {
    const store = createMemoryProtectStore([armedRow()]);
    const audits = createMemoryProtectAudit();
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    client.getMarketBook = async () => { throw new Error('book down'); };
    const first = await runProtectSweep({ client, store, notify, audits, now: () => now });
    assert.equal(client.calls.cancel.length, 1, JSON.stringify(first.actions));
    assert.equal(client.calls.create.length, 0);
    assert.equal(first.actions[0].reason, 'book-unread');
    assert.equal((await store.get('ord-1')).status, 'pending_book');
    const second = await runProtectSweep({ client, store, notify, audits, now: () => now + 1_000 });
    assert.equal(client.calls.cancel.length, 1, 'a second sweep does not cancel again');
    assert.equal(client.calls.create.length, 0);
    const none = () => audits.rows.filter((row) => row.trigger === 'book-unread' && row.action === 'none').length;
    assert.equal(none(), 1);
    await runProtectSweep({ client, store, notify, audits, now: () => now + 2_000 });
    assert.equal(none(), 1, 'the same unread decision inside 30s is one heartbeat');
    await runProtectSweep({ client, store, notify, audits, now: () => now + 31_000 });
    assert.equal(client.calls.cancel.length, 1);
    assert.ok(none() >= 2);
  }

  {
    const book = bbo(0.595, 0.62);
    book.marketData.stats = {
      lastTradePx: { value: '0.550', currency: 'USD' },
      lastTradeSetTime: new Date(now - 1_000).toISOString(),
      lastTradeQty: '10',
    };
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book,
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(out.fired, 1, JSON.stringify(out.actions));
    assert.equal(client.calls.cancel.length, 1);
  }

  {
    const book = bbo(0.595, 0.62);
    book.marketData.stats = {
      lastTradePx: { value: '0.600', currency: 'USD' },
      lastTradeSetTime: new Date(now - 1_000).toISOString(),
    };
    const store = createMemoryProtectStore([armedRow()]);
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book,
    });
    const out = await runProtectSweep({ client, store, notify, now: () => now });
    assert.equal(client.calls.cancel.length, 0, JSON.stringify(out.actions));
    assert.equal(client.calls.create.length, 0);
  }

  {
    const child = armedRow({
      order_id: 'ord-2', replaces: 'ord-1', lineage_id: 'ord-1',
      yes_price: '0.500', outcome_micro: 500000, contracts: 400,
    });
    const store = createMemoryProtectStore([child]);
    const tracks = createMemoryOrderTrackStore([{
      orderId: 'ord-1', ownerEmail: 'kev120909@gmail.com', marketSlug: SLUG, lineageId: 'ord-1',
      verifiedState: 'partial_canceled', cumQty: 1500, avgYesPrice: 0.6, outcome: 'long', action: 'buy',
    }]);
    const book = bbo(0.40, 0.42);
    const client = fakeClient({
      open: [resting('ord-2', 'ORDER_INTENT_BUY_LONG', '0.500', 400)],
      book,
    });
    const orig = client.getMarketBook.bind(client);
    let reads = 0;
    client.getMarketBook = async () => {
      reads += 1;
      if (reads === 1) throw new Error('book down');
      return orig();
    };
    const blocked = await runProtectSweep({ client, store, notify, tracks, now: () => now });
    assert.equal(client.calls.create.length, 0, JSON.stringify(blocked.actions));
    assert.equal(client.calls.cancel.length, 1);
    const recovered = await runProtectSweep({ client, store, notify, tracks, now: () => now + 1_000 });
    const created = client.calls.create[0];
    assert.ok(created, JSON.stringify(recovered.actions));
    assert.equal(client.calls.create.length, 1);
    assert.ok(Number(created.quantity) * Number(created.price.value) <= 100 + 1e-6);
  }

  {
    const depth = {
      marketData: {
        bids: [{ px: { value: '0.550', currency: 'USD' }, qty: '1000' }],
        offers: [{ px: { value: '0.570', currency: 'USD' }, qty: '1000' }],
        transactTime: new Date(now).toISOString(),
      },
    };
    const client = fakeClient({
      open: [resting('ord-1', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    await client.cancelOrder('ord-1');
    const store = createMemoryProtectStore([armedRow({ status: 'pending_lineage', cooldown_until: null })]);
    const tracks = createMemoryOrderTrackStore();
    const audits = createMemoryProtectAudit();
    const out = await runProtectWsHandoff({
      client, store, notify, tracks, audits, now: () => now,
      orderId: 'ord-1', trigger: 'ws-through', book: depth, canceled: true, latencyMs: 21,
    });
    assert.equal(out.ok, true);
    assert.equal(client.calls.create.length, 1, JSON.stringify(out.actions));
    assert.equal(client.calls.create[0].price.value, '0.540');
    assert.equal((await store.get('ord-1')).status, 'replaced');
    assert.equal(audits.rows[0].trigger, 'ws-through');
    assert.equal(audits.rows[0].latencyMs, 21);
    const again = await runProtectWsHandoff({
      client, store, notify, tracks, audits, now: () => now,
      orderId: 'ord-1', trigger: 'ws-through', book: depth, canceled: true, latencyMs: 21,
    });
    assert.equal(again.skipped, 'replaced');
    assert.equal(client.calls.create.length, 1, 'a second handoff must not place again');

    const raced = createMemoryProtectStore([armedRow({
      order_id: 'ord-race', status: 'pending_lineage', cooldown_until: null,
    })]);
    const raceClient = fakeClient({
      open: [resting('ord-race', 'ORDER_INTENT_BUY_LONG', '0.600', 41)],
      book: bbo(0.55, 0.57),
    });
    await raceClient.cancelOrder('ord-race');
    const raceTracks = createMemoryOrderTrackStore();
    await Promise.all([
      runProtectSweep({ client: raceClient, store: raced, notify, tracks: raceTracks, now: () => now }),
      runProtectWsHandoff({
        client: raceClient, store: raced, notify, tracks: raceTracks, now: () => now,
        orderId: 'ord-race', trigger: 'ws-through', book: depth, canceled: true,
      }),
    ]);
    assert.equal(raceClient.calls.create.length, 1, 'REST sweep and ws-replace place one replacement');
  }

  {
    const child = armedRow({
      order_id: 'ord-2', replaces: 'ord-1', lineage_id: 'ord-1', action: 'sell',
      yes_price: '0.400', outcome_micro: 400000, contracts: 100, status: 'pending_lineage',
    });
    const store = createMemoryProtectStore([child]);
    const tracks = createMemoryOrderTrackStore([{
      orderId: 'ord-1', ownerEmail: 'kev120909@gmail.com', marketSlug: SLUG, lineageId: 'ord-1',
      verifiedState: 'partial_canceled', cumQty: 2000, avgYesPrice: 0.4, outcome: 'long', action: 'sell',
    }]);
    const client = fakeClient({
      open: [resting('ord-2', 'ORDER_INTENT_SELL_LONG', '0.400', 100)],
      book: bbo(0.30, 0.50),
    });
    await client.cancelOrder('ord-2');
    const book = {
      marketData: {
        bids: [{ px: { value: '0.300', currency: 'USD' }, qty: '1000' }],
        offers: [{ px: { value: '0.500', currency: 'USD' }, qty: '1000' }],
        transactTime: new Date(now).toISOString(),
      },
    };
    const out = await runProtectWsHandoff({
      client, store, notify, tracks, now: () => now,
      orderId: 'ord-2', trigger: 'ws-through', book, canceled: true,
    });
    assert.equal(client.calls.create.length, 0, JSON.stringify(out.actions));
    assert.equal(out.actions[0].reason, 'chain-cap');
  }

  {
    const store = createMemoryProtectStore([armedRow({
      status: 'pending_lineage',
      replaced_by: 'create-unknown',
      pending_yes_price: '0.540',
      pending_contracts: 41,
      pending_intent: 'ORDER_INTENT_BUY_LONG',
    })]);
    const adopted = resting('ord-adopt', 'ORDER_INTENT_BUY_LONG', '0.540', 41);
    const client = fakeClient({
      open: [adopted],
      book: bbo(0.55, 0.57),
    });
    const tracks = createMemoryOrderTrackStore();
    const out = await runProtectWsHandoff({
      client, store, notify, tracks, now: () => now,
      orderId: 'ord-1', trigger: 'ws-through', canceled: true,
    });
    assert.equal(client.calls.create.length, 0, JSON.stringify(out.actions));
    assert.equal(out.actions[0].newOrderId, 'ord-adopt');
    assert.equal(out.actions[0].adopted, true);
    assert.equal((await store.get('ord-1')).replaced_by, 'ord-adopt');
    assert.equal((await store.get('ord-1')).status, 'replaced');
  }

  console.log('desk-protect-sweep.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
