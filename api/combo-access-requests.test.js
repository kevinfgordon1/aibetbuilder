'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('./combo-access-requests.js');
const lib = require('./combo-probe-lib');

const KEVIN = '79ae1610-097e-4b46-a622-1e952f18e936';
const KEVIN2 = '968efed8-54db-48a6-808b-194a7a03a4cb';
const U = '11111111-2222-4333-8444-555555555555';
const OWNER = { id: KEVIN, email: 'kev120909@gmail.com' };
const OWNER2 = { id: KEVIN2, email: 'kevin.f.gordon1@gmail.com' };

function res() {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function setup({ user = OWNER, rows = [] } = {}) {
  const db = { combo_locks_access_requests: rows.map((r) => ({ ...r })) };
  handler._setDeps({
    env: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc' },
    createClient(_u, key) {
      if (key === 'anon') {
        return { auth: { async getUser(t) { return t === 'good' ? { data: { user }, error: null } : { data: null, error: {} }; } } };
      }
      return {
        from(table) {
          const filters = [];
          const api = {
            select() { return api; },
            eq(c, v) { filters.push([c, v]); return api; },
            limit() { return api; },
            async maybeSingle() {
              const row = (db[table] || []).find((r) => filters.every(([c, v]) => r[c] === v)) || null;
              return { data: row, error: null };
            },
            then(ok, bad) { return Promise.resolve({ data: db[table] || [], error: null }).then(ok, bad); },
            update(patch) {
              return {
                eq(c, v) {
                  const row = (db[table] || []).find((r) => r[c] === v);
                  if (row) Object.assign(row, patch);
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
          return api;
        },
      };
    },
  });
  return db;
}

const call = (method, body, token = 'good') => {
  const r = res();
  return handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, r).then(() => r);
};

(async () => {
  let calls = 0;
  assert.equal(await lib.hasApprovedComboAccess({ email: 'kev120909@gmail.com', id: KEVIN }, () => { calls += 1; return null; }), true);
  assert.equal(calls, 0, 'allowlisted users do not read the request table');
  const stranger = { email: 'stranger@gmail.com', id: U };
  assert.equal(await lib.hasApprovedComboAccess(stranger, () => null), false);
  const clientFor = (row) => ({
    from() {
      const api = {
        select() { return api; },
        eq() { return api; },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return api;
    },
  });
  assert.equal(await lib.hasApprovedComboAccess(stranger, () => clientFor({ email: 'stranger@gmail.com', status: 'approved' })), true);
  assert.equal(await lib.hasApprovedComboAccess(stranger, () => clientFor({ email: 'Stranger@gmail.com ', status: 'approved' })), true);
  assert.equal(await lib.hasApprovedComboAccess(stranger, () => clientFor({ email: 'other@gmail.com', status: 'approved' })), false);
  assert.equal(await lib.hasApprovedComboAccess(stranger, () => clientFor({ email: 'stranger@gmail.com', status: 'pending' })), false);
  assert.equal(await lib.hasApprovedComboAccess(stranger, () => { throw new Error('down'); }), false);
  assert.equal(lib.canReviewComboAccess({ email: 'Kevin.F.Gordon1@gmail.com', id: KEVIN2 }), true);
  assert.equal(lib.canReviewComboAccess({ email: 'kevin.f.gordon1@gmail.com', id: KEVIN }), false, 'pairs do not mix');
  assert.equal(lib.canReviewComboAccess(stranger), false);
  assert.equal(lib.canReviewComboAccess(OWNER), true);

  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '20261103_combo_locks_access_requests.sql'), 'utf8');
  assert.match(sql, /create table if not exists public\.combo_locks_access_requests/);
  assert.match(sql, /user_id/);
  assert.match(sql, /email/);
  assert.match(sql, /created_at/);
  assert.match(sql, /status/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /for insert/);
  assert.match(sql, /for select/);
  assert.match(sql, /status = 'pending'/);
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /grant select, insert/i);
  assert.doesNotMatch(sql, /grant\s+(all|update|delete)/i);
  assert.match(sql, /revoke update, delete/);

  const badge = fs.readFileSync(path.join(__dirname, '..', 'src', 'ComboBetaBadge.jsx'), 'utf8');
  assert.match(badge, /#8B5CF6/);
  assert.match(badge, /#A855F7/);
  assert.match(badge, /prefers-reduced-motion:\s*reduce/);
  assert.match(badge, />BETA</);
  assert.match(badge, /letter-spacing:\s*0\.11em/);
  assert.match(badge, /combo-beta-shimmer/);
  const gate = fs.readFileSync(path.join(__dirname, '..', 'src', 'ComboLocksGate.jsx'), 'utf8');
  assert.match(gate, /Request access/);
  assert.match(gate, /Request pending/);
  assert.match(gate, /Kalshi and Polymarket/);

  assert.equal((await call('GET', null, null)).code, 401);
  setup({ user: stranger });
  assert.equal((await call('GET')).code, 403);
  setup({ user: { id: KEVIN2, email: 'someone@else.com' } });
  assert.equal((await call('GET')).code, 403, 'second Kevin account still needs the matching email');

  const pending = { user_id: U, email: 'stranger@gmail.com', status: 'pending', created_at: '2026-11-03T12:00:00Z' };
  const older = { user_id: KEVIN2, email: 'kevin.f.gordon1@gmail.com', status: 'approved', created_at: '2026-11-01T12:00:00Z' };
  setup({ rows: [older, pending] });
  let r = await call('GET');
  assert.equal(r.code, 200);
  assert.equal(r.body.requests[0].user_id, U, 'pending first');
  assert.equal(r.body.requests[1].status, 'approved');

  setup({ user: OWNER2, rows: [pending] });
  r = await call('POST', { user_id: U });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.requests[0].status, 'approved');
  assert.equal((await call('POST', { user_id: 'nope' })).code, 400);
  assert.equal((await call('POST', { user_id: '22222222-2222-4222-8222-222222222222' })).code, 404);

  handler._resetDeps();
  console.log('combo-access-requests.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
