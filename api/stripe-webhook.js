// POST /api/stripe-webhook — Stripe events for Combo Locks card credits.
//
// Verifies Stripe-Signature with STRIPE_WEBHOOK_SECRET (5-minute window).
//   checkout.session.completed (payment_status paid) and
//   checkout.session.async_payment_succeeded -> credit the ledger ONCE, only when
//     the session id is one WE created (combo_credit_checkouts, provider stripe),
//     amount/currency match our row, and a fresh GET of the session from Stripe
//     also says paid. User and amount come from our row, never event metadata.
//   charge.refunded -> one negative 'refund' row per new cumulative refunded
//     amount on that charge (delta only), capped at the original deposit.
//   charge.dispute.created -> flag the checkout (status DISPUTED, disputed_at,
//     dispute_id). Credits are not clawed back automatically.
// Idempotent: the ledger's unique (source, source_ref) means retried or
// replayed events can never credit or refund twice.
'use strict';

const stripe = require('../lib/stripe-api');
const { readRawBody } = require('./coinbase-webhook');

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, fetchImpl: (...a) => fetch(...a), now: () => Date.now() });
let deps = freshDeps();
function setDeps(patch) { deps = { ...deps, ...patch }; }
function resetDeps() { deps = freshDeps(); }

const DEPOSIT_SOURCE = 'stripe_checkout';
const REFUND_SOURCE = 'stripe_refund';

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

const isDuplicate = (error) => !!error && (String(error.code) === '23505' || /duplicate key|unique/i.test(String(error.message || '')));
const toCents = (usd) => Math.round(Number(usd) * 100);
const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || null;
const SAFE_ID = /^[A-Za-z0-9_]{1,255}$/;

async function updateCheckout(client, id, patch) {
  const { error } = await client.from('combo_credit_checkouts')
    .update({ ...patch, updated_at: new Date(deps.now()).toISOString() })
    .eq('id', id);
  if (error) throw new Error('checkout update failed');
}

async function findStripeRow(client, col, value) {
  const { data, error } = await client.from('combo_credit_checkouts').select('*').eq(col, value).eq('provider', 'stripe').maybeSingle();
  if (error) throw new Error('checkout lookup failed');
  return data || null;
}

async function handleSession(client, type, session, env) {
  const id = String(session.id || '');
  if (!SAFE_ID.test(id)) return { status: 200, body: { ok: true, ignored: 'bad session id' } };
  const row = await findStripeRow(client, 'id', id);
  if (!row) return { status: 200, body: { ok: true, ignored: 'unknown session' } };
  const pi = idOf(session.payment_intent);

  if (type === 'checkout.session.completed' && session.payment_status !== 'paid') {
    // Delayed payment method: wait for async_payment_succeeded.
    if (row.status !== 'COMPLETED') await updateCheckout(client, id, { status: 'PENDING', payment_intent: pi });
    return { status: 200, body: { ok: true, credited: false, reason: 'awaiting_payment' } };
  }
  if (toCents(row.amount_usd) !== Number(session.amount_total) || String(session.currency || '').toLowerCase() !== 'usd') {
    await updateCheckout(client, id, { status: 'MISMATCH' });
    console.error('[stripe-webhook] amount/currency mismatch for checkout', id);
    return { status: 200, body: { ok: true, credited: false, reason: 'mismatch' } };
  }
  // Defense in depth: ask Stripe directly.
  let fresh;
  try { fresh = await stripe.getCheckoutSession({ env, fetchImpl: deps.fetchImpl, id }); } catch (_) {
    return { status: 502, body: { ok: false, error: 'could not confirm with Stripe; retry' } };
  }
  if (fresh.payment_status !== 'paid' || toCents(row.amount_usd) !== Number(fresh.amount_total)) {
    return { status: 409, body: { ok: false, credited: false, reason: 'not_paid_yet' } };
  }
  const paymentIntent = idOf(fresh.payment_intent) || pi;
  const ins = await client.from('combo_credit_ledger').insert({
    user_id: row.user_id,
    kind: 'deposit',
    amount_usd: Number(row.amount_usd),
    source: DEPOSIT_SOURCE,
    source_ref: id,
    note: 'Card via Stripe',
    meta: { payment_intent: paymentIntent },
  });
  const duplicate = isDuplicate(ins.error);
  if (ins.error && !duplicate) throw new Error('ledger insert failed');
  await updateCheckout(client, id, { status: 'COMPLETED', payment_intent: paymentIntent, completed_at: new Date(deps.now()).toISOString() });
  return { status: 200, body: { ok: true, credited: !duplicate, duplicate } };
}

