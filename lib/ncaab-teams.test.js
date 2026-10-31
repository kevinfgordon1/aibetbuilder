// Canonical NCAAB team table shared with combo-worker (Kevin Oct 30 2026). lib/ncaab-teams.json + lib/ncaab-teams.js
// are COPIES (scripts/sync-ncaab-teams.cjs); never edit them here.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const T = require('./ncaab-teams');
const D1 = require('./ncaab-d1');
const table = require('./ncaab-teams.json');
const sync = require('./ncaab-teams.sync.json');

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex');
assert.equal(sha('ncaab-teams.json'), sync.jsonSha256, 'lib/ncaab-teams.json was edited by hand: run node scripts/sync-ncaab-teams.cjs');
assert.equal(sha('ncaab-teams.js'), sync.jsSha256, 'lib/ncaab-teams.js was edited by hand: run node scripts/sync-ncaab-teams.cjs');
assert.equal(table.contentHash, sync.contentHash);
assert.equal(crypto.createHash('sha256').update(JSON.stringify(table.teams) + JSON.stringify(table.ambiguous)).digest('hex').slice(0, 16), table.contentHash, 'contentHash');
assert.equal(table.teams.length, 365);
// same D1 list as lib/ncaab-d1-teams.json
const d1 = new Set(require('./ncaab-d1-teams.json').teams.map((t) => String(t.espnId)));
for (const t of table.teams) assert.ok(d1.has(t.espnId), `${t.display} missing from lib/ncaab-d1-teams.json`);

// every known venue spelling of a team resolves to that team through lib/ncaab-d1.js (Promo / board / futures)
let n = 0;
for (const t of table.teams) for (const [src, a] of Object.entries(t.aliases)) for (const name of a.names || []) {
  const r = T.resolveTeam(src, { name });
  if (!r.espnId) continue; // a spelling two schools share: resolved only with context
  assert.equal(r.espnId, t.espnId, `${src} "${name}"`);
  const x = D1.d1Team(name);
  if (x) assert.equal(x.espnId, t.espnId, `d1Team("${name}")`);
  n += 1;
}
assert.ok(n > 1500, `aliases checked ${n}`);
// sportsbook futures / Odds API names that ESPN spells differently
for (const [name, id] of Object.entries({ 'Loyola (Chi) Ramblers': '2350', 'Grand Canyon Antelopes': '2253', 'GW Revolutionaries': '45', 'Army Knights': '349', 'UMKC Kangaroos': '140', 'CSU Bakersfield Roadrunners': '2934', 'Texas A&M-CC Islanders': '357' })) {
  assert.equal((D1.d1Team(name) || {}).espnId, id, name);
}
for (const name of ['Fisk', 'Oakwood', 'Hartford Hawks', 'St. Francis (PA) Red Flash']) assert.equal(D1.d1Team(name), null, `${name} not D1`);
// Kalshi OAK = Oakland AND Oakwood: context, never the code alone
assert.equal(T.resolveTeam('kalshi', { code: 'OAK' }).espnId, null);
T.setSchedule([{ homeId: '130', awayId: '2473', date: '2026-11-02T23:00Z' }]);
assert.equal(T.resolveTeam('kalshi', { code: 'OAK' }, { opponentId: '130', date: '2026-11-02' }).espnId, '2473');
console.log(`ncaab-teams ok (${n} aliases)`);
