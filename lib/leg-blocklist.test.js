'use strict';

const assert = require('node:assert/strict');
const { BLOCKED_LINES, stripBlockedLines } = require('./leg-blocklist');

const game = () => ({
  id: 'g1',
  home_team: 'Western Kentucky Hilltoppers',
  away_team: 'Missouri State Bears',
  commence_time: '2026-10-08T23:00:00Z',
  bookmakers: [
    {
      key: 'draftkings',
      markets: [
        { key: 'alternate_spreads', outcomes: [
          { name: 'Western Kentucky Hilltoppers', point: -19.5, price: 1140 },
          { name: 'Missouri State Bears', point: 19.5, price: -9600 },
          { name: 'Western Kentucky Hilltoppers', point: -16.5, price: 400 },
        ] },
        { key: 'spreads', outcomes: [
          { name: 'Western Kentucky Hilltoppers', point: -19.5, price: -110 },
          { name: 'Missouri State Bears', point: 19.5, price: -110 },
        ] },
        { key: 'h2h', outcomes: [{ name: 'Western Kentucky Hilltoppers', price: -2000 }] },
      ],
    },
    { key: 'fanduel', markets: [{ key: 'alternate_spreads', outcomes: [
      { name: 'Western Kentucky Hilltoppers', point: -19.5, price: 630 },
    ] }] },
  ],
});

const before = Date.parse('2026-10-08T04:00:00Z');
const [out] = stripBlockedLines([game()], BLOCKED_LINES, before);
const dk = out.bookmakers.find((b) => b.key === 'draftkings');
assert.deepEqual(dk.markets.map((m) => m.key), ['alternate_spreads', 'h2h'], 'empty spreads market dropped');
assert.deepEqual(dk.markets[0].outcomes.map((o) => o.point), [-16.5], 'both sides of 19.5 removed, other alts kept');
const fd = out.bookmakers.find((b) => b.key === 'fanduel');
assert.equal(fd.markets[0].outcomes.length, 1, 'other books untouched');

const after = Date.parse('2026-10-09T13:00:00Z');
const [late] = stripBlockedLines([game()], BLOCKED_LINES, after);
assert.equal(late.bookmakers[0].markets[0].outcomes.length, 3, 'expired entry no-ops');

const other = { ...game(), home_team: 'Some Other Team' };
const [untouched] = stripBlockedLines([other], BLOCKED_LINES, before);
assert.equal(untouched.bookmakers[0].markets[0].outcomes.length, 3, 'other games untouched');

console.log('leg-blocklist tests passed');
