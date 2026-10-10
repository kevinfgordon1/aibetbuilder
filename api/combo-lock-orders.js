// /api/combo-lock-orders — edit fill odds and cancel open quotes on Combo Locks.
//
// POST JSON:
//   { action: 'edit_fill', parlay_id, fill }     fill = typed American (all-in if fee user)
//   { action: 'cancel_quote', submission_id }
//   { action: 'cancel_all_open', parlay_id }
//
// Auth: bearer session. Actor must own the lock, or be the Combo Locks owner
// (Kevin). Service role writes so owner can edit anyone's locks. Matched fills
// stay untouched; cancel only stamps signals the worker polls.
'use strict';

const lib = require('./combo-probe-lib');
const orders = require('./combo-lock-orders-lib');

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}
const freshDeps = () => ({ env: process.env, createClient: defaultCreateClient, now: () => Date.now() });
let deps = freshDeps();
function setDeps(patch) { deps = { ...deps, ...patch }; }
function resetDeps() { deps = freshDeps(); }

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

async function requireUser(req) {
  const token = lib.readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: 'Server auth is not configured' };
  const { data, error } = await deps.createClient(url, anon, clientOpts).auth.getUser(token);
  const user = data && data.user;
  if (error || !user || !user.id) return { ok: false, status: 401, error: 'Invalid session' };
  return { ok: true, user };
}

function serviceClient() {
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return deps.createClient(url, key, clientOpts);
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  return body && typeof body === 'object' ? body : null;
}

async function loadParlay(client, id) {
  const { data, error } = await client.from('combo_parlays').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function feesEnabledFor(client, userId) {
  const { data, error } = await client.from('combo_live_users').select('fees_enabled').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return !!(data && data.fees_enabled);
}

async function filledContracts(client, parlayId) {
  const { data, error } = await client.from('combo_fills')
    .select('count,is_combo,is_taker')
    .eq('parlay_id', parlayId)
    .eq('is_combo', true)
    .eq('is_taker', false);
  if (error) throw error;
  let n = 0;
  for (const r of data || []) n += Number(r.count) || 0;
  return n;
}

async function editFill(client, actor, body, isOwner) {
  const parlayId = String(body.parlay_id || '');
  if (!UUID_RE.test(parlayId)) return { ok: false, status: 400, error: 'parlay_id required' };
  const parlay = await loadParlay(client, parlayId);
  if (!parlay) return { ok: false, status: 404, error: 'Lock not found' };
  if (parlay.archived_at) return { ok: false, status: 400, error: 'That lock is in history. Unarchive it or create a new one.' };
  if (!orders.canManageLock(actor, parlay, { isOwner })) {
    return { ok: false, status: 403, error: 'You can only edit your own locks.' };
  }
  const feesEnabled = await feesEnabledFor(client, parlay.user_id);
  const resolved = orders.resolveExchangeFill(body.fill, { feesEnabled });
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };
  const filled = await filledContracts(client, parlayId);
  const now = new Date(deps.now());
  const patch = orders.fillEditParlayPatch(parlay, resolved.fillAmerican, { filled, now });
  const { data, error } = await client.from('combo_parlays').update(patch).eq('id', parlayId).select('*').maybeSingle();
  if (error) throw error;
  return {
    ok: true,
    parlay: data,
    fill_american: resolved.fillAmerican,
    typed_american: resolved.typedAmerican,
    fees_enabled: feesEnabled,
    cancelled_open: true,
  };
}

async function cancelAllOpen(client, actor, body, isOwner) {
  const parlayId = String(body.parlay_id || '');
  if (!UUID_RE.test(parlayId)) return { ok: false, status: 400, error: 'parlay_id required' };
  const parlay = await loadParlay(client, parlayId);
  if (!parlay) return { ok: false, status: 404, error: 'Lock not found' };
  if (!orders.canManageLock(actor, parlay, { isOwner })) {
    return { ok: false, status: 403, error: 'You can only cancel quotes on your own locks.' };
  }
  const iso = new Date(deps.now()).toISOString();
  const { data, error } = await client.from('combo_parlays')
    .update({ cancel_open_at: iso })
    .eq('id', parlayId)
    .select('id,cancel_open_at')
    .maybeSingle();
  if (error) throw error;
  return { ok: true, parlay_id: parlayId, cancel_open_at: data && data.cancel_open_at };
}

async function cancelQuote(client, actor, body, isOwner) {
  const submissionId = String(body.submission_id || '');
  if (!UUID_RE.test(submissionId)) return { ok: false, status: 400, error: 'submission_id required' };
  const { data: row, error } = await client.from('combo_submissions').select('*').eq('id', submissionId).maybeSingle();
  if (error) throw error;
  if (!row) return { ok: false, status: 404, error: 'Quote not found' };
  if (!orders.isOpenSubmission(row)) {
    return { ok: false, status: 400, error: 'That quote is already filled or no longer open.' };
  }
  let parlay = null;
  if (row.parlay_id) parlay = await loadParlay(client, row.parlay_id);
  const ownerId = (parlay && parlay.user_id) || row.user_id;
  if (!orders.canManageLock(actor, { user_id: ownerId }, { isOwner })) {
    return { ok: false, status: 403, error: 'You can only cancel your own quotes.' };
  }
  const iso = new Date(deps.now()).toISOString();
  const { data, error: upErr } = await client.from('combo_submissions')
    .update({ cancel_requested_at: iso })
    .eq('id', submissionId)
    .select('id,quote_id,parlay_id,cancel_requested_at,is_live')
    .maybeSingle();
  if (upErr) throw upErr;
  return { ok: true, submission: data };
}

async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });
  const auth = await requireUser(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  if (!lib.canSeeComboLocks(auth.user)) return json(res, 403, { ok: false, error: 'Not allowed' });
  const client = serviceClient();
  if (!client) return json(res, 503, { ok: false, error: 'Server is not configured' });
  const body = parseBody(req);
  if (!body) return json(res, 400, { ok: false, error: 'Expected a JSON body' });
  const action = String(body.action || '');
  const isOwner = lib.isComboOwner(auth.user);
  try {
    if (action === 'edit_fill') {
      const out = await editFill(client, auth.user, body, isOwner);
      return json(res, out.ok ? 200 : out.status, out);
    }
    if (action === 'cancel_all_open') {
      const out = await cancelAllOpen(client, auth.user, body, isOwner);
      return json(res, out.ok ? 200 : out.status, out);
    }
    if (action === 'cancel_quote') {
      const out = await cancelQuote(client, auth.user, body, isOwner);
      return json(res, out.ok ? 200 : out.status, out);
    }
    return json(res, 400, { ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error('[combo-lock-orders]', e && e.message);
    return json(res, 500, { ok: false, error: 'Something went wrong' });
  }
}

handler._setDeps = setDeps;
handler._resetDeps = resetDeps;
module.exports = handler;
