'use strict';
// Locks auto-archived at first kickoff + 6h (hourly cron) but still holding a later game (SNF/MNF) stay in root-for.
const assert = require('node:assert/strict');
const handler = require('./root-for.js');
const NOW = Date.parse('2026-10-26T00:38:00Z');
const base = { merged_into_id: null, settled_at: null, underlying_settled_at: null, user_id: 'u1', legs: [] };
const rows = [
  { id: 'open', ...base, archived_at: null, starts_at: '2026-10-25T17:00:00Z' },
  { id: 'auto', ...base, archived_at: '2026-10-25T23:00:00.19Z', starts_at: '2026-10-25T17:00:00Z' }, // SNF leg still live
  { id: 'manual', ...base, archived_at: '2026-10-25T15:00:00Z', starts_at: '2026-10-25T17:00:00Z' },  // moved to History by hand
  { id: 'old', ...base, archived_at: '2026-10-20T23:00:00Z', starts_at: '2026-10-20T17:00:00Z' },
  { id: 'settled', ...base, archived_at: '2026-10-25T23:00:00Z', starts_at: '2026-10-25T17:00:00Z', settled_at: '2026-10-25T23:30:00Z' },
];
const f = handler._autoArchivedStillOpen;
assert.equal(f(rows[1], NOW), true);
assert.equal(f(rows[0], NOW), false);
assert.equal(f(rows[2], NOW), false);
assert.equal(f(rows[3], NOW), false);
assert.equal(f(rows[4], NOW), false);

function from() {
  const fl = [];
  const q = { select() { return q; }, eq(c, v) { fl.push((r) => r[c] === v); return q; }, is(c, v) { fl.push((r) => r[c] === v); return q; }, in(c, vs) { fl.push((r) => vs.includes(r[c])); return q; },
    gte() { return q; }, limit() { return q; }, order() { return q; },
    then(res, rej) { return Promise.resolve({ data: rows.filter((r) => fl.every((fn) => fn(r))), error: null }).then(res, rej); } };
  return q;
}
handler._setDeps({ now: () => NOW });
(async () => {
  const out = await handler._helpers.loadLocks({ from }, 'u1');
  assert.deepEqual(out.parlays.map((p) => p.id).sort(), ['auto', 'open']);
  console.log('root-for auto-archived ok');
})().catch((e) => { console.error(e); process.exit(1); });
