'use strict';
const assert = require('assert');
const h = require('./sniper-dashboard');
const lib = require('./combo-probe-lib');
function res() { const r = { code: 0, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; }
function chain(rows) {
  const c = { _rows: rows };
  for (const m of ['select', 'eq', 'gt', 'gte', 'order']) c[m] = () => c;
  c.eq = (k, v) => { if (k === 'dry_run') rows = rows.filter((r) => r.dry_run === undefined || r.dry_run === v); return c; };
  c.limit = async () => ({ data: rows.slice(0, 1), error: null });
  c.range = async (a, b) => ({ data: rows.slice(a, b + 1), error: null });
  c.then = (f) => Promise.resolve({ count: 0, data: rows, error: null }).then(f);
  return c;
}
(async () => {
  const owner = { id: 'x', email: 'x' };
  const realIs = lib.isComboOwner; let isOwner = false; lib.isComboOwner = () => isOwner;
  const tables = {
    sniper_decisions: [{ created_at: new Date().toISOString(), details: { mode: 'dry', counts: { rfqs: 5, quotes: 1, skips: { scope_not_nfl_ml: 4 } }, kickoffs: { espn: 14 } } }],
    sniper_ledger: [{ rfq_id: 'r1', status: 'open', phase: 'dry_run', dry_run: true, risk: 42, games: ['G1'], legs: ['KXNFLGAME-26OCT25CINBAL-CIN:yes'], fair_yes: 0.25, quote_yes: 0.27, roi: 0.05, created_at: new Date().toISOString() }],
  };
  h._setDeps({ env: { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_KEY: 's' }, now: () => Date.now(),
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: owner } }) }, from: (t) => chain(tables[t] || []) }) });
  let r = res(); await h({ method: 'GET', headers: {}, query: {} }, r); assert.strictEqual(r.code, 401);
  r = res(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: {} }, r); assert.strictEqual(r.code, 403, 'non-owner blocked');
  isOwner = true;
  r = res(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: {} }, r);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.book, 'dry'); assert.strictEqual(r.body.status.mode, 'dry');
  assert.strictEqual(r.body.risk.open, 42); assert.strictEqual(r.body.quotes[0].fairAmerican, 300);
  assert.strictEqual(r.headers['Cache-Control'], 'no-store');
  assert.strictEqual(r.body.skips, null, 'main request no longer waits on the skips scan');
  r = res(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { skips: '1' } }, r);
  assert.strictEqual(r.code, 200); assert.deepStrictEqual(r.body.skips.reasons, ['scope_not_nfl_ml']);
  // Summary (skips) scan timing out must not take down the page.
  const realFrom = (t) => { const c = chain(tables[t] || []); if (t === 'sniper_decisions') c.range = async () => ({ data: null, error: { message: 'canceling statement due to statement timeout' } }); return c; };
  h._setDeps({ env: { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_KEY: 's' }, now: () => Date.now(),
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: owner } }) }, from: realFrom }) });
  r = res(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: {} }, r);
  assert.strictEqual(r.code, 200, 'summary timeout is non-fatal: ' + JSON.stringify(r.body)); assert.strictEqual(r.body.risk.open, 42);
  r = res(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { skips: '1' } }, r);
  assert.strictEqual(r.code, 200); assert.deepStrictEqual(r.body.skips.hours, [], 'skips timeout returns empty, not an error');
  // Hedge writes: owner only, validated, real fills only.
  const writes = [];
  const wchain = (t) => { const c = chain(tables[t] || []); c.in = () => c; c.insert = (row) => { writes.push(['insert', t, row]); return { select: async () => ({ data: [{ id: 'h1' }], error: null }) }; };
    c.update = (row) => { writes.push(['update', t, row]); return { eq: async () => ({ error: null }) }; }; c.delete = () => { writes.push(['delete', t]); return { eq: async () => ({ error: null }) }; }; return c; };
  tables.sniper_ledger = [{ rfq_id: 'f1', dry_run: false, filled_contracts: 64.75 }];
  h._setDeps({ env: { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_KEY: 's' }, now: () => Date.now(),
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: owner } }) }, from: wchain }) });
  isOwner = false; r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t' }, query: { hedge: '1' }, body: { rfqId: 'f1', book: 'FanDuel', american: 798, stake: 7.21 } }, r); assert.strictEqual(r.code, 403); assert.strictEqual(writes.length, 0);
  isOwner = true;
  r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t' }, query: { hedge: '1' }, body: { rfqId: 'f1', book: 'FanDuel', american: 50, stake: 7.21 } }, r); assert.strictEqual(r.code, 400, 'bad odds');
  r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t' }, query: { hedge: '1' }, body: { rfqId: 'f1', book: 'FanDuel', american: 798, stake: 0 } }, r); assert.strictEqual(r.code, 400, 'bad stake');
  r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t' }, query: { hedge: '1' }, body: { rfqId: 'f1', book: 'FanDuel', american: '+798', stake: 7.21, source: 'book_arb' } }, r);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.deepStrictEqual([writes[0][1], writes[0][2].american, writes[0][2].stake, writes[0][2].status, writes[0][2].source], ['sniper_hedges', 798, 7.21, 'active', 'book_arb']);
  r = res(); await h({ method: 'PATCH', headers: { authorization: 'Bearer t' }, query: { hedge: '1', id: '00000000-0000-0000-0000-000000000001' }, body: { status: 'void' } }, r); assert.strictEqual(r.code, 200); assert.strictEqual(writes[1][2].status, 'void');
  r = res(); await h({ method: 'DELETE', headers: { authorization: 'Bearer t' }, query: { hedge: '1', id: 'nope' } }, r); assert.strictEqual(r.code, 400);
  r = res(); await h({ method: 'DELETE', headers: { authorization: 'Bearer t' }, query: { hedge: '1', id: '00000000-0000-0000-0000-000000000001' } }, r); assert.strictEqual(r.code, 200);
  tables.sniper_ledger = [{ rfq_id: 'd1', dry_run: true, filled_contracts: 0 }];
  r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t' }, query: { hedge: '1' }, body: { rfqId: 'd1', book: 'FanDuel', american: 798, stake: 7.21 } }, r); assert.strictEqual(r.code, 400, 'dry/unfilled rejected');
  r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t' }, query: {} }, r); assert.strictEqual(r.code, 405, 'non-hedge POST still GET only');
  // matched=1: two index-backed reads (filled + open accepted), no OR scan over the whole ledger; merged by rfq_id.
  const calls = [];
  const fill = { rfq_id: 'm1', dry_run: false, status: 'settled', phase: 'settled', filled_contracts: 10, legs: [], created_at: '2026-10-22T17:00:00Z' };
  const acc = { rfq_id: 'm2', dry_run: false, status: 'open', phase: 'accepted', filled_contracts: 0, legs: [], created_at: '2026-10-24T01:00:00Z' };
  const mchain = (t) => { const c = chain([]); const f = { gt: false, in: false };
    c.or = () => { calls.push('or'); return c; }; c.gt = () => { f.gt = true; return c; }; c.in = () => { f.in = true; return c; };
    c.range = async () => { if (t !== 'sniper_ledger') return { data: [], error: null }; calls.push(f.gt ? 'filled' : f.in ? 'pending' : 'other'); return { data: f.gt ? [fill] : f.in ? [acc, fill] : [], error: null }; };
    return c; };
  h._setDeps({ env: { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_KEY: 's' }, now: () => Date.now(), fetch: async () => ({ ok: false, json: async () => ({}) }),
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: owner } }) }, from: mchain }) });
  r = res(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { matched: '1' } }, r);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.ok(!calls.includes('or'), 'no OR scan'); assert.ok(calls.includes('filled') && calls.includes('pending'));
  assert.deepStrictEqual(r.body.rows.map((x) => x.rfqId), ['m2', 'm1'], 'deduped, newest first');
  lib.isComboOwner = realIs; h._resetDeps();
  console.log('api/sniper-dashboard.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
