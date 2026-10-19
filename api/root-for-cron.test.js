'use strict';
// Multi-user needle cron: live only for users with a game in progress, one shared market read, own rows only,
// settle-only for everyone else, unchanged rows not rewritten.
const assert = require('node:assert/strict');
const handler = require('./root-for.js');

const OWNER = '79ae1610-097e-4b46-a622-1e952f18e936';
const open = { archived_at: null, merged_into_id: null, settled_at: null, underlying_settled_at: null };
const leg = (t) => ({ ticker: t, side: 'yes', label: t, game: 'A vs B', type: 'ml' });
const tables = {
  combo_parlays: [
    { id: 'k1', user_id: OWNER, label: 'Kevin live', legs: [leg('KXNFLGAME-26OCT18CHIATL-ATL')], parlay_stake: 100, parlay_american: 150, starts_at: '2026-10-18T17:00:00Z', ...open },
    { id: 'h1', user_id: 'user-h', label: 'Higgins live', legs: [leg('KXNFLGAME-26OCT18HOUJAC-HOU')], parlay_stake: 50, parlay_american: 120, starts_at: '2026-10-18T16:30:00Z', ...open },
    { id: 'b1', user_id: 'user-b', label: 'Next week', legs: [leg('KXNFLGAME-26OCT25CINBAL-BAL')], parlay_stake: 50, parlay_american: 200, starts_at: '2026-10-25T17:00:00Z', ...open },
  ],
  combo_fills: [{ parlay_id: 'k1', count: 1, is_combo: true }, { parlay_id: 'b1', count: 2, is_combo: true }],
  combo_single_orders: [], combo_submissions: [], root_for_pregame_probs: [], combo_lock_leg_fairs: [],
  root_for_needle_days: [
    { user_id: 'user-c', day: '2026-10-17', result: 0, pregame_ev: 0, live_ev: 0, final: false, final_reason: null, snap: { positions: {}, last: {}, frozen: {} } },
    { user_id: 'user-b', day: '2026-10-16', result: 5, pregame_ev: 1, live_ev: 6, final: true, final_reason: 'settled', snap: { positions: {}, last: {}, frozen: {}, settleV: 3 } },
  ],
};
const log = [];
const pick = (r, cols) => { const o = { ...r }; if (/v:snap->>settleV/.test(cols || '')) o.v = r.snap && r.snap.settleV != null ? String(r.snap.settleV) : null; return o; };
function from(name) {
  const f = []; let cols = ''; let upd = null;
  const q = {
    select(c) { cols = c; return q; },
    eq(c, v) { log.push([name, 'eq', c, v]); f.push((r) => r[c] === v); return q; },
    is(c, v) { f.push((r) => r[c] === v); return q; },
    in(c, vs) { log.push([name, 'in', c, vs]); f.push((r) => vs.includes(r[c])); return q; },
    gte(c, v) { f.push((r) => String(r[c]) >= v); return q; },
    lt(c, v) { f.push((r) => String(r[c]) < v); return q; },
    order() { return q; }, limit() { return q; },
    update(v) { upd = v; return q; },
    upsert(row) { log.push([name, 'upsert', row.user_id || row.event, row.day]); const t = tables[name]; const i = t.findIndex((r) => r.user_id === row.user_id && r.day === row.day); if (i >= 0) t[i] = { ...t[i], ...row }; else t.push(row); return Promise.resolve({ error: null }); },
    then(res, rej) {
      const rows = (tables[name] || []).filter((r) => f.every((fn) => fn(r)));
      if (upd) { for (const r of rows) Object.assign(r, upd); log.push([name, 'update', rows.length]); return Promise.resolve({ error: null }).then(res, rej); }
      return Promise.resolve({ data: rows.map((r) => pick(r, cols)), error: null }).then(res, rej);
    },
  };
  return q;
}
const urls = [];
handler._setDeps({
  env: { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_KEY: 'svc', CRON_SECRET: 'cs', ODDS_RELAY_URL: 'http://relay' },
  createClient: () => ({ from }),
  fetch: async (u) => { urls.push(String(u)); return { ok: true, status: 200, json: async () => (/orderbooks/.test(u) ? { orderbooks: [] } : /\/health/.test(u) ? { status: {} } : /board\?/.test(u) ? { quotes: [] } : { markets: [] }) }; },
  now: () => Date.parse('2026-10-18T18:00:00Z'),
});
function call(query, headers = {}) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'GET', headers, query }, res);
  });
}
(async () => {
  assert.equal((await call({ cron: 'needle' })).code, 401);
  assert.equal((await call({ cron: 'needle' }, { authorization: 'Bearer nope' })).code, 401);
  const r = await call({ cron: 'needle' }, { authorization: 'Bearer cs' });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.users, 3); assert.equal(r.body.live, 2); assert.equal(r.body.idle, 1); assert.equal(r.body.settled, 1);
  // one shared read of children for the live users' locks only (never the idle user's lock)
  const fillReads = log.filter((l) => l[0] === 'combo_fills' && l[1] === 'in');
  assert.equal(fillReads.length, 1); assert.deepEqual([...fillReads[0][3]].sort(), ['h1', 'k1']);
  // one Kalshi orderbook read for both live users, and nothing for the idle user's game
  assert.equal(urls.filter((u) => /orderbooks/.test(u)).length, 1);
  assert.ok(!urls.some((u) => /CINBAL/.test(u)), 'idle user: no live price pulls');
  // idle user b: no snapshot writes; settled user c: one settle write, then quiet
  assert.ok(!log.some((l) => l[1] === 'upsert' && l[2] === 'user-b'));
  assert.equal(log.filter((l) => l[1] === 'upsert' && l[2] === 'user-c').length, 1);
  const c = tables.root_for_needle_days.find((x) => x.user_id === 'user-c');
  assert.equal(c.final, true); assert.equal(c.final_reason, 'settled');
  log.length = 0; urls.length = 0;
  const r2 = await call({ cron: 'needle' }, { authorization: 'Bearer cs' });
  assert.equal(r2.body.settled, 0);
  assert.ok(!log.some((l) => l[1] === 'upsert' && l[0] === 'root_for_needle_days' && l[2] === 'user-c'), 'settled rows are not rewritten');
  // nobody in a game: no market reads at all
  handler._setDeps({ now: () => Date.parse('2026-10-19T15:00:00Z') });
  log.length = 0; urls.length = 0;
  const r3 = await call({ cron: 'needle' }, { authorization: 'Bearer cs' });
  assert.equal(r3.body.live, 0); assert.equal(urls.length, 0); assert.ok(!log.some((l) => l[0] === 'combo_fills'));
  console.log('root-for cron (all users) tests ok');
})().catch((e) => { console.error(e); process.exit(1); });
