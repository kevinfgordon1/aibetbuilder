'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const coinbase = require('../lib/coinbase-business');
const webhook = require('./coinbase-webhook.js');
const credits = require('./combo-credits.js');

const SECRET = 'whsec_test_only';
const KEVIN = { id: '79ae1610-097e-4b46-a622-1e952f18e936', email: 'kev120909@gmail.com' };
const STRANGER = { id: '00000000-0000-0000-0000-000000000001', email: 'someone@example.com' };

// ---- JWT (Ed25519 CDP key) ----
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const jwk = privateKey.export({ format: 'jwk' });
const seed = Buffer.from(jwk.d, 'base64url');
const pub = Buffer.from(jwk.x, 'base64url');
const KEY_SECRET = Buffer.concat([seed, pub]).toString('base64');
{
  const jwt = coinbase.buildJwt({ keyId: 'kid-1', keySecret: KEY_SECRET, method: 'post', path: '/api/v1/checkouts', now: 1_700_000_000_000 });
  const [h, p, s] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(header.alg, 'EdDSA');
  assert.equal(header.kid, 'kid-1');
  assert.match(header.nonce, /^[0-9a-f]{32}$/);
  assert.equal(claims.iss, 'cdp');
  assert.equal(claims.sub, 'kid-1');
  assert.equal(claims.uri, 'POST business.coinbase.com/api/v1/checkouts');
  assert.deepEqual(claims.uris, ['POST business.coinbase.com/api/v1/checkouts']);
  assert.equal(claims.exp - claims.nbf, 120);
  assert.ok(crypto.verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')));
}
// ES256 PEM key also works.
{
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = ec.privateKey.export({ type: 'sec1', format: 'pem' }).replace(/\n/g, '\\n');
  const jwt = coinbase.buildJwt({ keyId: 'kid-2', keySecret: pem, method: 'GET', path: '/api/v1/checkouts/abc' });
  const [h, p, s] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'ES256');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
}

