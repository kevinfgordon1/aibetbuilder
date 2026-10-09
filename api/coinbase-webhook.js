// POST /api/coinbase-webhook — Coinbase Business checkout events.
//
// Coinbase Commerce (X-CC-Webhook-Signature) was shut down 2026-03-31; this
// endpoint verifies the Coinbase Business / CDP webhook signature instead:
// X-Hook0-Signature (HMAC-SHA256 with COINBASE_WEBHOOK_SECRET, 5-minute window).
//
// Credits a user ONLY when:
//   1. the signature is valid,
//   2. eventType is checkout.payment.success and status is COMPLETED,
//   3. the checkout id is one WE created (combo_credit_checkouts) — the user
//      and amount come from our row, never from webhook metadata,
//   4. amount/currency match our row, and
//   5. a fresh GET /checkouts/{id} from Coinbase also says COMPLETED.
// Idempotent per checkout id: the ledger has unique (source, source_ref), so a
// retried or replayed event can never credit twice.
// checkout.refund.success writes a negative 'refund' row per refund id.
'use strict';

const coinbase = require('../lib/coinbase-business');

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, fetchImpl: (...a) => fetch(...a), now: () => Date.now() });
let deps = freshDeps();
function setDeps(patch) { deps = { ...deps, ...patch }; }
function resetDeps() { deps = freshDeps(); }

const DEPOSIT_SOURCE = 'coinbase_checkout';
const REFUND_SOURCE = 'coinbase_refund';
const MAX_BODY = 256 * 1024;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function serviceClient() {
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return deps.createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Exact bytes Coinbase signed. Read the stream before anything touches req.body. */
async function readRawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.on === 'function' && !req.readableEnded) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error('body too large')); return; }
        chunks.push(Buffer.from(c));
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  const b = req.body;
  if (typeof b === 'string') return b;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  return b == null ? '' : JSON.stringify(b);
}

const isDuplicate = (error) => !!error && (String(error.code) === '23505' || /duplicate key|unique/i.test(String(error.message || '')));
const sameMoney = (a, b) => Math.round(Number(a) * 100) === Math.round(Number(b) * 100);

function unwrap(event) {
  if (!event || typeof event !== 'object') return {};
  if (event.eventType || event.event_type) return event;
  for (const k of ['data', 'payload', 'event']) {
    if (event[k] && typeof event[k] === 'object' && (event[k].eventType || event[k].id)) {
      return { eventType: event.eventType || event.event_type || event[k].eventType, ...event[k] };
    }
  }
  return event;
}

async function updateCheckout(client, id, patch) {
  const { error } = await client.from('combo_credit_checkouts')
    .update({ ...patch, updated_at: new Date(deps.now()).toISOString() })
    .eq('id', id);
  if (error) throw new Error('checkout update failed');
}

async function handlePaid(client, ev, row, env) {
  // Even if row.status is already COMPLETED we fall through: the ledger's
  // unique (source, source_ref) turns a second insert into a no-op.
  if (String(ev.currency || 'USDC').toUpperCase() !== String(row.currency || 'USDC').toUpperCase() || (ev.amount != null && !sameMoney(ev.amount, row.amount_usd))) {
    await updateCheckout(client, row.id, { status: 'MISMATCH' });
    console.error('[coinbase-webhook] amount/currency mismatch for checkout', row.id);
    return { status: 200, body: { ok: true, credited: false, reason: 'mismatch' } };
  }
  // Defense in depth: ask Coinbase directly.
  let fresh;
  try {
    fresh = await coinbase.getCheckout({ env, fetchImpl: deps.fetchImpl, id: row.id });
  } catch (_) {
    return { status: 502, body: { ok: false, error: 'could not confirm with Coinbase; retry' } };
  }
  if (String(fresh.status || '').toUpperCase() !== 'COMPLETED') {
    return { status: 409, body: { ok: false, credited: false, reason: 'not_completed_yet' } };
  }
  const txHash = String(fresh.transactionHash || ev.transactionHash || '').slice(0, 120) || null;
  const ins = await client.from('combo_credit_ledger').insert({
    user_id: row.user_id,
    kind: 'deposit',
    amount_usd: Number(row.amount_usd),
    source: DEPOSIT_SOURCE,
    source_ref: row.id,
    note: `USDC on ${String(row.network || 'base')}`,
    meta: { tx_hash: txHash, network: row.network || 'base', settlement: fresh.settlement || ev.settlement || null },
  });
  const duplicate = isDuplicate(ins.error);
  if (ins.error && !duplicate) throw new Error('ledger insert failed');
  await updateCheckout(client, row.id, { status: 'COMPLETED', tx_hash: txHash, completed_at: new Date(deps.now()).toISOString() });
  return { status: 200, body: { ok: true, credited: !duplicate, duplicate } };
}

