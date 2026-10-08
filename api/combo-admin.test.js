'use strict';
const assert = require('node:assert/strict');
const handler = require('./combo-admin.js');

const KEVIN = '79ae1610-097e-4b46-a622-1e952f18e936';
const KEVIN2 = '968efed8-54db-48a6-808b-194a7a03a4cb';
const T = '11111111-2222-4333-8444-555555555555';
const KENNY = '42b5ee16-68d5-4b3b-a931-40aa17cd1a47';
const OWNER = { id: KEVIN, email: 'kev120909@gmail.com' };

function res() {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function setup({ user = OWNER } = {}) {
  const db = {
    combo_live_users: [
      { user_id: KEVIN, is_owner: true, can_trade: true, paused: false, max_per_lock_usd: null, max_per_day_usd: null },
      { user_id: KEVIN2, is_owner: false, can_trade: true, paused: false, max_per_lock_usd: null, max_per_day_usd: null },
      { user_id: T, is_owner: false, can_trade: true, paused: false, max_per_lock_usd: 50, max_per_day_usd: 250 },
    ],
    combo_exchange_keys: [{ user_id: T, venue: 'kalshi', key_hint: '1234', scope_status: 'ok', key_id: 'SHOULD-NOT-LEAK', secret_id: 'vault-id' }],
    combo_settings: [{ user_id: KEVIN, kill_switch: false }, { user_id: T, kill_switch: false }],
  };
  const writes = [];
  const emails = { [KEVIN]: 'kev120909@gmail.com', [KEVIN2]: 'kevin.f.gordon1@gmail.com', [T]: 'tester@example.com', [KENNY]: 'kmguido97@gmail.com' };
  handler._setDeps({
    env: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc' },
    now: () => Date.parse('2026-10-08T12:00:00Z'),
    createClient(_u, key) {
      if (key === 'anon') return { auth: { async getUser(t) { return t === 'good' ? { data: { user }, error: null } : { data: null, error: {} }; } } };
      return {
        auth: { admin: { async getUserById(id) { return { data: { user: { id, email: emails[id] } }, error: null }; } } },
        from(table) {
          let filter = null;
          const api = {
            select() { return api; },
            eq(c, v) { filter = [c, v]; return api; },
            async maybeSingle() { return { data: (db[table] || []).find((r) => r[filter[0]] === filter[1]) || null, error: null }; },
            then(ok, bad) { return Promise.resolve({ data: db[table] || [], error: null }).then(ok, bad); },
            update(patch) {
              return { async eq(c, v) { writes.push([table, 'update', patch, v]); for (const r of db[table]) if (r[c] === v) Object.assign(r, patch); return { error: null }; } };
            },
            async upsert(row) { writes.push([table, 'upsert', row]); db[table] = db[table].filter((r) => r.user_id !== row.user_id).concat([row]); return { error: null }; },
          };
          return api;
        },
        async rpc(name) {
          assert.equal(name, 'combo_admin_user_stats');
          return { data: [
            { user_id: KEVIN, locks_total: 378, locks_active: 8, orders_30d: 529, fills_count: 563, fills_contracts: '71203.13', fills_today_contracts: '0' },
            { user_id: KENNY, locks_total: 2, locks_active: 1, orders_30d: 0, fills_count: 0, fills_contracts: '0', fills_today_contracts: '0' },
            { user_id: T, locks_total: 1, locks_active: 1, orders_30d: 3, fills_count: 2, fills_contracts: '40', fills_today_contracts: '10' },
          ], error: null };
        },
      };
    },
  });
  return { db, writes };
}

const call = (method, body, token = 'good') => { const r = res(); return handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, r).then(() => r); };

(async () => {
  setup();
  assert.equal((await call('GET', null, null)).code, 401);
  setup({ user: { id: T, email: 'tester@example.com' } });
  assert.equal((await call('GET')).code, 403, 'testers never see the admin view');
  setup({ user: { id: KEVIN2, email: 'kevin.f.gordon1@gmail.com' } });
  assert.equal((await call('GET')).code, 403, 'owner check is email AND id');

  let s = setup();
  let r = await call('GET');
  assert.equal(r.code, 200);
  const users = r.body.users;
  assert.equal(users[0].user_id, KEVIN, 'owner first');
  const byId = Object.fromEntries(users.map((u) => [u.user_id, u]));
  assert.equal(byId[KEVIN].locks.active, 8);
  assert.equal(byId[KEVIN].desk, 'server_keys');
  assert.equal(byId[KEVIN].trading, true);
  assert.equal(byId[T].email, 'tester@example.com');
  assert.deepEqual(byId[T].caps, { perLockUsd: 50, perDayUsd: 250 });
  assert.equal(byId[T].keys.kalshi.label, 'Kalshi connected ••••1234');
  assert.equal(byId[T].keys.polymarket_us.connected, false);
  assert.equal(byId[T].trading, true);
  assert.equal(byId[T].fills.todayContracts, 10);
  assert.equal(byId[KENNY].in_live_users, false, 'lock owner listed even if not approved');
  assert.equal(byId[KENNY].approved, false);
  assert.equal(byId[KENNY].trading, false);
  assert.ok(!JSON.stringify(r.body).includes('SHOULD-NOT-LEAK') && !JSON.stringify(r.body).includes('vault-id'));

  // Pause: kill switch + paused flag; resume clears only the owner pause.
  r = await call('POST', { action: 'pause', user_id: T });
  assert.equal(r.code, 200);
  assert.deepEqual(s.writes[0].slice(0, 2), ['combo_settings', 'upsert']);
  assert.equal(s.writes[0][2].kill_switch, true);
  assert.equal(s.writes[1][2].paused, true);
  assert.equal(s.writes[1][2].paused_by, KEVIN);
  const t1 = r.body.users.find((u) => u.user_id === T);
  assert.equal(t1.paused, true);
  assert.equal(t1.kill_switch, true);
  assert.equal(t1.trading, false);
  r = await call('POST', { action: 'resume', user_id: T });
  const t2 = r.body.users.find((u) => u.user_id === T);
  assert.equal(t2.paused, false);
  assert.equal(t2.kill_switch, true, 'user re-arms their own kill switch');
  // Pausing someone without a live-users row still engages their kill switch.
  s = setup();
  r = await call('POST', { action: 'pause', user_id: KENNY });
  assert.equal(r.code, 200);
  assert.deepEqual(s.writes.map((w) => w[0]), ['combo_settings']);
  // Owner can't pause his own desk here.
  assert.equal((await call('POST', { action: 'pause', user_id: KEVIN })).code, 400);
  assert.equal((await call('POST', { action: 'pause', user_id: 'nope' })).code, 400);
  assert.equal((await call('POST', { action: 'approve', user_id: T })).code, 400, 'no approve action');

  // Caps.
  s = setup();
  r = await call('POST', { action: 'caps', user_id: T, max_per_lock_usd: '25', max_per_day_usd: 100 });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.users.find((u) => u.user_id === T).caps, { perLockUsd: 25, perDayUsd: 100 });
  assert.equal((await call('POST', { action: 'caps', user_id: T, max_per_lock_usd: '', max_per_day_usd: 100 })).code, 400, 'testers need both caps');
  assert.equal((await call('POST', { action: 'caps', user_id: T, max_per_lock_usd: -1, max_per_day_usd: 100 })).code, 400);
  assert.equal((await call('POST', { action: 'caps', user_id: KENNY, max_per_lock_usd: 1, max_per_day_usd: 1 })).code, 404);
  handler._resetDeps();
  console.log('combo-admin.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
