'use strict';
// Owner-only "View as": owner check, target pinning, secrets never readable,
// and every write endpoint refuses view-as requests.
const assert = require('node:assert/strict');
const handler = require('./combo-view-as.js');
const viewAs = require('./combo-view-as-lib.js');

const KEVIN = '79ae1610-097e-4b46-a622-1e952f18e936';
const KEVIN2 = '968efed8-54db-48a6-808b-194a7a03a4cb';
const KENNY = '42b5ee16-68d5-4b3b-a931-40aa17cd1a47';
const CHRIS = '721c1166-be0b-4856-8a88-6de3a8b047b9';
const LIVE_ONLY = '11111111-2222-4333-8444-555555555555';
const STRANGER = '99999999-2222-4333-8444-555555555555';
const OWNER = { id: KEVIN, email: 'kev120909@gmail.com' };

function res() {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

function setup({ user = OWNER } = {}) {
  const db = {
    combo_live_users: [{ user_id: KENNY }, { user_id: LIVE_ONLY }],
    combo_parlays: [
      { id: 'p-kenny', user_id: KENNY, label: 'Kenny lock', archived_at: null },
      { id: 'p-kevin', user_id: KEVIN, label: 'Kevin lock', archived_at: null },
    ],
    combo_settings: [{ user_id: KENNY, kill_switch: true }, { user_id: KEVIN, kill_switch: false }],
    combo_matches: [{ parlay_id: 'p-kenny', id: 1 }, { parlay_id: 'p-kevin', id: 2 }],
    combo_exchange_keys: [{ user_id: KENNY, key_id: 'SHOULD-NOT-LEAK', secret_id: 'vault' }],
  };
  const log = [];
  handler._setDeps({
    env: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc' },
    createClient(_u, key) {
      if (key === 'anon') return { auth: { async getUser(t) { return t === 'good' ? { data: { user }, error: null } : { data: null, error: {} }; } } };
      return {
        auth: { admin: { async getUserById(id) { return { data: { user: { id, email: id === LIVE_ONLY ? 'live@example.com' : null } }, error: null }; } } },
        from(table) {
          const preds = [];
          let single = false;
          let window = null;
          const api = {
            select() { return api; },
            eq(c, v) { preds.push((r) => r[c] === v); log.push([table, 'eq', c, v]); return api; },
            in(c, vs) { preds.push((r) => vs.includes(r[c])); log.push([table, 'in', c, vs]); return api; },
            is(c, v) { preds.push((r) => (r[c] ?? null) === v); return api; },
            order() { return api; },
            limit() { return api; },
            range(from, to) { window = [from, to]; log.push([table, 'range', from, to]); return api; },
            maybeSingle() { single = true; return api; },
            then(ok, bad) {
              let rows = (db[table] || []).filter((r) => preds.every((p) => p(r)));
              if (window) rows = rows.slice(window[0], window[1] + 1);
              return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(ok, bad);
            },
          };
          return api;
        },
        async rpc(name, args) { log.push(['rpc', name, args]); return { data: [{ user_id: args.uids[0], fees_enabled: true }], error: null }; },
      };
    },
  });
  return { db, log };
}

const call = (method, body, token = 'good') => {
  const r = res();
  return handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, r).then(() => r);
};
const q = (table, extra = {}) => ({ table, select: '*', filters: [], order: [], ...extra });

