'use strict';

const assert = require('node:assert/strict');
const { createMemoryProtectStore } = require('./desk-protect-registry');
const { runNovigProtectSweep, novigOutcomeMid, reRestQty, loadMods, decideNovig } = require('./desk-protect-sweep-novig');
const { openOrdersFrom } = require('../api/novig-client');

const MKT = '01a0ef14-1f57-7a31-bddf-1fe259a8b69d';
const EVT = '01a0ef14-1ee3-7150-82ab-b40c515a5781';
const JAX = '01a0ef14-1f57-7a31-bddf-1ff99da77a22';
const PHI = '01a0ef14-1f57-7a31-bddf-2008336481de';
const SLUG = 'novig:' + MKT;

const MARKET = {
  marketId: MKT,
  eventId: EVT,
  description: 'JAX',
  marketType: 'MONEY',
  status: 'OPEN',
  outcomes: [{ outcomeId: JAX, name: 'JAX' }, { outcomeId: PHI, name: 'PHI' }],
};

function book(jaxBids, phiBids) {
  const mk = (list, prefix) => list.map((p, i) => (typeof p === 'object' ? p : { orderId: prefix + i, price: String(p), qty: 1000 }));
  return { marketId: MKT, seq: 1, orders: { [JAX]: mk(jaxBids, 'j'), [PHI]: mk(phiBids, 'p') } };
}

function row(over) {
  return {
    order_id: 'ord-1',
    owner_email: 'kev120909@gmail.com',
    market_slug: SLUG,
    outcome: 'long',
    action: 'buy',
    yes_price: '0.400',
    outcome_micro: 400000,
    submitted_outcome_micro: 400000,
    contracts: 250,
    x_cents: 3,
    y_cents: 1,
    lineage_id: 'ord-1',
    protect_count: 0,
    status: 'armed',
    title: 'JAX',
    outcome_name: 'JAX',
    tick: 0.005,
    min_qty: 1,
    created_at: new Date(Date.now() - 60000).toISOString(),
    ...over,
  };
}

function fakeClient({ open = [], bk, eventStatus = 'OPEN_PREGAME', orders = {}, rejectPlace = 0 } = {}) {
  const calls = { cancel: [], place: [], getOrder: [] };
  const state = { open: open.slice(), n: 0, rejects: rejectPlace };
  return {
    calls,
    state,
    async listOpenOrders() { return { seq: 7, open: state.open.slice() }; },
    async getMarket() { return MARKET; },
    async getBook(id, q) {
      assert.ok(q && q.depth >= 1 && q.depth <= 20, 'Novig book depth must be 1..20');
      return bk;
    },
    async getEvent() { return { eventId: EVT, status: eventStatus, description: 'Philadelphia Eagles @ Jacksonville Jaguars' }; },
    async getOrder(id) {
      calls.getOrder.push(id);
      if (orders[id]) return orders[id];
      const err = new Error('404'); err.statusCode = 404; throw err;
    },
    async cancelOrder(id) {
      calls.cancel.push(id);
      state.open = state.open.filter((o) => o.orderId !== id);
      return { orderId: id };
    },
    async placeOrder(body) {
      calls.place.push(body);
      if (state.rejects > 0) {
        state.rejects -= 1;
        const err = new Error('POST_ONLY_REJECTED'); err.statusCode = 400; err.code = 'POST_ONLY_REJECTED'; throw err;
      }
      state.n += 1;
      const id = 'new-' + state.n;
      state.open.push({ orderId: id, marketId: MKT, outcomeId: body.outcomeId, price: body.price, qty: body.qty, tif: body.tif });
      return { orderId: id };
    },
  };
}

function restOn(outcomeId, price, qty = 250, id = 'ord-1') {
  return { orderId: id, marketId: MKT, outcomeId, price: String(price), qty, tif: 'PO' };
}

