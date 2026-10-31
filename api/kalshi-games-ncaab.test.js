'use strict';
// NCAAB on the Combo Locks game list (Kevin Oct 30 2026): KXNCAAMB* series, tip = occurrence - 3h, D1 vs D1 only.
const assert = require('node:assert/strict');
const handler = require('./kalshi-games.js');
const h = handler._helpers;
const fx = require('./fixtures-kalshi-ncaamb.json');
const { isD1Game, isD1Team, D1_TEAM_COUNT } = require('../lib/ncaab-d1');

assert.deepEqual(handler.MARKET_SERIES.ncaab, { side: 'KXNCAAMBGAME', spread: 'KXNCAAMBSPREAD', total: 'KXNCAAMBTOTAL' });
assert.equal(handler.OCCURRENCE_START_OFFSET_MS.ncaab, 3 * 3600 * 1000);
assert.ok(handler.D1_ONLY_SPORTS.has('ncaab'));
assert.ok(!handler.D1_ONLY_SPORTS.has('ncaaf'), 'college football slate untouched');

// D1 roster sanity + Kalshi spellings.
assert.ok(D1_TEAM_COUNT >= 360, `D1 teams ${D1_TEAM_COUNT}`);
for (const n of ['Villanova', 'Notre Dame', 'Grambling St.', 'Miami (FL)', 'San Jose St.', 'LIU', 'Louisiana-Monroe', 'Tennessee-Martin', 'USC Upstate', 'Queens University', 'Lindenwood', 'Southern Indiana', 'Appalachian St.', 'Seattle', 'New Orleans']) {
  assert.ok(isD1Team(n), `${n} should be D1`);
}
for (const n of ['Fisk', 'Bethesda', 'Willamette', 'Reinhardt', 'Paine', 'University of North Texas at Dallas', 'Miami (OH) Middletown', '']) {
  assert.ok(!isD1Team(n), `${n} should NOT be D1`);
}
assert.ok(isD1Game('Notre Dame', 'Villanova'));
assert.ok(!isD1Game('Mercer', 'Reinhardt'));
assert.ok(!isD1Game('Villanova', 'Villanova Wildcats'), 'same team twice is not a game');

// Grouping: ND vs VILL (Nov 1, ESPN tip 14:30Z, Kalshi occurrence 17:30Z) gets an exact 14:30Z start + its ladders.
const now = Date.parse('2026-10-31T02:00:00Z');
const games = h.groupSportGames({ side: fx.side, spread: fx.spread, total: fx.total }, now, { occurrenceStartOffsetMs: handler.OCCURRENCE_START_OFFSET_MS.ncaab });
const nd = games.find((g) => g.key === '26NOV01NDVILL');
assert.ok(nd, 'ND vs VILL listed');
assert.equal(nd.startTime, '2026-11-01T14:30:00.000Z');
assert.equal(nd.startExact, true);
assert.ok(nd.markets.spread.length > 0 && nd.markets.total.length > 0);
assert.ok(nd.markets.spread.some((m) => /Notre Dame \+/.test(m.label)), 'spread NO side labeled with the opponent');

// D1 filter keeps ND vs VILL, drops the non-D1 exhibition, and carries the non-enumerable fields.
assert.equal(games.length, 2);
const kept = h.d1OnlyGames(games);
assert.deepEqual(kept.map((g) => g.key), ['26NOV01NDVILL']);
assert.ok(Array.isArray(kept.started) && Array.isArray(kept.provisional));
assert.equal(Object.keys(kept).filter((k) => !/^\d+$/.test(k)).length, 0, 'no enumerable extras');
const failedList = Object.defineProperty([], 'failed', { value: true, enumerable: false });
assert.equal(h.d1OnlyGames(failedList).failed, true);

console.log('kalshi-games ncaab tests passed');
