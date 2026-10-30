'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSchedule, leagueKind, propStat } = require('./love23-parse');
const nfl = require('./fixtures-love23-schedule-nfl-2026-10-30.json');
const tt = require('./fixtures-love23-team-totals-nfl-2026-10-30.json');

test('main games, alts and team totals from the DGS schedule', () => {
  const { games, selections } = parseSchedule([...nfl, ...tt]);
  assert.equal(games.size, 13);
  const min = selections.filter((s) => s.gameLink === 3429570);
  const ml = min.filter((s) => s.market === 'h2h');
  assert.deepEqual(ml.map((s) => [s.side, s.american]), [['away', 161], ['home', -187]]);
  const alts = min.filter((s) => s.kind === 'alt' && s.market === 'spreads' && s.side === 'home');
  assert.deepEqual(alts.map((s) => s.point).sort((a, b) => a - b), [-4, -3.5, -2.5, -2]);
  const ttRows = min.filter((s) => s.kind === 'team_total');
  assert.ok(ttRows.length >= 2);
  assert.equal(ttRows[0].team, 'MINNESOTA VIKINGS');
  assert.equal(ttRows[0].home, 'DETROIT LIONS');
  assert.equal(ml[0].legId, '3429570_11_0_161');
});

test('a 0 price is not offered (TEN @ CIN has no moneyline)', () => {
  const { selections } = parseSchedule(nfl);
  const cin = selections.filter((s) => s.home === 'CINCINNATI BENGALS' && s.kind === 'main');
  assert.equal(cin.filter((s) => s.market === 'h2h').length, 0);
  assert.ok(cin.some((s) => s.market === 'spreads'));
});

test('league kinds and prop stats', () => {
  assert.equal(leagueKind({ name: 'NFL' }), 'game');
  assert.equal(leagueKind({ name: 'NFL 1H' }), null);
  assert.equal(leagueKind({ name: 'NFL - TEAM TOTALS' }), 'team_total');
  assert.equal(leagueKind({ name: 'NBA PLAYER TOTAL POINTS' }), 'prop');
  assert.equal(leagueKind({ name: 'WNBA' }), null);
  assert.equal(propStat('NBA PLAYER TOTAL POINTS'), 'player_points');
  const { selections } = parseSchedule([{ id: 4021, name: 'NBA PLAYER TOTAL POINTS', sport: 'NBA', groups: [{ games: [
    { id: 9, link: 9, kickoff: 1793403000, vtm: 'FRANZ WAGNER (ORL) - TOTAL POINTS', htm: 'FRANZ WAGNER (ORL) - TOTAL POINTS', ou: 22.5, om: -116, um: -120, am: 0, hm: 0, apm: 0, hpm: 0 },
  ] }] }]);
  assert.equal(selections.length, 2);
  assert.equal(selections[0].player, 'FRANZ WAGNER');
  assert.equal(selections[0].market, 'player_points');
});
