'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSchedule } = require('./love23-parse');
const O = require('./love23-optimizer');
const nfl = require('./fixtures-love23-schedule-nfl-2026-10-30.json');

const KICK = '2026-11-01T19:00:00Z'; // 2 PM EST (DST ends Nov 1)
function bm(key, markets) { return { key, markets }; }
function h2h(away, home) { return { key: 'h2h', outcomes: [{ name: 'Minnesota Vikings', price: away }, { name: 'Detroit Lions', price: home }] }; }
function spreads(pt, a, h) { return { key: 'spreads', outcomes: [{ name: 'Minnesota Vikings', point: pt, price: a }, { name: 'Detroit Lions', point: -pt, price: h }] }; }
function totals(pt, o, u) { return { key: 'totals', outcomes: [{ name: 'Over', point: pt, price: o }, { name: 'Under', point: pt, price: u }] }; }

function oddsFor(overrides = {}) {
  return {
    americanfootball_nfl: {
      fetchedAt: new Date(Date.parse(KICK) - 2 * 86400000).toISOString(),
      games: [{
        id: 'ev-min-det', commence_time: KICK, home_team: 'Detroit Lions', away_team: 'Minnesota Vikings',
        bookmakers: [
          bm('pinnacle', [h2h(159, -181), spreads(3, 107, -120), totals(46, -103, -113)]),
          bm('kalshi', [h2h(150, -175), spreads(3, 100, -125)]),
          bm('novig', overrides.novig || [h2h(162, -170), spreads(3, 104, -118)]),
          bm('draftkings', [h2h(155, -185)]),
        ],
      }],
    },
  };
}

const NOW = Date.parse(KICK) - 2 * 86400000 + 60000;

test('team matching handles city-only and school aliases', () => {
  assert.ok(O.teamScore('MINNESOTA VIKINGS', 'Minnesota Vikings') > 0.9);
  assert.equal(O.teamScore('NEW YORK JETS', 'New York Giants'), 0);
  assert.ok(O.teamScore('TULANE', 'Tulane Green Wave') > 0);
  assert.ok(O.teamScore('MIAMI FLORIDA', 'Miami Hurricanes') > O.teamScore('MIAMI FLORIDA', 'Miami (OH) RedHawks'));
  assert.ok(O.teamScore('CENTRAL FLORIDA', 'UCF Knights') > 0);
  assert.ok(O.teamScore('CONNECTICUT', 'UConn Huskies') > 0);
});

test('best opposing hedge across prediction markets only, Pinnacle fair', () => {
  const { games, selections } = parseSchedule(nfl);
  const rows = O.evaluateAll({ selections, games, odds: oddsFor(), state: { N: 0 }, nowMs: NOW });
  const minMl = rows.find((r) => r.sel.gameLink === 3429570 && r.sel.market === 'h2h' && r.sel.side === 'away');
  assert.ok(minMl && !minMl.skipped);
  // betting MIN +161 at love23 -> hedge is DET; best of kalshi -175 / novig -170 (DraftKings ignored)
  assert.equal(minMl.hedge.venue, 'novig');
  assert.equal(minMl.hedge.american, -170);
  assert.equal(minMl.fairSource, 'pinnacle');
  assert.ok(Math.abs(minMl.pinFair - 1 / 2.59 / (1 / 2.59 + 181 / 281)) < 1e-9);
  // spread +3 at love23 +108: hedge DET -3 best is novig -118
  const sp = rows.find((r) => r.sel.gameLink === 3429570 && r.sel.kind === 'main' && r.sel.market === 'spreads' && r.sel.side === 'away');
  assert.equal(sp.hedge.american, -118);
  // total has no prediction-market pair -> no hedge, not ranked
  const tot = rows.find((r) => r.sel.gameLink === 3429570 && r.sel.kind === 'main' && r.sel.market === 'totals');
  assert.ok(tot.flags.includes('no_hedge'));
  const ranked = O.rankPicks(rows);
  assert.ok(ranked.every((r) => r.hedge && !r.flags.includes('no_hedge')));
  for (let i = 1; i < ranked.length; i += 1) assert.ok(ranked[i - 1].totalHedged >= ranked[i].totalHedged);
});

test('false-edge guards: unconfirmed fair goes conservative, line_moved and stale are held back', () => {
  const { games, selections } = parseSchedule(nfl);
  // Novig/Kalshi disagree with Pinnacle by a lot on the ML
  const odds = oddsFor({ novig: [h2h(120, -140), spreads(3, 104, -118)] });
  odds.americanfootball_nfl.games[0].bookmakers[1] = bm('kalshi', [h2h(125, -145), spreads(3, 100, -125)]);
  const rows = O.evaluateAll({ selections, games, odds, nowMs: NOW });
  const minMl = rows.find((r) => r.sel.gameLink === 3429570 && r.sel.market === 'h2h' && r.sel.side === 'away');
  assert.ok(minMl.flags.includes('unconfirmed'));
  assert.equal(minMl.fairP, Math.min(minMl.pinFair, minMl.pmFair));

  // Pinnacle main spread at 3.5 while love23 shows 3 -> love23 moved first
  const moved = oddsFor();
  moved.americanfootball_nfl.games[0].bookmakers[0] = bm('pinnacle', [h2h(159, -181), spreads(3.5, -110, -104)]);
  const r2 = O.evaluateAll({ selections, games, odds: moved, nowMs: NOW });
  const sp = r2.find((r) => r.sel.gameLink === 3429570 && r.sel.kind === 'main' && r.sel.market === 'spreads' && r.sel.side === 'away');
  assert.ok(sp.flags.includes('line_moved'));
  assert.ok(!O.rankPicks(r2).includes(sp));

  const stale = O.evaluateAll({ selections, games, odds: oddsFor(), nowMs: NOW + 20 * 60000 });
  assert.ok(stale.filter((r) => !r.skipped).every((r) => r.flags.includes('stale_odds')));
  assert.equal(O.rankPicks(stale).length, 0);
});

test('started games are dropped', () => {
  const { games, selections } = parseSchedule(nfl);
  const rows = O.evaluateAll({ selections, games, odds: oddsFor(), nowMs: Date.parse(KICK) + 1000 });
  assert.equal(rows.filter((r) => r.sel.gameLink === 3429570).length, 0);
});
