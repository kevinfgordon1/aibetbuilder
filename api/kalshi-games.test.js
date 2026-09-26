'use strict';

const assert = require('node:assert/strict');
const handler = require('./kalshi-games.js');
const h = handler._helpers;

assert.deepEqual(handler.MARKET_SERIES.mlb, {
  side: 'KXMLBGAME', spread: 'KXMLBSPREAD', total: 'KXMLBTOTAL',
});
assert.deepEqual(handler.MARKET_SERIES.nfl, {
  side: 'KXNFLGAME', spread: 'KXNFLSPREAD', total: 'KXNFLTOTAL',
});
assert.deepEqual(handler.MARKET_SERIES.ncaaf, {
  side: 'KXNCAAFGAME', spread: 'KXNCAAFSPREAD', total: 'KXNCAAFTOTAL',
});

assert.equal(h.gameKeyOf('KXNFLGAME-26SEP09NESEA'), '26SEP09NESEA');
assert.equal(h.gameKeyOf('KXNCAAFGAME-26SEP03MASSRUTG'), '26SEP03MASSRUTG');
assert.equal(h.gameKeyOf('KXMLBGAME-26AUG071905PHIATL'), '26AUG071905PHIATL');

// MLB datetime key still parses as first pitch; football date-only does not.
const mlbPitch = h.firstPitchUtcMs('26AUG071905PHIATL');
assert.ok(Number.isFinite(mlbPitch));
assert.equal(h.firstPitchUtcMs('26SEP09NESEA'), NaN);
assert.equal(h.firstPitchUtcMs('26SEP03MASSRUTG'), NaN);
assert.ok(Number.isFinite(h.dateOnlyUtcMs('26SEP09NESEA')));
assert.ok(Number.isFinite(h.dateOnlyUtcMs('26SEP03MASSRUTG')));
assert.ok(Number.isNaN(h.dateOnlyUtcMs('26AUG071905PHIATL')));
assert.equal(h.gameStartUtcMs('26AUG071905PHIATL'), mlbPitch);
assert.equal(h.gameStartUtcMs('26SEP09NESEA'), h.dateOnlyUtcMs('26SEP09NESEA'));

// Football labels reuse the MLB parsers (same "wins by over" / "Over N" shape).
assert.deepEqual(h.parseSpread('Seattle wins by over 20.5 points'), { team: 'Seattle', line: '20.5' });
assert.deepEqual(h.parseSpread('Rutgers wins by over 51.5 points'), { team: 'Rutgers', line: '51.5' });
assert.deepEqual(h.parseTotal('Over 23.5 points scored'), { line: '23.5' });
assert.deepEqual(h.parseTotal('Over 7.5 runs scored'), { line: '7.5' });

const ev = (ticker, title, sub, markets, occurrence) => ({
  event_ticker: ticker,
  title,
  sub_title: sub,
  markets: markets.map((m) => ({
    ticker: m.ticker,
    yes_sub_title: m.label,
    occurrence_datetime: occurrence,
  })),
});

const NOW = Date.parse('2026-09-01T18:00:00Z');

const mlbSide = ev('KXMLBGAME-26SEP021905PHIATL', 'Philadelphia vs Atlanta', 'PHI vs ATL (Sep 2)', [
  { ticker: 'KXMLBGAME-26SEP021905PHIATL-PHI', label: 'Philadelphia' },
  { ticker: 'KXMLBGAME-26SEP021905PHIATL-ATL', label: 'Atlanta' },
], '2026-09-02T23:05:00Z');
const mlbSpread = ev('KXMLBSPREAD-26SEP021905PHIATL', 'Philadelphia vs Atlanta: Spread', 'PHI vs ATL (Sep 2)', [
  { ticker: 'KXMLBSPREAD-26SEP021905PHIATL-PHI2', label: 'Philadelphia wins by over 1.5' },
], '2026-09-02T23:05:00Z');
const mlbTotal = ev('KXMLBTOTAL-26SEP021905PHIATL', 'Philadelphia vs Atlanta: Total', 'PHI vs ATL (Sep 2)', [
  { ticker: 'KXMLBTOTAL-26SEP021905PHIATL-9', label: 'Over 8.5 runs scored' },
], '2026-09-02T23:05:00Z');

