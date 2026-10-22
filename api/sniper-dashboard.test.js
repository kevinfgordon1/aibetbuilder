'use strict';
const assert = require('assert');
const h = require('./sniper-dashboard');
const lib = require('./combo-probe-lib');
function res() { const r = { code: 0, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; }
function chain(rows) {
  const c = { _rows: rows };
  for (const m of ['select', 'eq', 'gte', 'order']) c[m] = () => c;
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
  lib.isComboOwner = realIs; h._resetDeps();
  console.log('api/sniper-dashboard.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