(async () => {
  // ── owner check ──
  setup();
  assert.equal((await call('GET', null, null)).code, 401, 'sign-in required');
  setup({ user: { id: KENNY, email: 'kmguido97@gmail.com' } });
  assert.equal((await call('GET')).code, 403, 'a tester cannot list users');
  assert.equal((await call('POST', { view_as: CHRIS, queries: [q('combo_parlays')] })).code, 403, 'a tester cannot view as anyone');
  setup({ user: { id: KEVIN2, email: 'kevin.f.gordon1@gmail.com' } });
  assert.equal((await call('POST', { view_as: KENNY, queries: [] })).code, 403, 'owner = email AND id');
  setup({ user: { id: STRANGER, email: 'kev120909@gmail.com' } });
  assert.equal((await call('POST', { view_as: KENNY, queries: [] })).code, 403, 'look-alike owner email with another id');

  // ── target check ──
  setup();
  assert.equal((await call('POST', { view_as: STRANGER, queries: [] })).code, 404, 'not a Combo Locks user');
  assert.equal((await call('POST', { view_as: 'not-a-uuid', queries: [] })).code, 400);
  assert.equal((await call('POST', { view_as: LIVE_ONLY, queries: [] })).code, 200, 'combo_live_users testers are viewable');

  // ── listing ──
  let r = await call('GET');
  assert.equal(r.code, 200);
  const ids = r.body.users.map((u) => u.id);
  for (const id of [KEVIN, KENNY, CHRIS, LIVE_ONLY]) assert.ok(ids.includes(id), id);
  assert.equal(r.body.users[0].id, KEVIN, 'owner first');
  assert.equal(r.body.users.find((u) => u.id === KENNY).label, 'Kenny');

  // ── pinned to the viewed user ──
  let s = setup();
  r = await call('POST', { view_as: KENNY, queries: [
    q('combo_parlays', { filters: [{ op: 'eq', args: ['user_id', KEVIN] }] }),
    q('combo_settings', { select: 'kill_switch', single: 'maybe' }),
    q('combo_matches'),
    { kind: 'rpc', name: 'combo_my_fee_status' },
    q('combo_exchange_keys'),
    { kind: 'rpc', name: 'combo_admin_user_stats' },
    q('combo_parlays', { select: 'id;drop table x' }),
    q('combo_parlays', { filters: [{ op: 'rpc', args: ['x'] }] }),
  ] });
  assert.equal(r.code, 200);
  const [parlays, settings, matches, fee, keysRes, adminRpc, badSelect, badOp] = r.body.results;
  assert.deepEqual(parlays.data.map((p) => p.id), ['p-kenny'], "client's user_id filter is replaced by the target");
  assert.equal(settings.data.kill_switch, true, "Kenny's kill switch");
  assert.deepEqual(matches.data.map((m) => m.id), [1], "parlay-scoped tables only show the target's locks");
  assert.deepEqual(fee.data[0], { user_id: KENNY, fees_enabled: true });
  assert.ok(keysRes.error && /not viewable/.test(keysRes.error.message), 'exchange keys table is never readable');
  assert.ok(adminRpc.error, 'only combo_my_fee_status rpc');
  assert.ok(badSelect.error && badOp.error);
  assert.ok(!JSON.stringify(r.body).includes('SHOULD-NOT-LEAK'));
  assert.ok(!s.log.some((l) => l[0] === 'combo_exchange_keys'));
  assert.equal((await call('POST', { view_as: KENNY, queries: new Array(viewAs.MAX_QUERIES + 1).fill(q('combo_parlays')) })).code, 400);

  // ── paged reads (.range) are honored and still pinned to the target ──
  s = setup();
  s.db.combo_parlays.push(
    { id: 'p-kenny-2', user_id: KENNY, label: 'Kenny old', archived_at: '2026-10-11' },
    { id: 'p-kenny-3', user_id: KENNY, label: 'Kenny older', archived_at: '2026-10-10' },
  );
  r = await call('POST', { view_as: KENNY, queries: [
    q('combo_parlays', { filters: [{ op: 'eq', args: ['user_id', KEVIN] }], range: { from: 0, to: 1 } }),
    q('combo_parlays', { range: { from: 2, to: 3 } }),
    q('combo_parlays', { range: { from: 5, to: 2 } }),
    q('combo_parlays', { range: { from: 0, to: viewAs.MAX_LIMIT } }),
  ] });
  assert.equal(r.code, 200);
  const [page1, page2, backwards, tooBig] = r.body.results;
  assert.deepEqual(page1.data.map((p) => p.id), ['p-kenny', 'p-kenny-2'], 'first page of the target only');
  assert.deepEqual(page2.data.map((p) => p.id), ['p-kenny-3'], 'second page');
  assert.ok(backwards.error && /bad range/.test(backwards.error.message));
  assert.ok(tooBig.error && /bad range/.test(tooBig.error.message), 'range span capped at MAX_LIMIT');
  assert.ok(s.log.some((l) => l[0] === 'combo_parlays' && l[1] === 'range' && l[2] === 2 && l[3] === 3));

  // ── lib: sanitize / read / reject ──
  assert.equal(viewAs.sanitizeQuery(q('combo_parlays', { filters: [{ op: 'or', args: ['status.eq.filled,is_live.eq.true'] }] })).ok, true);
  assert.equal(viewAs.sanitizeQuery(q('combo_parlays', { filters: [{ op: 'or', args: ['x"; select'] }] })).ok, false);
  assert.equal(viewAs.sanitizeQuery(q('auth.users')).ok, false);
  assert.equal(viewAs.readViewAs({ headers: { 'x-view-as': KENNY } }), KENNY);
  assert.equal(viewAs.readViewAs({ headers: {}, query: { view_as: KENNY } }), KENNY);
  assert.equal(viewAs.readViewAs({ headers: {}, body: JSON.stringify({ view_as: KENNY }) }), KENNY);
  assert.equal(viewAs.rejectViewAs({ headers: {} }), null);
  assert.equal(viewAs.rejectViewAs({ headers: { 'x-view-as': KENNY } }).status, 403);

  // ── every write endpoint refuses view-as before doing anything ──
  const writeEndpoints = [
    ['./combo-lock-orders.js', 'POST', { action: 'cancel_quote' }],
    ['./combo-probe.js', 'POST', { lockId: 'p-kenny' }],
    ['./combo-merge.js', 'POST', {}],
    ['./combo-keys.js', 'POST', { venue: 'kalshi', key_id: 'k', secret: 's' }],
    ['./combo-keys.js', 'DELETE', {}],
    ['./combo-credits.js', 'POST', { amount: 25 }],
    ['./stripe-checkout.js', 'POST', { amount: 25 }],
    ['./combo-admin.js', 'POST', { action: 'pause', user_id: KENNY }],
    ['./combo-admin.js', 'GET', null],
  ];
  for (const [mod, method, body] of writeEndpoints) {
    const h = require(mod);
    for (const req of [
      { method, headers: { authorization: 'Bearer good', 'x-view-as': KENNY }, body },
      { method, headers: { authorization: 'Bearer good' }, query: { view_as: KENNY }, body },
      { method, headers: { authorization: 'Bearer good' }, body: { ...(body || {}), view_as: KENNY } },
    ]) {
      const out = res();
      await h(req, out);
      assert.equal(out.code, 403, `${mod} ${method} must refuse view-as`);
      assert.equal(out.body.code, 'view_as_read_only', mod);
    }
  }

  // ── combo-keys GET in view-as: owner only, masked status of the target ──
  const keysHandler = require('./combo-keys.js');
  const keysDeps = (user) => ({
    env: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc' },
    createClient(_u, key) {
      if (key === 'anon') return { auth: { async getUser() { return { data: { user }, error: null }; } } };
      return {
        from(table) {
          let col = null; let val = null; let single = false;
          const rows = {
            combo_live_users: [{ user_id: KENNY, can_trade: true, paused: false, max_per_lock_usd: 50, max_per_day_usd: 200 }],
            combo_exchange_keys: [{ user_id: KENNY, venue: 'kalshi', key_hint: '9876', scope_status: 'ok', key_id: 'SHOULD-NOT-LEAK' }],
          }[table] || [];
          const api = {
            select() { return api; },
            eq(c, v) { col = c; val = v; return api; },
            maybeSingle() { single = true; return api; },
            then(ok, bad) { const d = col ? rows.filter((r) => r[col] === val) : rows; return Promise.resolve({ data: single ? d[0] || null : d, error: null }).then(ok, bad); },
          };
          return api;
        },
      };
    },
  });
  keysHandler._setDeps(keysDeps(OWNER));
  let out = res();
  await keysHandler({ method: 'GET', headers: { authorization: 'Bearer good', 'x-view-as': KENNY } }, out);
  assert.equal(out.code, 200);
  assert.equal(out.body.approved, true, "Kenny's status, not Kevin's");
  assert.equal(out.body.venues.kalshi.connected, true);
  assert.ok(!JSON.stringify(out.body).includes('SHOULD-NOT-LEAK'));
  keysHandler._setDeps(keysDeps({ id: CHRIS, email: 'c.w.higgins1@gmail.com' }));
  out = res();
  await keysHandler({ method: 'GET', headers: { authorization: 'Bearer good', 'x-view-as': KENNY } }, out);
  assert.equal(out.code, 403, 'a tester cannot read another tester\'s key status');
  keysHandler._resetDeps();

  console.log('combo-view-as tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
