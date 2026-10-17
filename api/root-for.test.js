'use strict';
// Per-user scoping for /api/root-for: a signed-in user only ever reads their OWN locks, fills and orders.
const assert = require('node:assert/strict');
const handler = require('./root-for.js');

const A = { id: 'user-a', email: 'a@example.com' }, B = { id: 'user-b', email: 'b@example.com' };
const open = { archived_at: null, merged_into_id: null, settled_at: null, underlying_settled_at: null };
const tables = {
  combo_parlays: [
    { id: 'pa1', user_id: 'user-a', label: 'A lock', legs: [], ...open },
    { id: 'pa2', user_id: 'user-a', label: 'A lock 2', legs: [], ...open },
    { id: 'pb1', user_id: 'user-b', label: 'B lock', legs: [], ...open },
    { id: 'pb2', user_id: 'user-b', label: 'B settled', legs: [], ...open, settled_at: '2026-10-01' },
  ],
  combo_fills: [{ parlay_id: 'pa1', count: 5 }, { parlay_id: 'pb1', count: 7 }],
  combo_single_orders: [{ id: 'o1', parlay_id: 'pa2' }, { id: 'o2', parlay_id: 'pb1' }],
};
const log = [];
function from(name) {
  const f = []; let head = false;
  const q = {
    select(_c, opts) { if (opts && opts.head) head = true; return q; },
    eq(c, v) { log.push([name, 'eq', c, v]); f.push((r) => r[c] === v); return q; },
    is(c, v) { f.push((r) => r[c] === v); return q; },
    in(c, vs) { log.push([name, 'in', c, vs]); f.push((r) => vs.includes(r[c])); return q; },
    limit() { return q; },
    then(res, rej) { const rows = (tables[name] || []).filter((r) => f.every((fn) => fn(r))); return Promise.resolve(head ? { count: rows.length, error: null } : { data: rows, error: null }).then(res, rej); },
  };
  return q;
}
const tokens = { 'tok-a': A, 'tok-b': B };
handler._setDeps({
  env: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc' },
  createClient: () => ({ from, auth: { getUser: async (t) => (tokens[t] ? { data: { user: tokens[t] }, error: null } : { data: null, error: { message: 'bad' } }) } }),
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  now: () => Date.parse('2026-10-16T22:34:00Z'),
});
function call(token, query = {}) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'GET', headers: token ? { authorization: 'Bearer ' + token } : {}, query }, res);
  });
}

(async () => {
  // logged out → 401
  assert.equal((await call(null)).code, 401);
  // loadLocks directly: B gets only B's open lock, and only fills/orders of B's lock ids
  const { loadLocks, countLocks } = handler._helpers;
  log.length = 0;
  const b = await loadLocks({ from }, B.id);
  assert.deepEqual(b.parlays.map((p) => p.id), ['pb1']);
  assert.deepEqual(b.fills.map((x) => x.parlay_id), ['pb1']);
  assert.deepEqual(b.singles.map((x) => x.id), ['o2']);
  assert.ok(log.some((l) => l[0] === 'combo_parlays' && l[2] === 'user_id' && l[3] === 'user-b'));
  assert.ok(log.filter((l) => l[1] === 'in').every((l) => l[3].every((id) => id.startsWith('pb'))), 'child queries use only B lock ids');
  await assert.rejects(() => loadLocks({ from }, undefined), /no user/);
  assert.equal(await countLocks({ from }, A.id), 2);
  // handler: check mode returns each user's own count; user id always comes from the token, not the query
  assert.deepEqual((await call('tok-a', { check: '1', user_id: 'user-b' })).body, { ok: true, locks: 2 });
  assert.deepEqual((await call('tok-b', { check: '1' })).body, { ok: true, locks: 1 });
  // a user with no open locks gets an empty payload (no market fetches, nothing from other users)
  tokens['tok-c'] = { id: 'user-c', email: 'c@example.com' };
  assert.deepEqual((await call('tok-c')).body, { ok: true, empty: true, locksTotal: 0 });
  console.log('root-for api scoping tests ok');
})().catch((e) => { console.error(e); process.exit(1); });
