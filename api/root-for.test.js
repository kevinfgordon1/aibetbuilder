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
    { id: 'ph1', user_id: '721c1166-be0b-4856-8a88-6de3a8b047b9', label: 'Chris lock', legs: [], ...open },
    { id: 'pb2', user_id: 'user-b', label: 'B settled', legs: [], ...open, settled_at: '2026-10-01' },
  ],
  combo_live_users: [],
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
function call(token, query = {}, headers = {}) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'GET', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, query }, res);
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
  // View as: only the owner may read another Combo Locks user's sheet
  const CHRIS = '721c1166-be0b-4856-8a88-6de3a8b047b9';
  tokens['tok-owner'] = { id: '79ae1610-097e-4b46-a622-1e952f18e936', email: 'kev120909@gmail.com' };
  assert.deepEqual((await call('tok-owner', { check: '1' }, { 'x-view-as': CHRIS })).body, { ok: true, locks: 1 });
  assert.deepEqual((await call('tok-owner', { check: '1', view_as: CHRIS })).body, { ok: true, locks: 1 });
  // non-owner asking to view as someone → 403, never their data
  const deny = await call('tok-a', { check: '1' }, { 'x-view-as': CHRIS });
  assert.equal(deny.code, 403); assert.equal(deny.body.locks, undefined);
  assert.equal((await call('tok-a', { check: '1', view_as: CHRIS })).code, 403);
  // owner can't view a non-Combo-Locks id
  assert.equal((await call('tok-owner', { check: '1' }, { 'x-view-as': '00000000-0000-4000-8000-000000000000' })).code, 404);
  // kickoff matching: Kalshi placeholder times are replaced by the real start or dropped
  const { matchKey, isPlaceholderStart, loadMarkets } = handler._helpers;
  assert.equal(matchKey('Northwestern', 'Michigan St.'), matchKey('Northwestern', 'Michigan State'));
  assert.ok(isPlaceholderStart('2026-10-17T03:00:00Z')); assert.ok(!isPlaceholderStart('2026-10-17T19:30:00Z'));
  const boards = {
    kalshi: [{ ticker: 'KXNCAAFGAME-26OCT16MIZZMISS-MISS', away: 'Missouri', home: 'Ole Miss', start: '2026-10-17T03:00:00Z' },
      { ticker: 'KXNCAAFGAME-26OCT16NWMSU-NW', away: 'Northwestern', home: 'Michigan St.', start: '2026-10-17T03:00:00Z' },
      { ticker: 'KXNCAAFGAME-26OCT16XXYY-XX', away: 'Nowhere', home: 'Elsewhere', start: '2026-10-17T03:00:00Z' }],
    polymarket: [{ away: 'Missouri', home: 'Ole Miss', start: '2026-10-17T19:30:00Z' }],
    novig: [{ away: 'Northwestern', home: 'Michigan State', start: '2026-10-17T16:00:00.000Z' }],
  };
  const fakeFetch = async (u) => {
    const m = /board\?venue=(\w+)&league=NCAAF/.exec(u);
    const body = /\/health/.test(u) ? { status: {} } : m ? { quotes: boards[m[1]] } : /orderbooks/.test(u) ? { orderbooks: [] } : /NFL/.test(u) ? { quotes: [] } : { markets: [{ expected_expiration_time: '2026-10-17T03:00:00Z' }] };
    return { ok: true, json: async () => body };
  };
  const M = { tickersNeeded: () => ['KXNCAAFGAME-26OCT16MIZZMISS-MISS', 'KXNCAAFGAME-26OCT16NWMSU-NW', 'KXNCAAFGAME-26OCT16XXYY-XX'], kalshiAsks: () => ({}), relayIndex: () => ({}) };
  const mk = await loadMarkets(M, [], { ODDS_RELAY_URL: 'http://relay' }, fakeFetch, () => 0);
  assert.equal(mk.starts['KXNCAAFGAME-26OCT16MIZZMISS'], '2026-10-17T19:30:00.000Z');
  assert.equal(mk.starts['KXNCAAFGAME-26OCT16NWMSU'], '2026-10-17T16:00:00.000Z');
  assert.equal(mk.starts['KXNCAAFGAME-26OCT16XXYY'], null);
  // NFL: Kalshi "HOU Texans" == Polymarket "Houston Texans"; a Kalshi board start (kickoff + 3h) is never used for football
  const { nflTeam, lockStarts } = handler._helpers;
  assert.equal(nflTeam('HOU Texans'), 'HOU'); assert.equal(nflTeam('Jacksonville Jaguars'), 'JAC'); assert.equal(nflTeam('New York J'), 'NYJ');
  assert.equal(nflTeam('Los Angeles R'), 'LAR'); assert.equal(nflTeam('LA Chargers'), 'LAC'); assert.equal(nflTeam('NOLA Saints'), 'NO'); assert.equal(nflTeam('Nowhere'), null);
  const nfl = {
    kalshi: [{ ticker: 'KXNFLGAME-26OCT18HOUJAC-HOU', away: 'HOU Texans', home: 'JAC Jaguars', start: '2026-10-18T16:30:00Z' },
      { ticker: 'KXNFLGAME-26OCT18CHIATL-ATL', away: 'Chicago Bears', home: 'Atlanta Falcons', start: '2026-10-18T17:00Z' },
      { ticker: 'KXNFLGAME-26OCT25CINBAL-BAL', away: 'Cincinnati', home: 'Baltimore', start: '2026-10-25T20:00:00Z' },
      { ticker: 'KXNFLGAME-26OCT25TBCAR-TB', away: 'Tampa Bay', home: 'Carolina', start: '2026-10-25T20:00:00Z' }],
    polymarket: [{ away: 'Houston Texans', home: 'Jacksonville Jaguars', start: '2026-10-18T13:30:00Z' }, { away: 'Chicago Bears', home: 'Atlanta Falcons', start: '2026-10-18T17:00:00Z' }],
    novig: [],
  };
  const fetch2 = async (u) => {
    const m = /board\?venue=(\w+)&league=NFL/.exec(u);
    const body = /\/health/.test(u) ? { status: {} } : m ? { quotes: nfl[m[1]] } : /orderbooks/.test(u) ? { orderbooks: [] } : /NCAAF/.test(u) ? { quotes: [] } : { markets: [] };
    return { ok: true, json: async () => body };
  };
  const locks = [{ starts_at: '2026-10-25T17:00:00+00:00', legs: [{ ticker: 'KXNFLGAME-26OCT25TBCAR-TB' }, { ticker: 'KXNFLTOTAL-26OCT25TBCAR-45' }] },
    { starts_at: '2026-10-18T13:30:00+00:00', legs: [{ ticker: 'KXNFLGAME-26OCT25CINBAL-BAL' }, { ticker: 'KXNFLGAME-26OCT18HOUJAC-HOU' }] }];
  assert.deepEqual(lockStarts(locks), { '26OCT25TBCAR': '2026-10-25T17:00:00.000Z' });
  const M2 = { tickersNeeded: () => [], kalshiAsks: () => ({}), relayIndex: () => ({}) };
  const mk2 = await loadMarkets(M2, locks, { ODDS_RELAY_URL: 'http://relay' }, fetch2, () => 0);
  assert.equal(mk2.starts['KXNFLGAME-26OCT18HOUJAC'], '2026-10-18T13:30:00.000Z');
  assert.equal(mk2.starts['KXNFLGAME-26OCT18CHIATL'], '2026-10-18T17:00:00.000Z');
  assert.equal(mk2.starts['KXNFLGAME-26OCT25CINBAL'], null); // Kalshi-only, multi-game lock: unknown, not kickoff + 3h
  assert.equal(mk2.starts['KXNFLGAME-26OCT25TBCAR'], '2026-10-25T17:00:00.000Z'); // single-game lock's starts_at
  console.log('root-for api scoping tests ok');
})().catch((e) => { console.error(e); process.exit(1); });
