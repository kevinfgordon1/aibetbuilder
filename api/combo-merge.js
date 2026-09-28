// POST /api/combo-merge — owner-only merge / undo for Combo Locks.
// Re-points combo_fills (and the quote tables) with the service role because
// signed-in users can read fills but not update them. Does not apply SQL;
// sql/combo_parlay_merge.sql has to be run in the Supabase SQL editor first.
'use strict';

const lib = require('./combo-probe-lib');

const SCHEMA_HINT = 'Apply sql/combo_parlay_merge.sql in the Supabase SQL editor before merging. This app does not apply it.';

function defaultCreateClient(...args) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(...args);
}

let deps = {
  env: process.env,
  createClient: defaultCreateClient,
  mergeLib: null,
};

function setDeps(patch) {
  deps = { ...deps, ...patch };
}

function resetDeps() {
  deps = { env: process.env, createClient: defaultCreateClient, mergeLib: null };
}

function json(res, status, body) {
  res.status(status).json(body);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

function schemaError(error) {
  const msg = String(error && error.message || error || '');
  return /combo_parlay_bets|combo_parlay_merge|merge_fill_ids|merged_into_id|bet_type|schema cache|Could not find/i.test(msg);
}

async function loadMergeLib() {
  if (deps.mergeLib) return deps.mergeLib;
  return import('../src/comboMerge.js');
}

async function requireOwner(req) {
  const token = lib.readBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: 'Server auth is not configured' };
  const supabase = deps.createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  const user = data && data.user;
  if (error || !user) return { ok: false, status: 401, error: 'Invalid session' };
  if (!lib.canSeeComboLocks(user, env)) return { ok: false, status: 403, error: 'Not allowed' };
  return { ok: true, user };
}