const mlbGames = h.groupSportGames({ side: [mlbSide], spread: [mlbSpread], total: [mlbTotal] }, NOW);
assert.equal(mlbGames.length, 1, 'MLB game with moneyline pair is kept');
assert.equal(mlbGames[0].key, '26SEP021905PHIATL');
assert.equal(mlbGames[0].markets.side.length, 2);
assert.equal(mlbGames[0].markets.spread.length, 2); // yes + no expansion
assert.equal(mlbGames[0].markets.total.length, 2);
assert.ok(mlbGames[0].markets.spread.some((m) => m.side === 'no' && /Atlanta/.test(m.label)));
assert.ok(mlbGames[0].markets.total.some((m) => m.side === 'no' && m.label === 'Under 8.5'));

const startedMlb = ev('KXMLBGAME-26AUG011905PHIATL', 'Philadelphia vs Atlanta', 'PHI vs ATL', [
  { ticker: 'KXMLBGAME-26AUG011905PHIATL-PHI', label: 'Philadelphia' },
  { ticker: 'KXMLBGAME-26AUG011905PHIATL-ATL', label: 'Atlanta' },
]);
assert.equal(h.groupSportGames({ side: [startedMlb] }, NOW).length, 0, 'past MLB first pitch is dropped');

const nflSide = ev('KXNFLGAME-26SEP09NESEA', 'New England vs Seattle', 'NE vs SEA (Sep 9)', [
  { ticker: 'KXNFLGAME-26SEP09NESEA-SEA', label: 'Seattle' },
  { ticker: 'KXNFLGAME-26SEP09NESEA-NE', label: 'New England' },
], '2026-09-10T03:20:00Z');
const nflSpread = ev('KXNFLSPREAD-26SEP09NESEA', 'New England vs Seattle: Spread', 'NE vs SEA (Sep 9)', [
  { ticker: 'KXNFLSPREAD-26SEP09NESEA-SEA7', label: 'Seattle wins by over 6.5 points' },
], '2026-09-10T03:20:00Z');
const nflTotal = ev('KXNFLTOTAL-26SEP09NESEA', 'New England vs Seattle: Total Points', 'NE vs SEA (Sep 9)', [
  { ticker: 'KXNFLTOTAL-26SEP09NESEA-43', label: 'Over 42.5 points scored' },
], '2026-09-10T03:20:00Z');

const nflGames = h.groupSportGames({ side: [nflSide], spread: [nflSpread], total: [nflTotal] }, NOW);
assert.equal(nflGames.length, 1, 'NFL game key 26SEP09NESEA is grouped');
assert.equal(nflGames[0].key, '26SEP09NESEA');
assert.equal(nflGames[0].title, 'New England vs Seattle');
assert.equal(nflGames[0].markets.side.length, 2);
assert.equal(nflGames[0].markets.side[0].ticker, 'KXNFLGAME-26SEP09NESEA-SEA');
assert.deepEqual(nflGames[0].markets.spread.map((m) => m.label).sort(), ['New England +6.5', 'Seattle −6.5'].sort());
assert.deepEqual(nflGames[0].markets.total.map((m) => m.label), ['Over 42.5', 'Under 42.5']);
assert.equal(nflGames[0].startTime, '2026-09-10T03:20:00.000Z');

const nflMoneylineOnly = h.groupSportGames({ side: [nflSide], spread: [], total: [] }, NOW);
assert.equal(nflMoneylineOnly.length, 1, 'missing spread/total still ships the NFL moneyline');
assert.equal(nflMoneylineOnly[0].markets.spread.length, 0);
assert.equal(nflMoneylineOnly[0].markets.total.length, 0);
assert.equal(nflMoneylineOnly[0].markets.side.length, 2);

const ncaafSide = ev('KXNCAAFGAME-26SEP03MASSRUTG', 'UMass vs Rutgers', 'MASS vs RUTG (Sep 3)', [
  { ticker: 'KXNCAAFGAME-26SEP03MASSRUTG-RUTG', label: 'Rutgers' },
  { ticker: 'KXNCAAFGAME-26SEP03MASSRUTG-MASS', label: 'UMass' },
], '2026-09-04T01:00:00Z');
const ncaafSpread = ev('KXNCAAFSPREAD-26SEP03MASSRUTG', 'UMass vs Rutgers: Spread', 'MASS vs RUTG (Sep 3)', [
  { ticker: 'KXNCAAFSPREAD-26SEP03MASSRUTG-RUTG36', label: 'Rutgers wins by over 35.5 points' },
], '2026-09-04T01:00:00Z');
const ncaafTotal = ev('KXNCAAFTOTAL-26SEP03MASSRUTG', 'UMass vs Rutgers: Total Points', 'MASS vs RUTG (Sep 3)', [
  { ticker: 'KXNCAAFTOTAL-26SEP03MASSRUTG-50', label: 'Over 49.5 points scored' },
], '2026-09-04T01:00:00Z');

