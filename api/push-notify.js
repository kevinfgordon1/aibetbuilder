'use strict';
// POST /api/push-notify  { userId, kind: lock_filled|outbid|ev_boost, payload }
// Caller: combo-worker / ev-parlay worker with "Authorization: Bearer <PUSH_NOTIFY_SECRET>".
// Does nothing unless PUSH_NOTIFICATIONS_ENABLED=1 (default off).
const crypto = require('node:crypto');
const { sendPushAlert, pushEnabled, ALERTS } = require('../lib/push-alerts');

function safeEqual(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

async function handler(req, res, deps = {}) {
  const env = deps.env || process.env;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const auth = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  if (!env.PUSH_NOTIFY_SECRET || !auth || !safeEqual(auth, env.PUSH_NOTIFY_SECRET)) return res.status(401).json({ error: 'auth' });
  if (!pushEnabled(env)) return res.status(200).json({ sent: 0, skipped: 'disabled' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!body.userId || !ALERTS[body.kind]) return res.status(400).json({ error: 'userId and kind required' });
  const createClient = deps.createClient || require('@supabase/supabase-js').createClient;
  const supabase = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const r = await sendPushAlert({ supabase, userId: body.userId, kind: body.kind, payload: body.payload || {} }, { env, fetch: deps.fetch });
  return res.status(200).json(r);
}
module.exports = handler;
module.exports.handler = handler;
