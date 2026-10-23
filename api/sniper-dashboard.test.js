'use strict';
const assert = require('assert');
const h = require('./sniper-dashboard');
const lib = require('./combo-probe-lib');
function res() { const r = { code: 0, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; }
function chain(rows) {
  const c = { _rows: rows };
  for (const m of ['select', 'eq', 'gt', 'gte', 'order']) c[m] = () => c;
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
  lib.isComboOwner = realIs; h._resetDeps();
  console.log('api/sniper-dashboard.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
