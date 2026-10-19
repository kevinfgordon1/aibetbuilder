'use strict';
// node api/combo-leg-fairs.test.js
const assert = require('node:assert/strict');
const handler = require('./combo-leg-fairs.js');
const rootFor = require('./root-for.js');

const NOW = Date.parse('2026-10-19T23:55:00Z');
const ML = 'KXNFLGAME-26OCT19WASSF';
const deep = (p) => [[p, 100000]];
function fakeDb(parlays, existing = []) {
  const writes = [];
  const rows = Object.fromEntries(existing.map((r) => [r.parlay_id, { ...r }]));
  const from = (table) => {
    const st = { table, f: [] };
    const b = {
      select() { return b; }, is(c, v) { st.f.push((r) => r[c] == null); return b; }, eq(c, v) { st.f.push((r) => r[c] === v); return b; },
      or() { st.f.push((r) => r.starts_at == null || Date.parse(r.starts_at) > NOW); return b; }, limit() { return b; },
      in(c, ids) { st.f.push((r) => ids.includes(r[c])); return b; },
      upsert(list) { for (const r of list) { writes.push(r); rows[r.parlay_id] = { ...(rows[r.parlay_id] || {}), ...r }; } return Promise.resolve({ error: null }); },
      then(res, rej) { const src = table === 'combo_parlays' ? parlays : Object.values(rows); return Promise.resolve({ data: src.filter((r) => st.f.every((fn) => fn(r))), error: null }).then(res, rej); },
    };
    return b;
  };
  return { writes, rows, client: { from, auth: { async getUser(t) { return t === 'good' ? { data: { user: { id: 'u1' } }, error: null } : { data: null, error: { message: 'bad' } }; } } } };
}
function fetchStub(u) {
  const url = String(u);
  if (url.includes('/markets/orderbooks')) {
    const books = { [`${ML}-SF`]: { yes_dollars: [[0.70, 100000]], no_dollars: [[0.29, 100000]] }, [`${ML}-WAS`]: { yes_dollars: [[0.29, 100000]], no_dollars: [[0.70, 100000]] } };
    const tickers = [...new URL(url).searchParams.getAll('tickers')];
    return Promise.resolve({ ok: true, json: async () => ({ orderbooks: tickers.filter((t) => books[t]).map((t) => ({ ticker: t, orderbook_fp: books[t] })) }) });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}
function call(method, { query = {}, auth = null } = {}) {
  const out = { code: 200, body: null }; const res = { setHeader() {}, status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } };
  return handler({ method, query, headers: auth ? { authorization: 'Bearer ' + auth } : {} }, res).then(() => out);
}

(async () => {
  const lockSoon = { id: 'p1', user_id: 'u1', legs: [{ ticker: `${ML}-SF`, side: 'yes' }], starts_at: '2026-10-20T00:15:00Z', archived_at: null, merged_into_id: null, settled_at: null, underlying_settled_at: null };
  const lockLater = { id: 'p2', user_id: 'u2', legs: [{ ticker: `${ML}-WAS`, side: 'yes' }], starts_at: '2026-10-21T00:15:00Z', archived_at: null, merged_into_id: null, settled_at: null, underlying_settled_at: null };
  const started = { id: 'p3', user_id: 'u1', legs: [{ ticker: `${ML}-SF`, side: 'yes' }], starts_at: '2026-10-19T20:00:00Z', archived_at: null, merged_into_id: null, settled_at: null, underlying_settled_at: null };
  const env = { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_KEY: 's', CRON_SECRET: 'cron', ODDS_RELAY_URL: 'http://relay.invalid' };

  // cron: p1 in the 20-min window → at_lock (first-seen) + pregame; p2 → at_lock only; p3 started → nothing
  {
    const db = fakeDb([lockSoon, lockLater, started]);
    handler._setDeps({ env, createClient: () => db.client, fetch: fetchStub, now: () => NOW });
    assert.equal((await call('GET', { query: { cron: '1' }, auth: 'nope' })).code, 401);
    const r = await call('GET', { query: { cron: '1' }, auth: 'cron' });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.written, 2);
    assert.ok(db.rows.p1.pregame && db.rows.p1.at_lock && db.rows.p1.at_lock_src === 'first-seen');
    assert.ok(db.rows.p1.pregame[`${ML}-SF:yes`].p > 0.6);
    assert.ok(db.rows.p2.at_lock && !db.rows.p2.pregame);
    assert.ok(!db.rows.p3);
    // second run: p1 pregame refreshed, at_lock untouched (never re-sent, so never nulled)
    const before = db.rows.p1.at_lock_at; db.writes.length = 0;
    const r2 = await call('GET', { query: { cron: '1' }, auth: 'cron' });
    assert.equal(r2.body.written, 1); assert.ok(!('at_lock' in db.writes[0])); assert.equal(db.rows.p1.at_lock_at, before);
  }
  // POST: only the caller's own unstarted locks, at_lock src add-lock
  {
    const db = fakeDb([lockSoon, lockLater, started]);
    handler._setDeps({ env, createClient: () => db.client, fetch: fetchStub, now: () => NOW });
    assert.equal((await call('POST', { auth: 'bad' })).code, 401);
    const r = await call('POST', { auth: 'good' });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(db.rows), ['p1']);
    assert.equal(db.rows.p1.at_lock_src, 'add-lock'); assert.ok(!db.rows.p1.pregame);
  }
  // root-for lockBaselines: a pregame value saved 5 min before kickoff is used (no candle fetch), st counted
  {
    let fetched = 0; rootFor._setDeps({ fetch: async () => { fetched += 1; return { ok: false, status: 404, json: async () => ({}) }; } });
    const t0 = Date.parse('2026-10-20T00:15:00Z');
    const pos = [{ id: 'p1', legs: [{ event: ML, kind: 'game', outcomes: ['WAS', 'SF'], allowed: ['SF'] }], hit: 100, miss: -50 }];
    const snap = {}; const liveP = { [ML]: { WAS: 0.2, SF: 0.8 } };
    const rec = { p1: { pregame: { [`${ML}-SF:yes`]: { p: 0.66 } }, pregame_at: new Date(t0 - 5 * 60000).toISOString() } };
    await rootFor._helpers.lockBaselines(snap, pos, liveP, liveP, { [ML]: new Date(t0).toISOString() }, [], t0 + 30 * 60000, async () => rec);
    assert.equal(fetched, 0);
    assert.equal(snap.lockPre.p1.st, 1); assert.equal(snap.lockPre.p1.fb, 0); assert.equal(snap.lockPre.p1.n, 1);
    assert.ok(Math.abs(snap.lockPre.p1.probs[ML].SF - 0.66) < 1e-9);
    // only an at-lock value from hours earlier: candles first (404 here) → saved value as the estimate (fb)
    const snap2 = {}; const rec2 = { p1: { at_lock: { [`${ML}-SF:yes`]: { p: 0.61 } }, at_lock_at: new Date(t0 - 6 * 3600000).toISOString() } };
    await rootFor._helpers.lockBaselines(snap2, pos, liveP, liveP, { [ML]: new Date(t0).toISOString() }, [], t0 + 30 * 60000, async () => rec2);
    assert.ok(fetched > 0); assert.equal(snap2.lockPre.p1.st, 0); assert.equal(snap2.lockPre.p1.fb, 1);
    assert.ok(Math.abs(snap2.lockPre.p1.probs[ML].SF - 0.61) < 1e-9);
  }
  console.log('combo-leg-fairs tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
