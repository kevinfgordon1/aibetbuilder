'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const h = require('./raw-parlay-edges');

function mkRes() { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; }
const OWNER = { id: require('./combo-probe-lib').OWNER_USER_ID, email: 'kev120909@gmail.com' };
const rows = [{ rfq_id: 'a', rfq_created_ts: new Date().toISOString(), market_ticker: 'KXMVECROSSCATEGORY0-S1-X', n_legs: 2, legs: ['KXNFLGAME-26OCT18LACKC-LAC:yes'], contracts: 100, rfq_target_cost: 1, fair_mid_american: 7708, traded_yes: 0.0168, traded_contracts: 100, outcome: 'traded' }];
function client(user) {
  const q = { calls: [], select() { return q; }, eq(...a) { q.calls.push(['eq', ...a]); return q; }, not() { return q; }, or() { return q; }, gte() { return q; }, order() { return q; }, range() { return Promise.resolve({ data: rows, error: null }); } };
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
  await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { edge: '900', fair: 'kalshi' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.edges.length, 1);
  assert.equal(res.body.series.KXMVECROSSCATEGORY0.rate, 0);
  assert.equal(res.body.days[0].count, 1);
  // default fair=promo: row without a Promo fair is skipped; a fresh one is scored on it
  const r2 = mkRes(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { edge: '900', fair: 'promo' } }, r2);
  assert.equal(r2.body.edges.length, 0); assert.equal(r2.body.staleSkipped, 1);
  rows[0].fair_promo_best_american = 7708; rows[0].promo_max_age_ms = 200000; rows[0].fair_mid_american = 6000;
  const r3 = mkRes(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { edge: '900', fair: 'promo' } }, r3);
  assert.equal(r3.body.edges.length, 1); assert.equal(r3.body.edges[0].fairAmerican, 7708); assert.equal(r3.body.edges[0].kalshiFairAmerican, 6000);
  rows[0].promo_max_age_ms = 400000;
  const r4 = mkRes(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { edge: '900', fair: 'promo' } }, r4);
  assert.equal(r4.body.edges.length, 0); // older than 6 min
  const r5d = mkRes(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { edge: '900' } }, r5d);
  assert.equal(r5d.body.fairSource, 'pm'); // default fair: inverse bet (live)
  const r5 = mkRes(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { edge: '900', fair: 'pm' } }, r5);
  assert.equal(r5.body.fairSource, 'pm'); assert.equal(r5.body.edges.length, 0);
  rows[0].fair_pm_inverse_american = 7708;
  const r6 = mkRes(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { edge: '900', fair: 'pm' } }, r6);
  assert.equal(r6.body.edges.length, 1); assert.equal(r6.body.edges[0].fairAmerican, 7708);
  // Polymarket row: venue tag, Poly fee math (no maker fee), venue filter
  rows.push({ rfq_id: 'p', venue: 'polymarket', rfq_created_ts: new Date().toISOString(), market_ticker: 'caoc-x', n_legs: 2, legs: ['aec-nfl-lac-kc-2026-10-18:yes', 'aec-nfl-buf-mia-2026-10-18:no'], legs_kalshi: null, poly_tick_size: 0.001, contracts: 100, fair_mid_american: 2000, traded_yes: 0.12, traded_contracts: 100, outcome: 'traded' });
  rows[0].fair_mid_american = 7708;
  const r7 = mkRes(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { edge: '900', fair: 'kalshi' } }, r7);
  assert.equal(r7.body.edges.length, 2);
  const pe = r7.body.edges.find((e) => e.venue === 'polymarket');
  assert.ok(pe); assert.equal(pe.makerFee, 0); assert.deepEqual(pe.legs.map((l) => l.split(' ')[0]), ['LAC', 'MIA']);
  assert.equal(r7.body.edges.find((e) => e.rfq_id === 'a').venue, 'kalshi');
  const r8 = mkRes(); await h({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { edge: '900', fair: 'kalshi', venue: 'polymarket' } }, r8);
  assert.equal(r8.body.edges.length, 1); assert.equal(r8.body.edges[0].venue, 'polymarket');
  const post = mkRes(); await h({ method: 'POST', headers: { authorization: 'Bearer t' } }, post); assert.equal(post.code, 405);
  const src = fs.readFileSync(__dirname + '/raw-parlay-edges.js', 'utf8');
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/);
  assert.equal(h._helpers.parseOpts({ days: '30' }).days, 7);
  h._resetDeps();
  console.log('raw-parlay-edges api tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