// ---- Signature verification ----
{
  const body = '{"a":1}';
  const headers = { 'content-type': 'application/json' };
  const sig = coinbase.signForTest({ rawBody: body, secret: SECRET, headers });
  assert.equal(coinbase.verifyWebhookSignature({ rawBody: body, headers: { ...headers, 'x-hook0-signature': sig }, secret: SECRET }).ok, true);
  assert.equal(coinbase.verifyWebhookSignature({ rawBody: body + ' ', headers: { ...headers, 'x-hook0-signature': sig }, secret: SECRET }).reason, 'bad_signature');
  assert.equal(coinbase.verifyWebhookSignature({ rawBody: body, headers: { ...headers, 'x-hook0-signature': sig }, secret: 'other' }).reason, 'bad_signature');
  assert.equal(coinbase.verifyWebhookSignature({ rawBody: body, headers, secret: SECRET }).reason, 'missing_signature');
  assert.equal(coinbase.verifyWebhookSignature({ rawBody: body, headers: { 'x-hook0-signature': 'garbage' }, secret: SECRET }).reason, 'malformed_signature');
  const old = coinbase.signForTest({ rawBody: body, secret: SECRET, headers, t: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(coinbase.verifyWebhookSignature({ rawBody: body, headers: { ...headers, 'X-Hook0-Signature': old }, secret: SECRET }).reason, 'stale');
  assert.equal(coinbase.verifyWebhookSignature({ rawBody: body, headers, secret: '' }).reason, 'not_configured');
}

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

const ENV = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc',
  COINBASE_CDP_API_KEY_ID: 'kid-1', COINBASE_CDP_API_KEY_SECRET: KEY_SECRET, COINBASE_WEBHOOK_SECRET: SECRET,
};

function setup({ env = ENV, user = KEVIN, coinbaseStatus = 'COMPLETED' } = {}) {
  const db = memoryDb();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    assert.match(init.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(body.currency, 'USDC');
      assert.ok(init.headers['X-Idempotency-Key']);
      return { ok: true, status: 201, json: async () => ({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', url: 'https://payments.coinbase.com/payment-links/pl_x', status: 'ACTIVE', network: 'base' }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: url.split('/').pop(), status: coinbaseStatus, transactionHash: '0xabc', settlement: { totalAmount: '25.00', feeAmount: '0.25', netAmount: '24.75', currency: 'USDC' } }) };
  };
  const createClient = (_u, key) => ({
    from: db.from,
    auth: { getUser: async (tok) => (tok === 'good' && key === 'anon' ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
  });
  credits.setDeps({ env, createClient, fetchImpl });
  webhook.setDeps({ env, createClient, fetchImpl });
  return { db, calls };
}

function hookReq(event, { secret = SECRET, t } = {}) {
  const rawBody = JSON.stringify(event);
  const headers = { 'content-type': 'application/json' };
  headers['x-hook0-signature'] = coinbase.signForTest({ rawBody, secret, headers, t });
  return { method: 'POST', headers, rawBody };
}

const paidEvent = (over = {}) => ({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', eventType: 'checkout.payment.success', status: 'COMPLETED', amount: '25.00', currency: 'USDC', network: 'base', metadata: { user_id: STRANGER.id }, transactionHash: '0xabc', ...over });

(async () => {
  // --- /api/combo-credits ---
  {
    // Not configured: GET says configured:false, POST 503 coming soon; no secrets in body.
    setup({ env: { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc' } });
    let res = mockRes();
    await credits({ method: 'GET', headers: { authorization: 'Bearer good' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.configured, false);
    res = mockRes();
    await credits({ method: 'POST', headers: { authorization: 'Bearer good' }, body: { amount: 25 } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'not_configured');
  }
  {
    setup({ user: STRANGER });
    const res = mockRes();
    await credits({ method: 'GET', headers: { authorization: 'Bearer good' } }, res);
    assert.equal(res.statusCode, 403);
    const res2 = mockRes();
    await credits({ method: 'GET', headers: {} }, res2);
    assert.equal(res2.statusCode, 401);
  }
  const { db, calls } = setup();
  {
    let res = mockRes();
    await credits({ method: 'GET', headers: { authorization: 'Bearer good' } }, res);
    assert.equal(res.body.configured, true);
    assert.ok(!JSON.stringify(res.body).includes(KEY_SECRET) && !JSON.stringify(res.body).includes(SECRET));
    res = mockRes();
    await credits({ method: 'POST', headers: { authorization: 'Bearer good', host: 'aibetbuilder.io' }, body: { amount: 7 } }, res);
    assert.equal(res.statusCode, 400);
    res = mockRes();
    await credits({ method: 'POST', headers: { authorization: 'Bearer good', host: 'aibetbuilder.io' }, body: JSON.stringify({ amount: 25 }) }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.url, 'https://payments.coinbase.com/payment-links/pl_x');
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.amount, '25.00');
    assert.equal(sent.successRedirectUrl, 'https://aibetbuilder.io/?credits=paid#combo');
    assert.equal(db.tables.combo_credit_checkouts.length, 1);
    assert.equal(db.tables.combo_credit_checkouts[0].user_id, KEVIN.id);
    assert.equal(db.tables.combo_credit_ledger.length, 0, 'creating a checkout never credits');
  }

  // --- /api/coinbase-webhook ---
  {
    // Bad signature -> 401, nothing credited.
    let res = mockRes();
    await webhook(hookReq(paidEvent(), { secret: 'wrong' }), res);
    assert.equal(res.statusCode, 401);
    // Unsigned.
    res = mockRes();
    await webhook({ method: 'POST', headers: {}, rawBody: JSON.stringify(paidEvent()) }, res);
    assert.equal(res.statusCode, 401);
    // Tampered body after signing.
    const req = hookReq(paidEvent());
    req.rawBody = req.rawBody.replace('25.00', '100.00');
    res = mockRes();
    await webhook(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(db.tables.combo_credit_ledger.length, 0);
  }
  {
    // Pending/processing or failed events never credit.
    let res = mockRes();
    await webhook(hookReq(paidEvent({ eventType: 'checkout.payment.failed', status: 'FAILED' })), res);
    assert.equal(res.statusCode, 200);
    assert.equal(db.tables.combo_credit_ledger.length, 0);
    res = mockRes();
    await webhook(hookReq(paidEvent({ status: 'PROCESSING' })), res);
    assert.equal(db.tables.combo_credit_ledger.length, 0);
  }
  {
    // Amount mismatch -> no credit.
    const res = mockRes();
    await webhook(hookReq(paidEvent({ amount: '100.00' })), res);
    assert.equal(res.body.reason, 'mismatch');
    assert.equal(db.tables.combo_credit_ledger.length, 0);
    db.tables.combo_credit_checkouts[0].status = 'ACTIVE';
  }
  {
    // Unknown checkout id -> ignored.
    const res = mockRes();
    await webhook(hookReq(paidEvent({ id: 'bbbbbbbbbbbbbbbbbbbbbbbb' })), res);
    assert.equal(res.body.ignored, 'unknown checkout');
  }
  {
    // Confirmed: credits OUR user (not metadata's) once; replays are no-ops.
    let res = mockRes();
    await webhook(hookReq(paidEvent()), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.credited, true);
    assert.equal(db.tables.combo_credit_ledger.length, 1);
    const row = db.tables.combo_credit_ledger[0];
    assert.equal(row.user_id, KEVIN.id);
    assert.equal(row.kind, 'deposit');
    assert.equal(row.amount_usd, 25);
    assert.equal(row.source_ref, 'aaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(db.tables.combo_credit_checkouts[0].status, 'COMPLETED');
    for (let i = 0; i < 3; i++) {
      res = mockRes();
      await webhook(hookReq(paidEvent()), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.duplicate, true);
    }
    assert.equal(db.tables.combo_credit_ledger.length, 1, 'idempotent per checkout id');
  }
  {
    // Coinbase GET disagrees (not completed) -> no credit, non-2xx so Coinbase retries.
    const s = setup({ coinbaseStatus: 'PROCESSING' });
    s.db.tables.combo_credit_checkouts.push({ id: 'cccccccccccccccccccccccc', user_id: KEVIN.id, amount_usd: 10, currency: 'USDC', network: 'base', status: 'ACTIVE' });
    const res = mockRes();
    await webhook(hookReq(paidEvent({ id: 'cccccccccccccccccccccccc', amount: '10.00' })), res);
    assert.equal(res.statusCode, 409);
    assert.equal(s.db.tables.combo_credit_ledger.length, 0);
  }
  {
    // Refund writes one negative row per refund id, idempotent.
    const s = setup();
    s.db.tables.combo_credit_checkouts.push({ id: 'dddddddddddddddddddddddd', user_id: KEVIN.id, amount_usd: 50, currency: 'USDC', network: 'base', status: 'COMPLETED' });
    const ev = { id: 'dddddddddddddddddddddddd', eventType: 'checkout.refund.success', status: 'REFUNDED', refunds: [{ id: 'r1', amount: '50.00', status: 'COMPLETED' }] };
    for (let i = 0; i < 2; i++) { const res = mockRes(); await webhook(hookReq(ev), res); assert.equal(res.statusCode, 200); }
    assert.equal(s.db.tables.combo_credit_ledger.length, 1);
    assert.equal(s.db.tables.combo_credit_ledger[0].amount_usd, -50);
  }
  {
    // Webhook secret missing -> 503, nothing processed.
    setup({ env: { ...ENV, COINBASE_WEBHOOK_SECRET: '' } });
    const res = mockRes();
    await webhook(hookReq(paidEvent()), res);
    assert.equal(res.statusCode, 503);
  }
  {
    // Raw body from a stream.
    const { Readable } = require('node:stream');
    const s = Readable.from([Buffer.from('{"x":'), Buffer.from('1}')]);
    assert.equal(await webhook.readRawBody(s), '{"x":1}');
  }
  credits.resetDeps();
  webhook.resetDeps();
  console.log('coinbase-webhook + combo-credits tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
