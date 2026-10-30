'use strict';
// Oct 29 2026: Kalshi listed KXNBAGAME-26OCT29CLEATL with occurrence_datetime 02:00Z, but ESPN's tip was
// 8:00 PM ET (00:00Z). occurrence - 3h = 7:00 PM ET, so /api/kalshi-games moved the game to `started` an
// hour early and Combo Locks refused a Cavs leg at 7:51 PM ("started at 7:00 PM ET"). The official
// schedule must put such a game back on the pre-game slate; with no official answer it stays started.
const assert = require('assert');
const KG = require('./kalshi-games.js');
const h = KG._helpers;
const G = require('../lib/game-schedule');
const espn = G.espnRows('NBA', require('./fixtures-espn-nba-2026-10-29.json')); // real ESPN scoreboard, Oct 29 2026 8:00 PM ET

const ev = (key, occ, a, b) => ({
  event_ticker: `KXNBAGAME-${key}`, title: `${a.label} vs ${b.label}`, sub_title: `${a.code} vs ${b.code} (Oct 29)`,
  markets: [a, b].map((s) => ({ ticker: `KXNBAGAME-${key}-${s.code}`, yes_sub_title: s.label, occurrence_datetime: occ })),
});
const side = [
  ev('26OCT29CLEATL', '2026-10-30T02:00:00Z', { code: 'CLE', label: 'Cleveland' }, { code: 'ATL', label: 'Atlanta' }), // tip + 2h
  ev('26OCT29SACNOP', '2026-10-30T03:00:00Z', { code: 'SAC', label: 'Sacramento' }, { code: 'NOP', label: 'New Orleans' }), // tip + 3h
  ev('26OCT29MEMPOR', '2026-10-30T05:00:00Z', { code: 'MEM', label: 'Memphis' }, { code: 'POR', label: 'Portland' }),
];
const OPTS = { occurrenceStartOffsetMs: KG.OCCURRENCE_START_OFFSET_MS.nba };
const AT_751 = Date.parse('2026-10-29T23:51:00Z'); // 7:51 PM ET

(async () => {
  const games = h.groupSportGames({ side }, AT_751, OPTS);
  // Kalshi-only view (unchanged): CLE/ATL reads as started at 7:00 PM ET.
  assert.deepStrictEqual(games.map((g) => g.key), ['26OCT29SACNOP', '26OCT29MEMPOR']);
  assert.deepStrictEqual(games.started.map((g) => [g.key, g.startTime]), [['26OCT29CLEATL', '2026-10-29T23:00:00.000Z']]);
  assert.strictEqual(games.provisional.length, 1);
  assert.strictEqual(games.provisional[0].markets.side.length, 2);

  const wrap = (list) => list.map((g) => ({ ...g, sport: 'nba' }));
  const mk = () => ({ sports: { nba: wrap(games) }, started: { nba: wrap(games.started) }, provisional: { nba: wrap(games.provisional) } });

  // Official schedule says 8:00 PM ET, not started: back on the slate with the official time.
  let s = mk();
  await h.applyCanonicalStarts(s.sports, s.started, AT_751, async () => ({ games: espn }), 1500, Date.now, s.provisional);
  const cle = s.sports.nba.find((g) => g.key === '26OCT29CLEATL');
  assert.ok(cle, 'CLE/ATL restored');
  assert.strictEqual(cle.startTime, '2026-10-30T00:00:00.000Z');
  assert.strictEqual(cle.startVerified, true);
  assert.strictEqual(cle.kickoffSource, 'official');
  assert.ok(!('kalshiStartedAt' in cle));
  assert.strictEqual(cle.markets.side.length, 2);
  assert.ok(!s.started.nba, 'no longer listed as started');
  assert.deepStrictEqual(s.sports.nba.map((g) => g.key).sort(), ['26OCT29CLEATL', '26OCT29MEMPOR', '26OCT29SACNOP']);
  assert.ok(s.sports.nba.every((g, i, a) => !i || Date.parse(a[i - 1].startTime) <= Date.parse(g.startTime)), 'slate stays in start order');

  // After the real tip it is started, with the official time in the message.
  s = mk();
  const AT_805 = Date.parse('2026-10-30T00:05:00Z');
  await h.applyCanonicalStarts(s.sports, s.started, AT_805, async () => ({ games: espn }), 1500, Date.now, s.provisional);
  assert.ok(!s.sports.nba.some((g) => g.key === '26OCT29CLEATL'));
  assert.deepStrictEqual(s.started.nba.find((g) => g.key === '26OCT29CLEATL').startTime, '2026-10-30T00:00:00.000Z');

  // No official schedule (empty / timed out): fail safe, stays started.
  s = mk();
  await h.applyCanonicalStarts(s.sports, s.started, AT_751, async () => ({ games: [] }), 1500, Date.now, s.provisional);
  assert.ok(!s.sports.nba.some((g) => g.key === '26OCT29CLEATL'));
  assert.strictEqual(s.started.nba[0].key, '26OCT29CLEATL');
  s = mk();
  await h.applyCanonicalStarts(s.sports, s.started, AT_751, () => new Promise(() => {}), 20, Date.now, s.provisional);
  assert.ok(!s.sports.nba.some((g) => g.key === '26OCT29CLEATL'));
  assert.strictEqual(s.started.nba[0].key, '26OCT29CLEATL');

  console.log('api/kalshi-games-early-start.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
