'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const h = require('./raw-parlay-edges');

function mkRes() { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; }
const OWNER = { id: require('./combo-probe-lib').OWNER_USER_ID, email: 'kev120909@gmail.com' };
const rows = [{ rfq_id: 'a', rfq_created_ts: new Date().toISOString(), market_ticker: 'KXMVECROSSCATEGORY0-S1-X', n_legs: 2, legs: ['KXNFLGAME-26OCT18LACKC-LAC:yes'], contracts: 100, rfq_target_cost: 1, fair_mid_american: 7708, traded_yes: 0.0168, traded_contracts: 100, outcome: 'traded' }];
function client(user) {
  const q = { calls: [], select() { return q; }, eq(...a) { q.calls.push(['eq', ...a]); return q; }, not() { return q; }, gte() { return q; }, order() { return q; }, range() { return Promise.resolve({ data: rows, error: null }); } };
  return { auth: { getUser: async () => ({ data: { user }, error: null }) }, from(t) { assert.equal(t, 'noboost_paper_rfqs'); return q; } };
}
(async () => {
  const env = { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_KEY: 's' };
  for (const [user, code] of [[null, 401], [{ id: 'x', email: 'tester@gmail.com' }, 403], [{ id: 'x', email: 'kev120909@gmail.com' }, 403], [{ id: 'k', email: 'kmguido97@gmail.com' }, 403]]) {
    h._setDeps({ env, createClient: () => client(user) });
    const res = mkRes();
    await h({ method: 'GET', headers: user ? { authorization: 'Bearer t' } : {}, query: {} }, res);
    assert.equal(res.code, code);
  }
  h._setDeps({ env, createClient: () => client(OWNER), lookupSeries: async () => ({ fee_type: 'quadratic', fee_multiplier: 1 }) });
  const res = mkRes();
  await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { edge: '900' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.edges.length, 1);
  assert.equal(res.body.series.KXMVECROSSCATEGORY0.rate, 0);
  assert.equal(res.body.days[0].count, 1);
  const post = mkRes(); await h({ method: 'POST', headers: { authorization: 'Bearer t' } }, post); assert.equal(post.code, 405);
  const src = fs.readFileSync(__dirname + '/raw-parlay-edges.js', 'utf8');
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/);
  assert.equal(h._helpers.parseOpts({ days: '30' }).days, 7);
  h._resetDeps();
  console.log('raw-parlay-edges api tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
