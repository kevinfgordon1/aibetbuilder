// Minimal Stripe REST client (no SDK) for Combo Locks card credits.
// The secret key comes only from STRIPE_SECRET_KEY and is never logged or
// returned. Webhook signatures use Stripe's scheme: Stripe-Signature
// "t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>", 5-minute window.
'use strict';

const crypto = require('node:crypto');

const API_BASE = 'https://api.stripe.com/v1';
const MAX_WEBHOOK_AGE_SEC = 300;

class StripeError extends Error {
  constructor(message, status) { super(message); this.name = 'StripeError'; this.status = status; }
}

function readEnv(env) {
  const e = env || process.env;
  return {
    secretKey: String(e.STRIPE_SECRET_KEY || '').trim(),
    webhookSecret: String(e.STRIPE_WEBHOOK_SECRET || '').trim(),
  };
}

function configStatus(env) {
  const { secretKey, webhookSecret } = readEnv(env);
  const keyOk = /^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(secretKey);
  return { ready: keyOk && !!webhookSecret, hasKey: keyOk, hasWebhookSecret: !!webhookSecret };
}

/** Stripe form encoding with nested brackets: {a:{b:1}} -> a[b]=1, arrays -> a[0][x]. */
function formEncode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => {
      if (item && typeof item === 'object') formEncode(item, `${key}[${i}]`, out);
      else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
    });
    else if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

async function call({ env, fetchImpl, method, path, params, idempotencyKey }) {
  const { secretKey } = readEnv(env);
  if (!secretKey) throw new StripeError('stripe not configured', 503);
  const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const init = { method, headers };
  if (params && method !== 'GET') init.body = formEncode(params);
  const r = await (fetchImpl || fetch)(`${API_BASE}${path}`, init);
  let body = null;
  try { body = await r.json(); } catch (_) { body = null; }
  if (!r.ok) {
    const type = body && body.error && body.error.type;
    throw new StripeError(`stripe ${method} ${path.split('/').slice(0, 3).join('/')} failed (${r.status}${type ? ` ${type}` : ''})`, r.status);
  }
  return body || {};
}

async function createCheckoutSession({ env, fetchImpl, amountUsd, userId, successUrl, cancelUrl, idempotencyKey }) {
  const cents = Math.round(Number(amountUsd) * 100);
  return call({
    env, fetchImpl, method: 'POST', path: '/checkout/sessions', idempotencyKey,
    params: {
      mode: 'payment',
      payment_method_types: ['card'],
      client_reference_id: userId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [{
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `Combo Locks credits ($${Number(amountUsd)})` } },
      }],
      metadata: { purpose: 'combo_credits', user_id: userId, amount_usd: Number(amountUsd).toFixed(2) },
      payment_intent_data: { metadata: { purpose: 'combo_credits', user_id: userId } },
    },
  });
}

async function getCheckoutSession({ env, fetchImpl, id }) {
  return call({ env, fetchImpl, method: 'GET', path: `/checkout/sessions/${encodeURIComponent(id)}` });
}

function headerValue(headers, name) {
  const h = headers || {};
  const want = name.toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === want) return Array.isArray(h[k]) ? h[k][0] : h[k];
  return undefined;
}

function verifyWebhookSignature({ rawBody, headers, secret, nowMs = Date.now(), maxAgeSec = MAX_WEBHOOK_AGE_SEC }) {
  if (!secret) return { ok: false, reason: 'not_configured' };
  const header = headerValue(headers, 'stripe-signature');
  if (!header) return { ok: false, reason: 'missing_signature' };
  let t = null;
  const v1 = [];
  for (const part of String(header).split(',')) {
    const [k, v] = part.split('=');
    if (k && v) { if (k.trim() === 't') t = Number(v); else if (k.trim() === 'v1') v1.push(v.trim()); }
  }
  if (!Number.isFinite(t) || !v1.length) return { ok: false, reason: 'malformed_signature' };
  if (Math.abs(nowMs / 1000 - t) > maxAgeSec) return { ok: false, reason: 'stale' };
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest();
  const good = v1.some((s) => {
    if (!/^[0-9a-f]{64}$/i.test(s)) return false;
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
  return good ? { ok: true, t } : { ok: false, reason: 'bad_signature' };
}

function signForTest({ rawBody, secret, t = Math.floor(Date.now() / 1000) }) {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return `t=${t},v1=${sig}`;
}

module.exports = {
  API_BASE, StripeError, readEnv, configStatus, formEncode, call,
  createCheckoutSession, getCheckoutSession, verifyWebhookSignature, signForTest,
};