const ncaafGames = h.groupSportGames({ side: [ncaafSide], spread: [ncaafSpread], total: [ncaafTotal] }, NOW);
assert.equal(ncaafGames.length, 1, 'NCAAF game key 26SEP03MASSRUTG is grouped');
assert.equal(ncaafGames[0].key, '26SEP03MASSRUTG');
assert.equal(ncaafGames[0].title, 'UMass vs Rutgers');
assert.equal(ncaafGames[0].markets.side.length, 2);
assert.ok(ncaafGames[0].markets.spread.some((m) => m.ticker === 'KXNCAAFSPREAD-26SEP03MASSRUTG-RUTG36' && m.side === 'yes'));
assert.ok(ncaafGames[0].markets.total.some((m) => m.label === 'Under 49.5' && m.side === 'no'));

const pastNfl = ev('KXNFLGAME-26AUG28NESEA', 'New England vs Seattle', 'NE vs SEA (Aug 28)', [
  { ticker: 'KXNFLGAME-26AUG28NESEA-SEA', label: 'Seattle' },
  { ticker: 'KXNFLGAME-26AUG28NESEA-NE', label: 'New England' },
]);
assert.equal(h.groupSportGames({ side: [pastNfl] }, NOW).length, 0, 'past NFL date-only key is dropped');

assert.equal(h.isUpcomingGame('26SEP09NESEA', NOW), true);
assert.equal(h.isUpcomingGame('26AUG28NESEA', NOW), false);
assert.equal(h.isUpcomingGame('26SEP021905PHIATL', NOW), true);
assert.equal(h.isUpcomingGame('26AUG011905PHIATL', NOW), false);
// Live 2026-09-09 STL@SF key: 15:45 ET first pitch = 19:45 UTC. Combo Locks
// drops the game one minute later even though Kalshi still lists it as open.
assert.equal(h.firstPitchUtcMs('26SEP091545STLSF'), Date.parse('2026-09-09T19:45:00Z'));
assert.equal(h.isUpcomingGame('26SEP091545STLSF', Date.parse('2026-09-09T19:44:00Z')), true);
assert.equal(h.isUpcomingGame('26SEP091545STLSF', Date.parse('2026-09-09T19:46:00Z')), false);

// Spread ticker suffixes: team code + strike digits. Moneyline suffix is the code.
assert.equal(h.teamCodeOf('SF9'), 'SF');
assert.equal(h.teamCodeOf('ARI10'), 'ARI');
assert.equal(h.teamCodeOf('RUTG36'), 'RUTG');
assert.equal(h.teamCodeOf('SF'), 'SF');
assert.equal(h.teamCodeOf(h.tickerTail('KXNFLSPREAD-26SEP27ARISF-SF9')), 'SF');

