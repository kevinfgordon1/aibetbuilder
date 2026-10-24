'use strict';
// Shared gate for cron-only API routes (fetch-odds, fetch-futures,
// fetch-player-props, scan-ev-parlays). Allowed callers:
//   1. Vercel cron — sends "Authorization: Bearer <CRON_SECRET>".
//   2. The owner's signed-in Supabase session (manual refresh/testing).
// Everything else gets 401/403 so outsiders can't burn Odds API credits or
// trigger @evparlaysbot sends. If CRON_SECRET is unset, only the owner passes.
const crypto = require('node:crypto');
const { readBearer, isComboOwner } = require('../api/combo-probe-lib');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function requireCronOrOwner(req, deps = {}) {
  const env = deps.env || process.env;
  const token = readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'cron auth' };
  const sec = env.CRON_SECRET;
  if (sec && safeEqual(token, sec)) return { ok: true, via: 'cron' };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 401, error: 'cron auth' };
  try {
    const createClient = deps.createClient || require('@supabase/supabase-js').createClient;
    const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await sb.auth.getUser(token);
    const user = data && data.user;
    if (error || !user) return { ok: false, status: 401, error: 'cron auth' };
    if (!isComboOwner(user)) return { ok: false, status: 403, error: 'Not allowed' };
    return { ok: true, via: 'owner', user };
  } catch (_) {
    return { ok: false, status: 401, error: 'cron auth' };
  }
}

// Returns true if the request may proceed; otherwise writes the error response.
async function guardCron(req, res, deps) {
  const r = await requireCronOrOwner(req, deps);
  if (r.ok) return true;
  res.status(r.status).json({ success: false, error: r.error });
  return false;
}

module.exports = { requireCronOrOwner, guardCron };
