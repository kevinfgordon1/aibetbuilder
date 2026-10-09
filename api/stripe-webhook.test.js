'use strict';

const assert = require('node:assert/strict');
const stripe = require('../lib/stripe-api');
const webhook = require('./stripe-webhook.js');
const checkout = require('./stripe-checkout.js');

const SECRET = 'whsec_test_only';
const KEVIN = { id: '79ae1610-097e-4b46-a622-1e952f18e936', email: 'kev120909@gmail.com' };
const STRANGER = { id: '00000000-0000-0000-0000-000000000001', email: 'someone@example.com' };
const SESSION_ID = 'cs_test_' + 'a'.repeat(58); // longer than 64 chars, like real ids
// ---- In-memory Supabase ----
function memoryDb() {
  const tables = { combo_credit_ledger: [], combo_credit_checkouts: [] };
  function from(name) {
    const st = { op: 'select', patch: null, filters: [], single: false };
    const run = () => {
      const rows = tables[name];
      const match = (r) => st.filters.every((f) => f(r));
      if (st.op === 'insert') {
        const r = { ...st.patch };
        if (name === 'combo_credit_ledger' && rows.some((x) => x.source === r.source && x.source_ref === r.source_ref)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        if (name === 'combo_credit_checkouts' && rows.some((x) => x.id === r.id)) return { data: null, error: { code: '23505', message: 'dup' } };
        rows.push({ created_at: new Date().toISOString(), ...r });
        return { data: [r], error: null };
      }
      if (st.op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, st.patch)); return { data: null, error: null }; }
      const out = rows.filter(match).map((r) => ({ ...r }));
      return st.single ? { data: out[0] || null, error: null } : { data: out, error: null };
    };
    const q = {
      select() { return q; },
      insert(p) { st.op = 'insert'; st.patch = p; return q; },
      update(p) { st.op = 'update'; st.patch = p; return q; },
      eq(k, v) { st.filters.push((r) => String(r[k]) === String(v)); return q; },
      gte(k, v) { st.filters.push((r) => String(r[k]) >= String(v)); return q; },
      maybeSingle() { st.single = true; return q; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  }
  return { tables, from };
}

function mockRes() {
  return { statusCode: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

// ---- Signature verification ----
{
  const body = '{"a":1}';
  const sig = stripe.signForTest({ rawBody: body, secret: SECRET });
  const v = (h, s = SECRET, raw = body) => stripe.verifyWebhookSignature({ rawBody: raw, headers: h, secret: s });
  assert.equal(v({ 'Stripe-Signature': sig }).ok, true);
  assert.equal(v({ 'stripe-signature': sig }, SECRET, body + ' ').reason, 'bad_signature');
  assert.equal(v({ 'stripe-signature': sig }, 'other').reason, 'bad_signature');
  assert.equal(v({}).reason, 'missing_signature');
  assert.equal(v({ 'stripe-signature': 'garbage' }).reason, 'malformed_signature');
  assert.equal(v({ 'stripe-signature': stripe.signForTest({ rawBody: body, secret: SECRET, t: Math.floor(Date.now() / 1000) - 3600 }) }).reason, 'stale');
  assert.equal(v({ 'stripe-signature': sig }, '').reason, 'not_configured');
}
// ---- form encoding ----
assert.equal(
  decodeURIComponent(stripe.formEncode({ a: 1, b: { c: 'x' }, d: ['card'], e: [{ q: 1, p: { n: 2 } }] })),
  'a=1&b[c]=x&d[0]=card&e[0][q]=1&e[0][p][n]=2',
);
assert.equal(stripe.configStatus({ STRIPE_SECRET_KEY: 'rk_live_abc', STRIPE_WEBHOOK_SECRET: 'whsec_x' }).ready, true);
assert.equal(stripe.configStatus({ STRIPE_SECRET_KEY: 'rk_live_abc' }).ready, false);
assert.equal(stripe.configStatus({ STRIPE_SECRET_KEY: 'pk_live_abc', STRIPE_WEBHOOK_SECRET: 'x' }).ready, false);

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc', STRIPE_SECRET_KEY: 'sk_test_abc123', STRIPE_WEBHOOK_SECRET: SECRET };

function setup({ env = ENV, user = KEVIN, paid = 'paid', amountTotal = null } = {}) {
  const db = memoryDb();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.headers.Authorization, 'Bearer sk_test_abc123');
    if (init.method === 'POST') {
      assert.ok(init.headers['Idempotency-Key']);
      const p = new URLSearchParams(init.body);
      assert.equal(p.get('mode'), 'payment');
      assert.equal(p.get('line_items[0][price_data][currency]'), 'usd');
      assert.equal(p.get('client_reference_id'), user.id);
      return { ok: true, status: 200, json: async () => ({ id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/x', amount_total: Number(p.get('line_items[0][price_data][unit_amount]')) }) };
    }
    const row = db.tables.combo_credit_checkouts[0];
    return { ok: true, status: 200, json: async () => ({ id: SESSION_ID, payment_status: paid, payment_intent: 'pi_1', amount_total: amountTotal != null ? amountTotal : Math.round(Number(row.amount_usd) * 100) }) };
  };
  const createClient = (_u, key) => ({
    from: db.from,
    auth: { getUser: async (tok) => (tok === 'good' && key === 'anon' ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
  });
  checkout.setDeps({ env, createClient, fetchImpl });
  webhook.setDeps({ env, createClient, fetchImpl });
  return { db, calls };
}
function hookReq(event, { secret = SECRET, t } = {}) {
  const rawBody = JSON.stringify(event);
  return { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': stripe.signForTest({ rawBody, secret, t }) }, rawBody };
}
const authed = (method, body) => ({ method, headers: { authorization: 'Bearer good', host: 'www.aibetbuilder.io' }, body });
async function run(h, req) { const res = mockRes(); await h(req, res); return res; }
const sessionEvent = (type, extra = {}) => ({ id: 'evt_1', type, data: { object: { id: SESSION_ID, object: 'checkout.session', payment_status: 'paid', amount_total: 2500, currency: 'usd', payment_intent: 'pi_1', metadata: { user_id: STRANGER.id }, ...extra } } });
const ledger = (db) => db.tables.combo_credit_ledger;
const balance = (db) => ledger(db).reduce((s, r) => s + Math.round(r.amount_usd * 100), 0) / 100;

(async () => {
  // ---- checkout endpoint ----
  {
    setup({ user: STRANGER });
    assert.equal((await run(checkout, authed('POST', { amount: 25 }))).statusCode, 403);
    setup();
    assert.equal((await run(checkout, { method: 'POST', headers: {}, body: { amount: 25 } })).statusCode, 401);
    const { db } = setup();
    const g = await run(checkout, authed('GET'));
    assert.equal(g.statusCode, 200); assert.equal(g.body.configured, true);
    assert.ok(!JSON.stringify(g.body).includes('sk_test'));
    assert.equal((await run(checkout, authed('POST', { amount: 7 }))).statusCode, 400);
    const r = await run(checkout, authed('POST', { amount: 25 }));
    assert.equal(r.statusCode, 200); assert.equal(r.body.url, 'https://checkout.stripe.com/c/pay/x');
    const row = db.tables.combo_credit_checkouts[0];
    assert.equal(row.provider, 'stripe'); assert.equal(row.amount_usd, 25); assert.equal(row.user_id, KEVIN.id);
    setup({ env: { ...ENV, STRIPE_WEBHOOK_SECRET: '' } });
    const nc = await run(checkout, authed('POST', { amount: 25 }));
    assert.equal(nc.statusCode, 503); assert.equal(nc.body.code, 'not_configured');
    // rate limit
    const s = setup();
    for (let i = 0; i < 6; i += 1) s.db.tables.combo_credit_checkouts.push({ id: 'x' + i, user_id: KEVIN.id, created_at: new Date().toISOString() });
    assert.equal((await run(checkout, authed('POST', { amount: 10 }))).statusCode, 429);
  }

  // ---- webhook: credit once ----
  {
    const { db } = setup();
    await run(checkout, authed('POST', { amount: 25 }));
    const bad = hookReq(sessionEvent('checkout.session.completed'), { secret: 'wrong' });
    assert.equal((await run(webhook, bad)).statusCode, 400);
    assert.equal(ledger(db).length, 0);
    const r1 = await run(webhook, hookReq(sessionEvent('checkout.session.completed')));
    assert.equal(r1.statusCode, 200); assert.equal(r1.body.credited, true);
    const r2 = await run(webhook, hookReq(sessionEvent('checkout.session.completed')));
    assert.equal(r2.body.credited, false); assert.equal(r2.body.duplicate, true);
    const r3 = await run(webhook, hookReq(sessionEvent('checkout.session.async_payment_succeeded')));
    assert.equal(r3.body.credited, false);
    assert.equal(ledger(db).length, 1);
    assert.equal(ledger(db)[0].user_id, KEVIN.id); // from our row, not event metadata
    assert.equal(balance(db), 25);
    assert.equal(db.tables.combo_credit_checkouts[0].status, 'COMPLETED');
    assert.equal(db.tables.combo_credit_checkouts[0].payment_intent, 'pi_1');

    // ---- refunds: subtract once, delta per cumulative amount ----
    const charge = (refunded) => ({ id: 'evt_r', type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_1', amount: 2500, amount_refunded: refunded } } });
    await run(webhook, hookReq(charge(1000)));
    await run(webhook, hookReq(charge(1000)));
    assert.equal(balance(db), 15);
    assert.equal(db.tables.combo_credit_checkouts[0].status, 'PARTIALLY_REFUNDED');
    await run(webhook, hookReq(charge(2500)));
    await run(webhook, hookReq(charge(2500)));
    await run(webhook, hookReq(charge(9999)));
    assert.equal(balance(db), 0);
    assert.equal(ledger(db).filter((r) => r.kind === 'refund').length, 2);
    assert.equal(db.tables.combo_credit_checkouts[0].status, 'REFUNDED');

    // ---- dispute: flag, no clawback ----
    const d = await run(webhook, hookReq({ id: 'evt_d', type: 'charge.dispute.created', data: { object: { id: 'dp_1', payment_intent: 'pi_1', charge: 'ch_1' } } }));
    assert.equal(d.body.flagged, true);
    const row = db.tables.combo_credit_checkouts[0];
    assert.equal(row.status, 'DISPUTED'); assert.equal(row.dispute_id, 'dp_1'); assert.ok(row.disputed_at);
    assert.equal(ledger(db).length, 3);
  }

  // ---- unpaid session waits; mismatch/unknown never credits ----
  {
    const { db } = setup({ paid: 'unpaid' });
    await run(checkout, authed('POST', { amount: 50 }));
    const r = await run(webhook, hookReq(sessionEvent('checkout.session.completed', { payment_status: 'unpaid', amount_total: 5000 })));
    assert.equal(r.body.reason, 'awaiting_payment');
    assert.equal(db.tables.combo_credit_checkouts[0].status, 'PENDING');
    const r2 = await run(webhook, hookReq(sessionEvent('checkout.session.async_payment_succeeded', { amount_total: 5000 })));
    assert.equal(r2.statusCode, 409); // Stripe still says unpaid
    assert.equal(ledger(db).length, 0);
  }
  {
    const { db } = setup();
    await run(checkout, authed('POST', { amount: 10 }));
    const r = await run(webhook, hookReq(sessionEvent('checkout.session.completed', { amount_total: 100000 })));
    assert.equal(r.body.reason, 'mismatch'); assert.equal(ledger(db).length, 0);
    const u = await run(webhook, hookReq(sessionEvent('checkout.session.completed', { id: 'cs_unknown' })));
    assert.equal(u.body.ignored, 'unknown session'); assert.equal(ledger(db).length, 0);
    const o = await run(webhook, hookReq({ id: 'e', type: 'customer.created', data: { object: {} } }));
    assert.equal(o.statusCode, 200); assert.equal(ledger(db).length, 0);
  }
  {
    setup({ env: { ...ENV, STRIPE_WEBHOOK_SECRET: '' } });
    assert.equal((await run(webhook, hookReq(sessionEvent('checkout.session.completed')))).statusCode, 503);
  }
  console.log('stripe-webhook.test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
