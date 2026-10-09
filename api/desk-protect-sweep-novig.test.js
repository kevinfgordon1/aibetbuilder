'use strict';

// Route wiring for the Novig half of the Protect sweep, plus the desk's
// open-orders mapping (OrdersSnapshot { seq, open }).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('./desk-protect-sweep');
const novigDesk = require('./novig-desk');
const { createMemoryProtectStore } = require('../lib/desk-protect-registry');

function mockRes() {
  const out = { statusCode: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(code) { out.statusCode = code; return this; },
    json(body) { out.body = body; return this; },
  };
}

const req = { method: 'POST', headers: {}, body: { op: 'sweep', mode: 'adverse-only' } };

(async () => {
  // The sweep never reads the management key.
  const libSrc = fs.readFileSync(path.join(__dirname, '../lib/desk-protect-sweep-novig.js'), 'utf8');
  const routeSrc = fs.readFileSync(path.join(__dirname, 'desk-protect-sweep.js'), 'utf8');
  assert.doesNotMatch(libSrc + routeSrc, /NOVIG_MGMT|MANAGEMENT_KEY|management_key/i);

  const store = createMemoryProtectStore([]);
  let pmRuns = 0;
  let novigRuns = 0;

  // Novig only (no Polymarket keys): Novig sweep runs, 200.
  handler._setDeps({
    authorized: () => true,
    creds: () => ({ ok: false, missing: ['POLYMARKET_KEY_ID'] }),
    novigCreds: () => ({ ok: true, keyId: 'k', privateKey: {}, apiBase: 'https://api.novig.com' }),
    novigClientFromCreds: () => ({}),
    protectStore: () => store,
    runSweep: async () => { pmRuns += 1; return { ok: true, actions: [] }; },
    runNovigSweep: async () => {
      novigRuns += 1;
      return { ok: true, actions: [{ result: 'cancelled', reason: 'no-improve', orderId: 'n1', marketSlug: 'novig:x', oldAmerican: '+150', oldCents: '40¢', telegram: false }] };
    },
  });
  let res = mockRes();
  await handler(req, res);
  assert.equal(res.out.statusCode, 200, JSON.stringify(res.out.body));
  assert.equal(pmRuns, 0);
  assert.equal(novigRuns, 1);
  assert.equal(res.out.body.events.length, 1, 'unsent Novig ping becomes a poller event');

  // Both venues: both run; one failing still returns the other's events.
  handler._setDeps({
    creds: () => ({ ok: true }),
    clientFromCreds: () => ({}),
    runSweep: async () => { pmRuns += 1; return { ok: true, actions: [] }; },
    runNovigSweep: async () => { novigRuns += 1; throw new Error('Novig GET /v3/account/orders 451 geo'); },
  });
  res = mockRes();
  await handler(req, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(pmRuns, 1);
  assert.equal(novigRuns, 2);
  assert.match(res.out.body.errors.novig, /451/);

  // Neither configured: 503 as before.
  handler._setDeps({ creds: () => ({ ok: false, missing: ['POLYMARKET_KEY_ID'] }), novigCreds: () => ({ ok: false }) });
  res = mockRes();
  await handler(req, res);
  assert.equal(res.out.statusCode, 503);
  handler._resetDeps();

  // Desk open-orders list: real snapshot shape, labelled rows, Protect badge.
  await novigDesk.ensureMods();
  const MKT = '01a0ef14-1f57-7a31-bddf-1fe259a8b69d';
  const JAX = '01a0ef14-1f57-7a31-bddf-1ff99da77a22';
  const PHI = '01a0ef14-1f57-7a31-bddf-2008336481de';
  const market = { marketId: MKT, eventId: 'e', description: 'JAX', status: 'OPEN', outcomes: [{ outcomeId: JAX, name: 'JAX' }, { outcomeId: PHI, name: 'PHI' }] };
  const client = {
    async publicListEvents() { return { items: [] }; },
    async publicListMarkets() { return { items: [] }; },
    async listPositions() { return { positions: [] }; },
    async listFills() { return { fills: [] }; },
    async listOpenOrders() {
      return { seq: 3, open: [
        { orderId: 'o1', marketId: MKT, outcomeId: JAX, price: '0.165', qty: 606, tif: 'PO' },
        { orderId: 'o2', marketId: MKT, outcomeId: PHI, price: '0.600', qty: 10, tif: 'GTC' },
      ] };
    },
    async getMarket() { return market; },
  };
  const deskStore = createMemoryProtectStore([{ order_id: 'o1', market_slug: 'novig:' + MKT, x_cents: 3, y_cents: 1, status: 'armed' }]);
  const snap = await novigDesk.snapshot(client, '', deskStore);
  assert.equal(snap.ok, true);
  assert.equal(snap.orders.length, 2, 'both resting orders counted');
  assert.equal(snap.ordersError, null);
  const [o1, o2] = snap.orders;
  assert.equal(o1.id, 'o1');
  assert.equal(o1.outcomeName, 'JAX');
  assert.equal(o1.quantity, 606);
  assert.equal(o1.action, 'buy');
  assert.match(o1.americanLabel, /^\+50[0-9]$/);
  assert.equal(o1.marketSlug, 'novig:' + MKT);
  assert.equal(o1.title, 'Novig · JAX');
  assert.equal(o1.protect && o1.protect.on, true);
  assert.equal(o2.outcomeName, 'PHI');
  assert.equal(o2.americanLabel, '-150');
  assert.equal(o2.protect, undefined);

  console.log('desk-protect-sweep-novig route + desk orders ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
