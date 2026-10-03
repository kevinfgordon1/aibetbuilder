'use strict';
const assert = require('node:assert/strict');
const handler = require('./combo-bucket.js');

function res() {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

function setup({ user, rows, error, noService } = {}) {
  const queries = [];
  handler._setDeps({
    env: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon', ...(noService ? {} : { SUPABASE_SERVICE_KEY: 'svc' }) },
    now: () => Date.parse('2026-10-02T22:00:00Z'),
    createClient(_url, key) {
      if (key === 'anon') {
        return { auth: { async getUser(t) { return t === 'good' ? { data: { user }, error: null } : { data: null, error: { message: 'bad' } }; } } };
      }
      return {
        from(table) {
          const q = { table, calls: [] };
          queries.push(q);
          const api = {
            select(c) { q.calls.push(['select', c]); return api; },
            not(c, op, v) { q.calls.push(['not', c, op, v]); return api; },
            order(c, o) { q.calls.push(['order', c, o]); return api; },
            async limit(n) { q.calls.push(['limit', n]); return { data: rows || [], error: error || null }; },
          };
          return api;
        },
      };
    },
  });
  return queries;
}

const OWNER = { email: 'kev120909@gmail.com', id: 'u1' };
const call = (headers, method = 'GET') => { const r = res(); return handler({ method, headers: headers || {} }, r).then(() => r); };

(async () => {
  // Auth: bearer required, session valid, owner only (an allowlisted tester is not enough).
  setup({ user: OWNER });
  assert.equal((await call({})).code, 401);
  assert.equal((await call({ authorization: 'Bearer nope' })).code, 401);
  setup({ user: { email: 'tester@example.com', id: 'u2' } });
  assert.equal((await call({ authorization: 'Bearer good' })).code, 403);
  setup({ user: OWNER });
  assert.equal((await call({ authorization: 'Bearer good' }, 'POST')).code, 405);
  assert.equal((await call({}, 'OPTIONS')).code, 204);
  setup({ user: OWNER, noService: true });
  assert.equal((await call({ authorization: 'Bearer good' })).code, 503);

  // Happy path: cents in, dollars out, labelled main vs combo, read-only query.
  const queries = setup({
    user: OWNER,
    rows: [{
      ts: '2026-10-02T21:59:30Z',
      bucket: {
        main_cents: 486_200, combo_cash_cents: 927_100, combo_positions_cents: 1_273_100,
        target_cents: 1_200_000, ceiling_cents: 2_200_000, floor_cents: 200_000, gameday: true,
        at: '2026-10-02T21:59:00Z',
      },
    }],
  });
  const ok = await call({ authorization: 'Bearer good' });
  assert.equal(ok.code, 200);
  assert.equal(ok.headers['Cache-Control'], 'no-store');
  assert.deepEqual(ok.body.bucket, {
    main_cash: 4862, combo_cash: 9271, combo_positions: 12731, target: 12000, ceiling: 22000,
    floor: 2000, gameday: true, at: '2026-10-02T21:59:00Z', stale: false,
  });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].table, 'combo_worker_stats');
  assert.ok(queries[0].calls.some((c) => c[0] === 'not' && c[1] === 'bucket'));
  assert.ok(!queries[0].calls.some((c) => ['insert', 'update', 'delete', 'upsert'].includes(c[0])));

  // Old snapshot is flagged stale.
  setup({ user: OWNER, rows: [{ ts: '2026-10-02T20:00:00Z', bucket: { main_cents: 1, at: '2026-10-02T20:00:00Z' } }] });
  assert.equal((await call({ authorization: 'Bearer good' })).body.bucket.stale, true);

  // Nothing yet / column not migrated: ok with bucket null (page hides the readout).
  setup({ user: OWNER, rows: [] });
  assert.deepEqual((await call({ authorization: 'Bearer good' })).body, { ok: true, bucket: null });
  setup({ user: OWNER, error: { message: 'column combo_worker_stats.bucket does not exist' } });
  const missing = await call({ authorization: 'Bearer good' });
  assert.equal(missing.code, 200);
  assert.equal(missing.body.bucket, null);
  setup({ user: OWNER, error: { message: 'connection reset' } });
  assert.equal((await call({ authorization: 'Bearer good' })).code, 500);

  handler._resetDeps();
  console.log('combo-bucket.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
