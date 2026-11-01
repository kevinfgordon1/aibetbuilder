'use strict';
// Saved day rows v4 (Kevin, Nov 1 2026): unpriced locks touching the day are added for Actual P/L (not EV), kickoff
// times are saved for bar order; read paths upgrade a pre-v4 row in memory without writing.
const assert = require('node:assert/strict');
const handler = require('./root-for.js');
const H = handler._helpers;

const U = 'user-k';
const lostPos = { id: 'p1', legs: [{ event: 'KXNBAGAME-26OCT31PORUTA', kind: 'game', outcomes: ['POR', 'UTA'], allowed: ['UTA'] }], hit: 900, miss: -100 };
const snap0 = () => ({ positions: { p1: lostPos }, last: { 'KXNBAGAME-26OCT31PORUTA': { POR: 0.9, UTA: 0.1 } }, frozen: { 'KXNBAGAME-26OCT31PORUTA': { POR: 0.7, UTA: 0.3 } },
  final: { 'KXNBAGAME-26OCT31PORUTA': { POR: 1, UTA: 0 } }, lockPre: { p1: { t0: '2026-10-31T19:00:00Z', pos: lostPos, probs: { 'KXNBAGAME-26OCT31PORUTA': { POR: 0.7, UTA: 0.3 } }, adds: 0 } }, settleV: 3 });
const tables = {
  combo_parlays: [
    { id: 'p1', user_id: U, label: 'Utah', legs: [{ ticker: 'KXNBAGAME-26OCT31PORUTA-UTA', side: 'yes' }], parlay_stake: 100, parlay_american: 800, is_free_bet: false, starts_at: '2026-10-31T19:00:00Z', archived_at: '2026-10-31T21:30:00Z', merged_into_id: null },
    { id: 'be13', user_id: U, label: 'BYU -17 + Virginia', legs: [{ ticker: 'KXNCAAFSPREAD-26OCT31ASUBYU-BYU17', side: 'yes' }, { ticker: 'KXNCAAFGAME-26OCT30UVAWAKE-UVA', side: 'yes' }], parlay_stake: 55, parlay_american: 1310, is_free_bet: false, starts_at: '2026-10-31T19:30:00Z', archived_at: '2026-10-31T23:30:00Z', merged_into_id: null },
    { id: 'manual', user_id: U, label: 'moved to History before kickoff', legs: [{ ticker: 'KXNCAAFGAME-26OCT30UVAWAKE-WAKE', side: 'yes' }], parlay_stake: 20, parlay_american: 200, is_free_bet: false, starts_at: '2026-10-31T19:30:00Z', archived_at: '2026-10-31T12:00:00Z', merged_into_id: null },
    { id: 'old', user_id: U, label: 'last week, one leg today', legs: [{ ticker: 'KXNBAGAME-26OCT31PORUTA-POR', side: 'yes' }, { ticker: 'KXNCAAFGAME-26OCT24GASTARST-GAST', side: 'yes' }], parlay_stake: 200, parlay_american: 510, is_free_bet: false, starts_at: '2026-10-29T23:00:00Z', archived_at: '2026-10-30T05:00:00Z', underlying_settled_at: '2026-10-30T04:00:00Z', merged_into_id: null },
    { id: 'other-user', user_id: 'someone', label: 'x', legs: [{ ticker: 'KXNCAAFGAME-26OCT30UVAWAKE-UVA', side: 'yes' }], parlay_stake: 20, parlay_american: 200, is_free_bet: false, starts_at: '2026-10-31T19:30:00Z', archived_at: null, merged_into_id: null },
  ],
  combo_fills: [], combo_single_orders: [], combo_submissions: [],
  root_for_pregame_probs: [{ event: 'KXNBAGAME-26OCT31PORUTA', kickoff: '2026-10-31T19:00:00Z' }],
  root_for_needle_days: [],
};
const writes = [];
function from(name) {
  const f = [];
  const q = {
    select() { return q; },
    eq(c, v) { f.push((r) => r[c] === v); return q; },
    is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
    in(c, vs) { f.push((r) => vs.includes(r[c])); return q; },
    not(c, op, v) { f.push((r) => (r[c] ?? null) !== v); return q; },
    gte(c, v) { f.push((r) => r[c] != null && Date.parse(r[c]) >= Date.parse(v) || String(r[c]) >= v); return q; },
    lte(c, v) { f.push((r) => r[c] != null && Date.parse(r[c]) <= Date.parse(v)); return q; },
    order() { return q; }, limit() { return q; },
    upsert(row) { writes.push(row); const t = tables[name]; const i = t.findIndex((r) => r.user_id === row.user_id && r.day === row.day); if (i >= 0) t[i] = { ...t[i], ...row }; else t.push(row); return Promise.resolve({ error: null }); },
    then(res, rej) { return Promise.resolve({ data: (tables[name] || []).filter((r) => f.every((fn) => fn(r))), error: null }).then(res, rej); },
  };
  return q;
}
const client = { from };
const fetched = [];
handler._setDeps({
  now: () => Date.parse('2026-11-01T05:00:00Z'),
  fetch: async (u) => {
    fetched.push(String(u)); const s = String(u);
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (s.includes('event_ticker=KXNCAAFGAME-26OCT30UVAWAKE')) return ok({ markets: [{ ticker: 'KXNCAAFGAME-26OCT30UVAWAKE-UVA', status: 'finalized', result: 'no' }, { ticker: 'KXNCAAFGAME-26OCT30UVAWAKE-WAKE', status: 'finalized', result: 'yes' }] });
    if (s.includes('event_ticker=KXNCAAFGAME-26OCT31ASUBYU')) return ok({ markets: [{ ticker: 'KXNCAAFGAME-26OCT31ASUBYU-ASU', status: 'finalized', result: 'yes' }, { ticker: 'KXNCAAFGAME-26OCT31ASUBYU-BYU', status: 'finalized', result: 'no' }] });
    return ok({ markets: [] });
  },
});