async function handleRefund(client, charge) {
  const pi = idOf(charge.payment_intent);
  const chargeId = String(charge.id || '');
  if (!pi || !SAFE_ID.test(pi) || !SAFE_ID.test(chargeId)) return { status: 200, body: { ok: true, ignored: 'no payment intent' } };
  const row = await findStripeRow(client, 'payment_intent', pi);
  if (!row) return { status: 200, body: { ok: true, ignored: 'unknown payment' } };
  const depositCents = toCents(row.amount_usd);
  const refundedCents = Math.min(Number(charge.amount_refunded) || 0, depositCents);
  if (refundedCents <= 0) return { status: 200, body: { ok: true, refunds: 0 } };

  const prev = await client.from('combo_credit_ledger').select('source_ref,amount_usd').eq('user_id', row.user_id).eq('source', REFUND_SOURCE);
  if (prev.error) throw new Error('refund lookup failed');
  const already = (prev.data || [])
    .filter((r) => String(r.source_ref || '').startsWith(`${chargeId}:`))
    .reduce((s, r) => s + Math.abs(toCents(r.amount_usd)), 0);
  const delta = refundedCents - already;
  let written = 0;
  if (delta > 0) {
    const ins = await client.from('combo_credit_ledger').insert({
      user_id: row.user_id,
      kind: 'refund',
      amount_usd: -(delta / 100),
      source: REFUND_SOURCE,
      source_ref: `${chargeId}:${refundedCents}`,
      note: 'Refunded to card',
      meta: { checkout_id: row.id, payment_intent: pi, charge_id: chargeId },
    });
    if (ins.error && !isDuplicate(ins.error)) throw new Error('refund insert failed');
    if (!ins.error) written = 1;
  }
  await updateCheckout(client, row.id, { status: refundedCents >= depositCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED' });
  return { status: 200, body: { ok: true, refunds: written } };
}

async function handleDispute(client, dispute) {
  const pi = idOf(dispute.payment_intent);
  if (!pi || !SAFE_ID.test(pi)) return { status: 200, body: { ok: true, ignored: 'no payment intent' } };
  const row = await findStripeRow(client, 'payment_intent', pi);
  if (!row) return { status: 200, body: { ok: true, ignored: 'unknown payment' } };
  const disputeId = String(dispute.id || '').slice(0, 255) || null;
  await updateCheckout(client, row.id, { status: 'DISPUTED', disputed_at: new Date(deps.now()).toISOString(), dispute_id: disputeId });
  console.warn('[stripe-webhook] dispute opened on checkout', row.id, 'user', row.user_id);
  return { status: 200, body: { ok: true, flagged: true } };
}

async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });
  const env = deps.env || process.env;
  const { webhookSecret } = stripe.readEnv(env);
  if (!webhookSecret) return json(res, 503, { ok: false, error: 'not configured' });

  let raw;
  try { raw = await readRawBody(req); } catch (_) { return json(res, 413, { ok: false, error: 'bad body' }); }
  const check = stripe.verifyWebhookSignature({ rawBody: raw, headers: req.headers || {}, secret: webhookSecret, nowMs: deps.now() });
  if (!check.ok) return json(res, 400, { ok: false, error: 'invalid signature' });

  let event;
  try { event = JSON.parse(raw); } catch (_) { return json(res, 400, { ok: false, error: 'bad json' }); }
  const type = String((event && event.type) || '');
  const obj = (event && event.data && event.data.object) || {};
  const handled = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded', 'charge.dispute.created'];
  if (!handled.includes(type)) return json(res, 200, { ok: true, ignored: type || 'unknown' });

  const client = serviceClient();
  if (!client) return json(res, 503, { ok: false, error: 'not configured' });
  try {
    let out;
    if (type.startsWith('checkout.session.')) out = await handleSession(client, type, obj, env);
    else if (type === 'charge.refunded') out = await handleRefund(client, obj);
    else out = await handleDispute(client, obj);
    return json(res, out.status, out.body);
  } catch (err) {
    console.error('[stripe-webhook]', type, String((err && err.message) || err).slice(0, 200));
    return json(res, 500, { ok: false, error: 'server error' });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.setDeps = setDeps;
module.exports.resetDeps = resetDeps;