// Live ARI@SF shape: moneyline cities, abbreviated spread titles, SF listed first.
// Arizona +8.5 is NO on "SF 49ers wins by over 8.5", not a missing market.
const ariSfSide = ev('KXNFLGAME-26SEP27ARISF', 'Arizona vs San Francisco', 'ARI vs SF (Sep 27)', [
  { ticker: 'KXNFLGAME-26SEP27ARISF-SF', label: 'San Francisco' },
  { ticker: 'KXNFLGAME-26SEP27ARISF-ARI', label: 'Arizona' },
], '2026-09-27T20:05:00Z');
const ariSfSpread = ev('KXNFLSPREAD-26SEP27ARISF', 'ARI Cardinals vs SF 49ers: Spread', 'ARI vs SF (Sep 27)', [
  { ticker: 'KXNFLSPREAD-26SEP27ARISF-SF9', label: 'SF 49ers wins by over 8.5 points' },
  { ticker: 'KXNFLSPREAD-26SEP27ARISF-SF8', label: 'SF 49ers wins by over 7.5 points' },
  { ticker: 'KXNFLSPREAD-26SEP27ARISF-SF10', label: 'SF 49ers wins by over 9.5 points' },
  { ticker: 'KXNFLSPREAD-26SEP27ARISF-ARI8', label: 'ARI Cardinals wins by over 7.5 points' },
], '2026-09-27T20:05:00Z');
const ariSfGames = h.groupSportGames({ side: [ariSfSide], spread: [ariSfSpread], total: [] }, NOW);
assert.equal(ariSfGames.length, 1);
const ariSfSpreads = ariSfGames[0].markets.spread;
const leg = (ticker, side) => ariSfSpreads.find((m) => m.ticker === ticker && m.side === side);
assert.equal(leg('KXNFLSPREAD-26SEP27ARISF-SF9', 'yes').label, 'San Francisco \u22128.5');
assert.equal(leg('KXNFLSPREAD-26SEP27ARISF-SF9', 'no').label, 'Arizona +8.5');
assert.equal(leg('KXNFLSPREAD-26SEP27ARISF-SF8', 'no').label, 'Arizona +7.5');
assert.equal(leg('KXNFLSPREAD-26SEP27ARISF-SF10', 'no').label, 'Arizona +9.5');
assert.equal(leg('KXNFLSPREAD-26SEP27ARISF-ARI8', 'yes').label, 'Arizona \u22127.5');
assert.equal(leg('KXNFLSPREAD-26SEP27ARISF-ARI8', 'no').label, 'San Francisco +7.5');
assert.equal(ariSfSpreads.filter((m) => m.side === 'no' && m.ticker.endsWith('-SF9') && /San Francisco/.test(m.label)).length, 0);

// Philadelphia listed first must still put Chicago on the NO of PHI −4.5.
const phiChiSide = ev('KXNFLGAME-26SEP28PHICHI', 'Philadelphia vs Chicago', 'PHI vs CHI (Sep 28)', [
  { ticker: 'KXNFLGAME-26SEP28PHICHI-PHI', label: 'Philadelphia' },
  { ticker: 'KXNFLGAME-26SEP28PHICHI-CHI', label: 'Chicago' },
], '2026-09-28T17:00:00Z');
const phiChiSpread = ev('KXNFLSPREAD-26SEP28PHICHI', 'PHI Eagles vs CHI Bears: Spread', 'PHI vs CHI (Sep 28)', [
  { ticker: 'KXNFLSPREAD-26SEP28PHICHI-PHI5', label: 'PHI Eagles wins by over 4.5 points' },
  { ticker: 'KXNFLSPREAD-26SEP28PHICHI-CHI5', label: 'CHI Bears wins by over 4.5 points' },
], '2026-09-28T17:00:00Z');
const phiChiGames = h.groupSportGames({ side: [phiChiSide], spread: [phiChiSpread], total: [] }, NOW);
const phiChiSpreads = phiChiGames[0].markets.spread;
const chiLeg = (ticker, side) => phiChiSpreads.find((m) => m.ticker === ticker && m.side === side);
assert.equal(chiLeg('KXNFLSPREAD-26SEP28PHICHI-PHI5', 'yes').label, 'Philadelphia \u22124.5');
assert.equal(chiLeg('KXNFLSPREAD-26SEP28PHICHI-PHI5', 'no').label, 'Chicago +4.5');
assert.equal(chiLeg('KXNFLSPREAD-26SEP28PHICHI-CHI5', 'yes').label, 'Chicago \u22124.5');
assert.equal(chiLeg('KXNFLSPREAD-26SEP28PHICHI-CHI5', 'no').label, 'Philadelphia +4.5');

console.log('kalshi-games tests passed');

// combo eligibility flag (Kalshi rejects combos on events outside the collection)
{
  const marked = h.markComboEligible([{ key: '26SEP251905BALNYY' }, { key: '26SEP251940COLCWS' }], 'KXMLBGAME', new Set(['KXMLBGAME-26SEP251940COLCWS']));
  assert.equal(marked[0].comboEligible, false);
  assert.equal(marked[1].comboEligible, true);
  assert.equal(h.markComboEligible([{ key: 'X' }], 'KXMLBGAME', null)[0].comboEligible, null);
  console.log('kalshi-games combo eligibility tests passed');
}