(async () => {
  await loadMods();

  // openOrdersFrom reads the real OrdersSnapshot shape { seq, open }.
  assert.deepEqual(openOrdersFrom({ seq: 2, open: [{ orderId: 'a' }] }), [{ orderId: 'a' }]);
  assert.deepEqual(openOrdersFrom({ seq: 2, open: [] }), []);
  assert.deepEqual(openOrdersFrom([{ orderId: 'b' }]), [{ orderId: 'b' }]);
  assert.deepEqual(openOrdersFrom(null), []);

  // Mid: JAX bid .30, PHI bid .65 -> JAX ask .35 -> mid .325. Own order skipped.
  const b = book([0.30, 0.25], [0.65]);
  assert.equal(Math.round(novigOutcomeMid(b, JAX, PHI) * 1000), 325);
  const withOwn = book([{ orderId: 'ord-1', price: '0.40', qty: 250 }, 0.30], [0.65]);
  assert.equal(Math.round(novigOutcomeMid(withOwn, JAX, PHI, new Set(['ord-1'])) * 1000), 325, 'own rest is not the bid');
  assert.equal(novigOutcomeMid(book([], [0.65]), JAX, PHI), null);
  assert.equal(reRestQty(250, 0.31, 1000), 250);
  assert.equal(reRestQty(1e9, 0.5, 1000), 200000, '$1000 cap at 0.5 = 200000 contracts');

  // decideNovig: rest .40 vs mid .325 is 7.5c through (> 3) -> fire; re-rest at mid-1c = .315 -> grid .315.
  const d = decideNovig({ restPrice: 0.40, midProb: 0.325, xCents: 3, yCents: 1 });
  assert.equal(d.fire, true);
  assert.equal(d.improve.price, 0.315);
  assert.equal(decideNovig({ restPrice: 0.34, midProb: 0.325, xCents: 3, yCents: 1 }).fire, false, '1.5c through is inside X');
  assert.equal(decideNovig({ restPrice: 0.20, midProb: 0.325, xCents: 3, yCents: 1 }).fire, false, 'below mid ran away');

  // 1) Through mid: cancel, re-rest PO 1c under mid, registry lineage.
  {
    const store = createMemoryProtectStore([row()]);
    const client = fakeClient({ open: [restOn(JAX, 0.40)], bk: withOwn });
    const pings = [];
    const out = await runNovigProtectSweep({ client, store, notify: async (t) => { pings.push(t); return { ok: true }; } });
    assert.equal(out.ok, true);
    assert.equal(out.fired, 1, JSON.stringify(out.actions));
    assert.deepEqual(client.calls.cancel, ['ord-1']);
    assert.equal(client.calls.place.length, 1);
    assert.deepEqual(client.calls.place[0], { outcomeId: JAX, price: '0.315', qty: 250, tif: 'PO' });
    const old = await store.get('ord-1');
    assert.equal(old.status, 'replaced');
    assert.equal(old.replaced_by, 'new-1');
    const next = await store.get('new-1');
    assert.equal(next.status, 'armed');
    assert.equal(next.protect_count, 1);
    assert.equal(next.lineage_id, 'ord-1');
    assert.equal(next.yes_price, '0.315');
    assert.equal(next.outcome_micro, 315000);
    assert.equal(next.submitted_outcome_micro, 400000);
    assert.equal(pings.length, 1);
    assert.match(pings[0], /Novig · Philadelphia Eagles @ Jacksonville Jaguars/);
    assert.match(pings[0], /Buy JAX \+150 \(40¢\) → \+217 \(31\.5¢\)/);
    assert.match(pings[0], /re-rested/);
    assert.equal(out.actions[0].result, 'rereset');
    assert.equal(out.actions[0].telegram, true);

    // Same mid next tick: cooldown, then inside -> no chase.
    const again = await runNovigProtectSweep({ client, store, notify: async () => ({ ok: true }), now: () => Date.now() + 5000 });
    assert.equal(again.fired, 0);
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.place.length, 1);
  }

  // 2) Sell row: the order is a bid on PHI; team (JAX) labels are 1 - price.
  {
    const store = createMemoryProtectStore([row({ action: 'sell', yes_price: '0.700', outcome_micro: 300000, submitted_outcome_micro: 300000 })]);
    const bk = book([0.30], [{ orderId: 'ord-1', price: '0.70', qty: 250 }, 0.62]);
    // PHI bid (excl own) .62, PHI ask = 1 - .30 = .70 -> mid .66; rest .70 is 4c through.
    const client = fakeClient({ open: [restOn(PHI, 0.70)], bk });
    const out = await runNovigProtectSweep({ client, store, notify: async () => ({ ok: false }) });
    assert.equal(out.fired, 1, JSON.stringify(out.actions));
    assert.equal(client.calls.place[0].outcomeId, PHI);
    assert.equal(client.calls.place[0].price, '0.650');
    const next = await store.get('new-1');
    assert.equal(next.outcome_micro, 350000, 'sell JAX at 1 - 0.65');
    assert.equal(out.actions[0].telegram, false);
  }

  // 3) Inside the threshold: nothing.
  {
    const store = createMemoryProtectStore([row({ yes_price: '0.340' })]);
    const client = fakeClient({ open: [restOn(JAX, 0.34)], bk: book([0.30], [0.65]) });
    const out = await runNovigProtectSweep({ client, store });
    assert.equal(out.fired, 0);
    assert.equal(client.calls.cancel.length, 0);
    assert.equal((await store.get('ord-1')).status, 'armed');
  }

  // 4) GOLIVE: rest vanished, order CANCELED, event OPEN_INGAME -> voided, no re-rest.
  {
    const store = createMemoryProtectStore([row()]);
    const client = fakeClient({
      open: [],
      bk: book([0.30], [0.65]),
      eventStatus: 'OPEN_INGAME',
      orders: { 'ord-1': { orderId: 'ord-1', status: 'CANCELED', remaining: 0, qty: 250 } },
    });
    const out = await runNovigProtectSweep({ client, store });
    assert.equal((await store.get('ord-1')).status, 'voided');
    assert.equal(out.actions[0].result, 'voided');
    assert.equal(out.actions[0].reason, 'golive');
    assert.equal(client.calls.place.length, 0);
    assert.equal(client.calls.cancel.length, 0);
  }

  // 5) Cancelled pregame (e.g. on Novig's site) -> gone. Filled -> gone.
  {
    const store = createMemoryProtectStore([row(), row({ order_id: 'ord-2', lineage_id: 'ord-2' })]);
    const client = fakeClient({
      bk: book([0.30], [0.65]),
      orders: {
        'ord-1': { orderId: 'ord-1', status: 'CANCELED', remaining: 0 },
        'ord-2': { orderId: 'ord-2', status: 'FILLED', remaining: 0 },
      },
    });
    const out = await runNovigProtectSweep({ client, store });
    assert.equal((await store.get('ord-1')).status, 'gone');
    assert.equal((await store.get('ord-2')).status, 'gone');
    assert.deepEqual(out.actions.map((a) => a.reason).sort(), ['closed', 'filled']);
  }

  // 6) Just placed (404 right after 201) -> parked, not gone.
  {
    const store = createMemoryProtectStore([row({ created_at: new Date().toISOString() })]);
    const client = fakeClient({ bk: book([0.30], [0.65]) });
    const out = await runNovigProtectSweep({ client, store });
    assert.equal((await store.get('ord-1')).status, 'armed');
    assert.equal(out.actions[0].reason, 'just-placed');
  }

  // 7) Post-only re-rest rejected -> pending_rereset; next sweep retries and rests.
  {
    const store = createMemoryProtectStore([row()]);
    const client = fakeClient({ open: [restOn(JAX, 0.40)], bk: withOwn, rejectPlace: 1 });
    const first = await runNovigProtectSweep({ client, store });
    assert.equal(first.actions[0].result, 'pending');
    const held = await store.get('ord-1');
    assert.equal(held.status, 'pending_rereset');
    assert.equal(held.pending_yes_price, '0.315');
    assert.equal(held.pending_intent, JAX);
    const second = await runNovigProtectSweep({ client, store });
    assert.equal(second.actions[0].result, 'rereset', JSON.stringify(second.actions));
    assert.equal((await store.get('ord-1')).status, 'replaced');
    assert.equal((await store.get('new-1')).status, 'armed');
    assert.equal(client.calls.place.length, 2);
  }

  // 8) Pending re-rest after GOLIVE -> voided, nothing placed.
  {
    const store = createMemoryProtectStore([row({ status: 'pending_rereset', pending_yes_price: '0.315', pending_contracts: 250, pending_intent: JAX })]);
    const client = fakeClient({ bk: book([0.30], [0.65]), eventStatus: 'OPEN_INGAME' });
    await runNovigProtectSweep({ client, store });
    assert.equal((await store.get('ord-1')).status, 'voided');
    assert.equal(client.calls.place.length, 0);
  }

  // 9) Dry run: reports would-fire, touches nothing.
  {
    const store = createMemoryProtectStore([row()]);
    const client = fakeClient({ open: [restOn(JAX, 0.40)], bk: withOwn });
    const out = await runNovigProtectSweep({ client, store, dryRun: true });
    assert.equal(out.actions[0].result, 'would-fire');
    assert.equal(out.actions[0].newPrice, 0.315);
    assert.equal(client.calls.cancel.length, 0);
    assert.equal(client.calls.place.length, 0);
    assert.equal((await store.get('ord-1')).status, 'armed');
  }

  // 10) Polymarket rows are ignored here; capped lineage cancels without re-rest.
  {
    const store = createMemoryProtectStore([
      row({ order_id: 'pm-1', market_slug: 'aec-nfl-lac-ten-2025-11-02' }),
      row({ protect_count: 8 }),
    ]);
    const client = fakeClient({ open: [restOn(JAX, 0.40)], bk: withOwn });
    const out = await runNovigProtectSweep({ client, store });
    assert.equal(out.checked, 1);
    assert.equal((await store.get('pm-1')).status, 'armed');
    assert.equal((await store.get('ord-1')).status, 'capped');
    assert.equal(client.calls.cancel.length, 1);
    assert.equal(client.calls.place.length, 0);
  }

  console.log('desk-protect-sweep-novig.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
