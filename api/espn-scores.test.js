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

console.log('espn-scores.test.js ok');