async function handleRefund(client, ev, row) {
  const refunds = Array.isArray(ev.refunds) ? ev.refunds : [];
  let written = 0;
  for (const r of refunds) {
    if (!r || !r.id || String(r.status || '').toUpperCase() !== 'COMPLETED') continue;
    const amt = Number(r.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const ins = await client.from('combo_credit_ledger').insert({
      user_id: row.user_id,
      kind: 'refund',
      amount_usd: -Math.min(amt, Number(row.amount_usd)),
      source: REFUND_SOURCE,
      source_ref: String(r.id).slice(0, 120),
      note: 'Refunded in USDC',
      meta: { checkout_id: row.id, tx_hash: r.transactionHash || null },
    });
    if (ins.error && !isDuplicate(ins.error)) throw new Error('refund insert failed');
    if (!ins.error) written += 1;
  }
  await updateCheckout(client, row.id, { status: String(ev.status || 'REFUNDED').toUpperCase().slice(0, 20) });
  return { status: 200, body: { ok: true, refunds: written } };
}

async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });
  const env = deps.env || process.env;
  const { webhookSecret } = coinbase.readEnv(env);
  if (!webhookSecret) return json(res, 503, { ok: false, error: 'not configured' });

  let raw;
  try { raw = await readRawBody(req); } catch (_) { return json(res, 413, { ok: false, error: 'bad body' }); }
  const check = coinbase.verifyWebhookSignature({ rawBody: raw, headers: req.headers || {}, secret: webhookSecret, nowMs: deps.now() });
  if (!check.ok) return json(res, 401, { ok: false, error: 'invalid signature' });

  let event;
  try { event = unwrap(JSON.parse(raw)); } catch (_) { return json(res, 400, { ok: false, error: 'bad json' }); }
  const type = String(event.eventType || event.event_type || '');
  const id = String(event.id || '');
  if (!type.startsWith('checkout.') || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return json(res, 200, { ok: true, ignored: 'not a checkout event' });
  }

  const client = serviceClient();
  if (!client) return json(res, 503, { ok: false, error: 'not configured' });
  try {
    const { data: row, error } = await client.from('combo_credit_checkouts').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error('checkout lookup failed');
    if (!row) return json(res, 200, { ok: true, ignored: 'unknown checkout' });

    const status = String(event.status || '').toUpperCase();
    let out;
    if (type === 'checkout.payment.success' && status === 'COMPLETED') {
      out = await handlePaid(client, event, row, env);
    } else if (type === 'checkout.payment.failed' || type === 'checkout.payment.expired') {
      if (row.status !== 'COMPLETED') await updateCheckout(client, id, { status: status || (type.endsWith('expired') ? 'EXPIRED' : 'FAILED') });
      out = { status: 200, body: { ok: true, credited: false } };
    } else if (type === 'checkout.refund.success') {
      out = await handleRefund(client, event, row);
    } else {
      out = { status: 200, body: { ok: true, ignored: type } };
    }
    return json(res, out.status, out.body);
  } catch (err) {
    console.error('[coinbase-webhook]', type, String((err && err.message) || err).slice(0, 200));
    return json(res, 500, { ok: false, error: 'server error' });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.setDeps = setDeps;
module.exports.resetDeps = resetDeps;
module.exports.readRawBody = readRawBody;