(async () => {
  const S = await import('../src/rootForSweat.js');
  // 1) read path: pre-v4 row upgraded in memory, nothing written
  const row = { day: '2026-10-31', final: true, final_reason: 'settled', pregame_ev: 50, live_ev: -100, result: -150, snap: snap0() };
  const up = await H.upgradeDayRowForRead(client, U, row);
  assert.equal(writes.length, 0, 'read path never writes');
  assert.equal(row.snap.unpriced, undefined, 'original row untouched');
  assert.deepEqual(Object.keys(up.snap.unpriced), ['be13'], 'only the day’s unpriced lock (no manual History move, no lock decided before the day, no other user)');
  assert.equal(up.snap.unpriced.be13.miss, -55);
  assert.equal(up.snap.starts['KXNBAGAME-26OCT31PORUTA'], '2026-10-31T19:00:00.000Z');
  assert.deepEqual(up.snap.final['KXNCAAFGAME-26OCT30UVAWAKE'], { UVA: 0, WAKE: 1 });
  const unp = Object.values(up.snap.unpriced).filter((p) => S.lockDecided(p, up.snap.final));
  const actual = S.dayValue(Object.values(up.snap.positions), { ...up.snap.last, ...up.snap.final }, up.snap.final) + S.dayValue(unp, up.snap.final, up.snap.final);
  assert.equal(actual, -155, 'Actual counts the unpriced loss');
  // 2) settle pass: writes v4 once; EV numbers (pregame/live) are unchanged by unpriced locks
  tables.root_for_needle_days.push({ user_id: U, ...row, snap: snap0() });
  await H.settleDays(client, U, Date.parse('2026-11-01T05:00:00Z'));
  assert.equal(writes.length, 1);
  const w = writes[0];
  assert.equal(w.snap.settleV, 4); assert.ok(w.snap.unpriced && w.snap.unpriced.be13);
  assert.equal(Math.round(w.live_ev), -100, 'live_ev = priced locks only');
  // 3) next pass: settled + v4 + unpriced decided → skipped (no rewrite)
  await H.settleDays(client, U, Date.parse('2026-11-01T05:05:00Z'));
  assert.equal(writes.length, 1, 'no rewrite once v4 and decided');
  console.log('root-for day unpriced ok');
})().catch((e) => { console.error(e); process.exit(1); });
