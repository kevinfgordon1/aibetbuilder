'use strict';

const assert = require('node:assert/strict');
const handler = require('./espn-scores.js');
const h = handler._helpers;

assert.deepEqual(h.queriesFromReq({ query: { queries: 'mlb:20260903,nfl:20260913' } }), [
  { sport: 'mlb', date: '20260903' },
  { sport: 'nfl', date: '20260913' },
]);
assert.deepEqual(h.queriesFromReq({ url: '/api/espn-scores?queries=ncaaf:20260905' }), [
  { sport: 'ncaaf', date: '20260905' },
]);
assert.deepEqual(h.queriesFromReq({ query: { queries: 'mlb:notadate,evil:20260905,/bin/sh' } }), []);
assert.equal(h.ESPN.mlb.includes('espn.com'), true);
assert.equal(h.ESPN.nfl.includes('espn.com'), true);
assert.equal(h.ESPN.ncaaf.includes('college-football'), true);
assert.match(h.scoreboardUrl('ncaaf', '20260905'), /dates=20260905.*limit=300/);
assert.equal(h.scoreboardUrl('mlb', '20260903').includes('limit='), false);

const ev = {
  competitions: [{
    competitors: [
      { homeAway: 'home', score: '5', team: { displayName: 'Texas Rangers', abbreviation: 'TEX', name: 'Rangers' } },
      { homeAway: 'away', score: '3', team: { displayName: 'Tampa Bay Rays', abbreviation: 'TB', name: 'Rays' } },
    ],
  }],
  status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
};
const slim = h.slimEvent(ev, 'mlb', '20260904');
assert.equal(slim.completed, true);
assert.equal(slim.homeScore, 5);
assert.equal(slim.awayScore, 3);
assert.equal(slim.homeAbbr, 'TEX');

const live = h.slimEvent({
  competitions: ev.competitions,
  status: { type: { completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' } },
}, 'mlb', '20260904');
assert.equal(live.completed, false);

assert.equal(h.slimEvent(null, 'mlb', '20260904'), null);

// ?live=nfl: slim live game-state payload (PR #250 game-state line / frozen gates).
assert.equal(h.liveParam({ query: { live: 'NFL' } }), 'nfl');
assert.equal(h.liveParam({ url: '/api/espn-scores?live=nfl' }), 'nfl');
assert.equal(h.liveParam({ url: '/api/espn-scores?queries=nfl:20260928' }), '');
{
  const ev = {
    id: '401872963',
    status: { displayClock: '8:30', period: 2, type: { name: 'STATUS_IN_PROGRESS', state: 'in' } },
    competitions: [{
      competitors: [
        { homeAway: 'home', score: '10', team: { id: '3', abbreviation: 'CHI', displayName: 'Chicago Bears', logo: 'x' }, records: [1] },
        { homeAway: 'away', score: '7', team: { id: '21', abbreviation: 'PHI', displayName: 'Philadelphia Eagles' } },
      ],
      situation: { down: 3, distance: 4, possession: '21', possessionText: 'CHI 35', shortDownDistanceText: '3rd & 4', isRedZone: false, lastPlay: { type: { id: '24', text: 'Pass Reception' }, text: 'pass', probability: {} } },
      broadcasts: [1, 2],
    }],
  };
  const slim = h.slimLiveEvent(ev);
  assert.equal(slim.competitions[0].situation.possession, '21');
  assert.equal(slim.competitions[0].situation.lastPlay.type.text, 'Pass Reception');
  assert.equal(slim.competitions[0].competitors[0].team.logo, undefined);
  assert.equal(slim.competitions[0].broadcasts, undefined);
  assert.equal(h.slimLiveEvent({}), null);
  const realFetch = global.fetch;
  global.fetch = async (url) => ({ ok: true, json: async () => ({ events: [ev], url }) });
  const headers = {};
  let out = null;
  const res = { setHeader: (k, v) => { headers[k] = v; }, status: () => ({ json: (b) => { out = b; }, end() {} }) };
  handler({ method: 'GET', query: { live: 'nfl' } }, res).then(() => {
    global.fetch = realFetch;
    assert.equal(out.source, 'espn');
    assert.equal(out.events.length, 1);
    assert.equal(headers['Cache-Control'], 's-maxage=3, stale-while-revalidate=5');
    console.log('espn-scores.test.js ok');
  });
}

// NHL scoreboard (Combo Locks underlying results for KXNHL legs)
assert.deepEqual(h.queriesFromReq({ query: { queries: 'nhl:20261007,NHL:20261008' } }), [
  { sport: 'nhl', date: '20261007' },
  { sport: 'nhl', date: '20261008' },
]);
assert.equal(h.ESPN.nhl, 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard');
assert.equal(h.scoreboardUrl('nhl', '20261007'), h.ESPN.nhl + '?dates=20261007');
console.log('espn-scores NHL tests passed');