function serviceClient() {
  const env = deps.env || process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return deps.createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function rowsOf(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadCluster(client, ids) {
  const [fills, submissions, matches, outcomes, bets] = await Promise.all([
    rowsOf(client.from('combo_fills').select('*').in('parlay_id', ids)),
    rowsOf(client.from('combo_submissions').select('*').in('parlay_id', ids)),
    rowsOf(client.from('combo_matches').select('*').in('parlay_id', ids)),
    rowsOf(client.from('quote_outcomes').select('*').in('parlay_id', ids)),
    rowsOf(client.from('combo_parlay_bets').select('*').in('parlay_id', ids)),
  ]);
  return { fills, submissions, matches, outcomes, bets };
}

async function applyMergePlan(client, plan) {
  const done = [];
  const mark = async (name, fn) => {
    await fn();
    done.push(name);
  };
  try {
    await mark('batch', async () => {
      const { error } = await client.from('combo_parlay_merge_batches').insert(plan.batch);
      if (error) throw error;
    });
    if (plan.insertBets.length) {
      await mark('bets', async () => {
        const { error } = await client.from('combo_parlay_bets').insert(plan.insertBets);
        if (error) throw error;
      });
    }
    for (const row of plan.reattachBets) {
      await mark('reattach:' + row.id, async () => {
        const { error } = await client.from('combo_parlay_bets').update({ parlay_id: row.parlay_id }).eq('id', row.id);
        if (error) throw error;
      });
    }
    for (const row of plan.archive) {
      await mark('archive:' + row.id, async () => {
        const { error } = await client.from('combo_parlays').update(row.patch).eq('id', row.id);
        if (error) throw error;
      });
    }
    for (const id of plan.dropMatchIds) {
      await mark('drop:' + id, async () => {
        const { error } = await client.from('combo_matches').delete().eq('id', id);
        if (error) throw error;
      });
    }
    for (const row of plan.repoints) {
      await mark('repoint:' + row.table + ':' + row.id, async () => {
        const { error } = await client.from(row.table).update({ parlay_id: row.parlay_id }).eq('id', row.id);
        if (error) throw error;
      });
    }
    if (plan.moves.length) {
      await mark('moves', async () => {
        const { error } = await client.from('combo_parlay_hedge_moves').insert(plan.moves);
        if (error) throw error;
      });
    }
    await mark('survivor', async () => {
      const { error } = await client.from('combo_parlays').update(plan.survivorPatch).eq('id', plan.survivorId);
      if (error) throw error;
    });
  } catch (err) {
    await rollbackMerge(client, plan, done);
    throw err;
  }
}

async function rollbackMerge(client, plan, done) {
  const has = (prefix) => done.some((name) => name === prefix || name.startsWith(prefix));
  try {
    if (has('survivor')) {
      const before = plan.batch.survivor_before || {};
      await client.from('combo_parlays').update({
        parlay_stake: before.parlay_stake,
        parlay_american: before.parlay_american,
        is_free_bet: before.is_free_bet === true,
        bet_type: before.bet_type || 'cash',
        max_contracts: before.max_contracts,
        sportsbook: before.sportsbook || null,
        boost_pct: before.boost_pct != null ? before.boost_pct : null,
        merged_at: before.merged_at || null,
        merge_fill_ids: before.merge_fill_ids || null,
        active: before.active !== false,
        archived_at: before.archived_at || null,
        merged_into_id: null,
      }).eq('id', plan.survivorId);
    }
    if (has('moves')) {
      await client.from('combo_parlay_hedge_moves').delete().eq('batch_id', plan.batch.id);
    }
    for (const row of plan.repoints) {
      if (!has('repoint:' + row.table + ':' + row.id)) continue;
      await client.from(row.table).update({ parlay_id: row.from_parlay_id }).eq('id', row.id);
    }
    for (const id of plan.dropMatchIds) {
      if (!has('drop:' + id)) continue;
      const row = (plan.batch.dropped_matches || []).find((match) => match.id === id);
      if (row) await client.from('combo_matches').insert(row);
    }
    for (const row of plan.archive) {
      if (!has('archive:' + row.id)) continue;
      await client.from('combo_parlays').update({
        active: true,
        archived_at: null,
        merged_into_id: null,
      }).eq('id', row.id);
    }
    for (const row of plan.reattachBets) {
      if (!has('reattach:' + row.id)) continue;
      await client.from('combo_parlay_bets').update({ parlay_id: row.from_parlay_id }).eq('id', row.id);
    }
    if (has('bets')) {
      await client.from('combo_parlay_bets').delete().eq('merge_batch_id', plan.batch.id);
    }
    if (has('batch')) {
      await client.from('combo_parlay_merge_batches').delete().eq('id', plan.batch.id);
    }
  } catch (rollbackErr) {
    console.error('[combo-merge] rollback failed', rollbackErr && rollbackErr.message);
  }
}

async function applyUndoPlan(client, plan) {
  if (plan.insertParlays && plan.insertParlays.length) {
    const { error } = await client.from('combo_parlays').insert(plan.insertParlays);
    if (error) throw error;
  }
  for (const row of plan.repoints) {
    const { error } = await client.from(row.table).update({ parlay_id: row.parlay_id }).eq('id', row.id);
    if (error) throw error;
  }
  for (const row of plan.reattachBets || []) {
    const { error } = await client.from('combo_parlay_bets').update({ parlay_id: row.parlay_id }).eq('id', row.id);
    if (error) throw error;
  }
  for (const row of plan.restore) {
    const { error } = await client.from('combo_parlays').update(row.patch).eq('id', row.id);
    if (error) throw error;
  }
  if (plan.reinsertMatches && plan.reinsertMatches.length) {
    const { error } = await client.from('combo_matches').insert(plan.reinsertMatches);
    if (error) throw error;
  }
  if (plan.deleteBetIds && plan.deleteBetIds.length) {
    const { error } = await client.from('combo_parlay_bets').delete().in('id', plan.deleteBetIds);
    if (error) throw error;
  }
  const { error } = await client.from('combo_parlay_hedge_moves').update({ undone_at: plan.undoneAt }).eq('batch_id', plan.batchId);
  if (error) throw error;
  const { error: batchErr } = await client.from('combo_parlay_merge_batches').update({ undone_at: plan.undoneAt }).eq('id', plan.batchId);
  if (batchErr) throw batchErr;
}

function publicPlan(plan) {
  return {
    ok: true,
    survivorId: plan.survivorId,
    warning: plan.warning,
    totalAtRisk: plan.economics.totalAtRisk,
    totalProfit: plan.economics.totalProfit,
    trueOdds: plan.economics.displayAmerican,
    atRisk: plan.economics.totalAtRisk,
    freeBet: plan.economics.isFreeBet,
    cap: plan.afterCap,
    beforeCaps: plan.beforeCaps,
    betCount: plan.economics.count,
  };
}

async function executeMerge(client, user, body) {
  const merge = await loadMergeLib();
  const action = String(body && body.action || 'merge');
  if (action === 'undo') {
    const survivorId = body && body.survivorId;
    if (!survivorId) return { ok: false, status: 400, error: 'Missing the order to split.' };
    const parlays = await rowsOf(client.from('combo_parlays').select('*').eq('id', survivorId).eq('user_id', user.id));
    const survivor = parlays[0];
    if (!survivor) return { ok: false, status: 404, error: 'That order was not found.' };
    const batches = await rowsOf(
      client.from('combo_parlay_merge_batches').select('*').eq('survivor_parlay_id', survivorId).eq('user_id', user.id).is('undone_at', null)
    );
    const batch = batches.slice().sort((a, b) => String(b.merged_at || '').localeCompare(String(a.merged_at || '')))[0];
    if (!batch) return { ok: false, status: 400, error: 'This order is not a merge.' };
    const absorbIds = (batch.absorb_snapshots || []).map((row) => row.id).filter(Boolean);
    const ids = [survivorId, ...absorbIds];
    const cluster = await loadCluster(client, ids);
    const moves = await rowsOf(client.from('combo_parlay_hedge_moves').select('*').eq('batch_id', batch.id).is('undone_at', null));
    const plan = merge.buildUndoPlan({
      batch,
      survivor,
      bets: cluster.bets,
      moves,
      fills: cluster.fills,
      now: new Date(),
    });
    if (!plan.ok) return { ok: false, status: 409, error: plan.error };
    await applyUndoPlan(client, plan);
    return { ok: true, status: 200, action: 'undo', survivorId };
  }

  const survivorId = body && body.survivorId;
  const absorbIds = Array.isArray(body && body.absorbIds) ? body.absorbIds.filter(Boolean) : [];
  if (!survivorId) return { ok: false, status: 400, error: 'Missing the order to merge into.' };
  const ids = [survivorId, ...absorbIds];
  const parlays = await rowsOf(client.from('combo_parlays').select('*').in('id', ids).eq('user_id', user.id));
  const byId = new Map(parlays.map((row) => [row.id, row]));
  const survivor = byId.get(survivorId);
  if (!survivor) return { ok: false, status: 404, error: 'That order was not found.' };
  for (const id of absorbIds) {
    if (!byId.get(id)) return { ok: false, status: 404, error: 'One of those parlays was not found.' };
  }
  const cluster = await loadCluster(client, ids);
  const plan = merge.buildMergePlan({
    survivor,
    absorb: absorbIds.map((id) => byId.get(id)),
    newBet: body && body.newBet ? body.newBet : null,
    existingBets: cluster.bets,
    fills: cluster.fills,
    submissions: cluster.submissions,
    matches: cluster.matches,
    outcomes: cluster.outcomes,
    now: new Date(),
  });
  if (!plan.ok) return { ok: false, status: 400, error: plan.error };
  await applyMergePlan(client, plan);
  return { ok: true, status: 200, ...publicPlan(plan) };
}

async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });
  const auth = await requireOwner(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  const client = serviceClient();
  if (!client) return json(res, 503, { ok: false, error: 'SUPABASE_SERVICE_KEY is not configured' });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  if (!body || typeof body !== 'object') return json(res, 400, { ok: false, error: 'Expected a JSON body' });
  try {
    const result = await executeMerge(client, auth.user, body);
    if (!result.ok) return json(res, result.status || 400, { ok: false, error: result.error });
    const { status, ...payload } = result;
    return json(res, status || 200, payload);
  } catch (err) {
    const message = String(err && err.message || err);
    if (schemaError(err)) return json(res, 503, { ok: false, error: SCHEMA_HINT, detail: message });
    console.error('[combo-merge]', message);
    return json(res, 500, { ok: false, error: message });
  }
}

handler.config = { maxDuration: 30 };
module.exports = handler;
module.exports.config = { maxDuration: 30 };
module.exports._setDeps = setDeps;
module.exports._resetDeps = resetDeps;
module.exports._executeMerge = executeMerge;
module.exports._applyMergePlan = applyMergePlan;
module.exports._applyUndoPlan = applyUndoPlan;
module.exports._SCHEMA_HINT = SCHEMA_HINT;
