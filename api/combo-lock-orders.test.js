'use strict';
const assert = require('node:assert/strict');
const handler = require('./combo-lock-orders.js');
const orders = require('./combo-lock-orders-lib.js');

const KEVIN = '79ae1610-097e-4b46-a622-1e952f18e936';
const KENNY = '42b5ee16-68d5-4b3b-a931-40aa17cd1a47';
const OWNER = { id: KEVIN, email: 'kev120909@gmail.com' };
const KENNY_USER = { id: KENNY, email: 'kmguido97@gmail.com' };

function res() {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function setup({ user = OWNER } = {}) {
  const db = {
    combo_parlays: [{
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      user_id: KENNY,
      label: 'Test lock',
      fill_american: 1200,
      parlay_stake: 100,
      parlay_american: 2000,
      hedge_mode: '1x',
      bet_type: 'cash',
      max_contracts: 3000,
      archived_at: null,
      active: true,
    }],
    combo_live_users: [
      { user_id: KEVIN, fees_enabled: false },
      { user_id: KENNY, fees_enabled: true },
    ],
    combo_fills: [],
    combo_submissions: [{
      id: 'ffffffff-1111-4222-8333-444444444444',
      user_id: KENNY,
      parlay_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      quote_id: 'Q1',
      is_live: true,
      status: 'filled',
      contracts: 100,
    }],
  };
  const writes = [];
  handler._setDeps({
    env: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc' },
    now: () => Date.parse('2026-10-10T05:00:00Z'),
    createClient(_u, key) {
      if (key === 'anon') {
        return { auth: { async getUser(t) { return t === 'good' ? { data: { user }, error: null } : { data: null, error: {} }; } } };
      }
      return {
        from(table) {
          const state = { filters: [], patch: null, sel: false };
          const api = {
            select() { state.sel = true; return api; },
            eq(c, v) { state.filters.push([c, v]); return api; },
            update(patch) { state.patch = patch; writes.push([table, 'update', patch]); return api; },
            async maybeSingle() {
              let rows = db[table] || [];
              for (const [c, v] of state.filters) rows = rows.filter((r) => r[c] === v);
              if (state.patch && rows[0]) Object.assign(rows[0], state.patch);
              return { data: rows[0] || null, error: null };
            },
            then(ok, bad) {
              let rows = db[table] || [];
              for (const [c, v] of state.filters) rows = rows.filter((r) => String(r[c]) === String(v));
              if (state.patch) for (const r of rows) Object.assign(r, state.patch);
              return Promise.resolve({ data: rows, error: null }).then(ok, bad);
            },
          };
          return api;
        },
      };
    },
  });
  return { db, writes };
}

const call = (body, user = OWNER) => {
  setup({ user });
  const r = res();
  return handler({ method: 'POST', headers: { authorization: 'Bearer good' }, body }, r).then(() => r);
};

(async () => {
  assert.equal(orders.validateFillAmerican(99).ok, false);
  assert.equal(orders.resolveExchangeFill(1200, { feesEnabled: false }).fillAmerican, 1200);
  const allIn = 1212; // approx 1% over 1200
  const rev = orders.resolveExchangeFill(allIn, { feesEnabled: true });
  assert.ok(rev.ok);
  assert.ok(rev.fillAmerican < allIn);

  let r = await call(null);
  setup({ user: OWNER });
  {
    const rr = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer good' } }, rr);
    assert.equal(rr.code, 405);
  }
  {
    const rr = res();
    await handler({ method: 'POST', headers: {}, body: { action: 'edit_fill' } }, rr);
    assert.equal(rr.code, 401);
  }

  r = await call({ action: 'edit_fill', parlay_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', fill: 1300 }, KENNY_USER);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(r.body.fill_american < 1300, 'Kenny is fee user — store exchange from all-in');
  assert.ok(r.body.parlay.fill_edited_at);
  assert.ok(r.body.parlay.cancel_open_at);

  r = await call({ action: 'edit_fill', parlay_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', fill: 1100 }, OWNER);
  assert.equal(r.code, 200, 'owner can edit Kenny lock');
  assert.equal(r.body.fees_enabled, true);

  r = await call({ action: 'cancel_all_open', parlay_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, KENNY_USER);
  assert.equal(r.code, 200);
  assert.ok(r.body.cancel_open_at);

  r = await call({ action: 'cancel_quote', submission_id: 'ffffffff-1111-4222-8333-444444444444' }, KENNY_USER);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(r.body.submission.cancel_requested_at);

  // Another Combo Locks user cannot cancel Kenny's quote
  r = await call(
    { action: 'cancel_quote', submission_id: 'ffffffff-1111-4222-8333-444444444444' },
    { id: 'dd23a3a8-cb45-4866-be11-df72b4767c26', email: 'gmoneyvikes@gmail.com' },
  );
  assert.equal(r.code, 403);

  console.log('combo-lock-orders.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
