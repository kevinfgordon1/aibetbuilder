'use strict';
const assert = require('assert');
const H = require('./underdog-health');

const NOW = Date.parse('2026-10-27T20:00:00Z');
const row = (away, home, start, extra = {}) => ({ league: 'NCAAF', away_name: away, home_name: home, start_time_utc: start, state: 'pre', ...extra });
const game = (away, home, scheduledAt, lines) => ({ sport: 'NCAAF', away, home, scheduledAt, lines });
const ml = (name, american, kalshiDriftPts) => ({ market: 'h2h', name, american, ...(kalshiDriftPts != null ? { kalshiDriftPts } : {}) });

(async () => {
  // Coverage: exact names, App State spelling via kickoff, one-to-one.
  const rows = [
    row('Troy Trojans', 'James Madison Dukes', '2026-10-29T00:00:00Z'),
    row('App State Mountaineers', 'Georgia Southern Eagles', '2026-10-31T19:30:00Z'),
    row('San José State Spartans', 'New Mexico Lobos', '2026-11-01T02:00:00Z'),
    row('Duquesne Dukes', 'New Haven Chargers', '2026-10-31T17:00:00Z'),
  ];
  const games = [
    game('Troy Trojans', 'James Madison Dukes', '2026-10-29T00:00:00Z', [ml('Troy Trojans', 1070, 0), ml('James Madison Dukes', -1250, 0.1)]),
    game('Appalachian State Mountaineers', 'Georgia Southern Eagles', '2026-10-31T19:30:00Z', [ml('Georgia Southern Eagles', 120, 0.2)]),
    game('San Jose State Spartans', 'New Mexico Lobos', '2026-11-01T02:00:00Z', [ml('New Mexico Lobos', 150, null)]),
    game('Ohio Bobcats', 'Akron Zips', '2026-11-04T00:00:00Z', [{ market: 'spreads', name: 'Akron Zips', american: -110 }]),
  ];
  const cov = H.coverageReport(games, rows, NOW);
  assert.equal(cov.scheduled, 4);
  assert.equal(cov.covered, 3);
  assert.deepEqual(cov.missing, ['Duquesne Dukes @ New Haven Chargers']);
  assert.ok(H.gameMatchesSchedule(games[1], rows[1]), 'one team + same kickoff');
  assert.ok(!H.gameMatchesSchedule({ ...games[1], scheduledAt: '2026-10-31T23:00:00Z' }, rows[1]), 'one team, different kickoff');

  // Healthy slate: no alerts (needs 10+ rows to alert at all).
  const many = Array.from({ length: 20 }, (_, i) => row(`Away${i} Team`, `Home${i} Team`, '2026-10-31T19:00:00Z'));
  const goodGames = many.map((r, i) => game(r.away_name, r.home_name, r.start_time_utc, [ml(`Away${i} Team`, 300, 0.2), ml(`Home${i} Team`, -400, -0.3)]));
  assert.deepEqual(H.alertsFor(H.coverageReport(goodGames, many, NOW), H.driftReport(goodGames)), []);

  // Old-experience failure: 12/20 games and stale prices → two alerts.
  const badGames = goodGames.slice(0, 12).map((g) => ({ ...g, lines: [ml(g.away, 835, 2.2), ml(g.home, -1667, 1.6)] }));
  const alerts = H.alertsFor(H.coverageReport(badGames, many, NOW), H.driftReport(badGames));
  assert.equal(alerts.length, 2);
  assert.match(alerts[0], /NCAAF moneylines: 12\/20/);
  assert.match(alerts[1], /NCAAF prices off Kalshi\+fee: 24\/24 sides/);

  // Kalshi name matching broken → alert.
  const unmatched = goodGames.map((g) => ({ ...g, lines: g.lines.map((l) => ({ market: 'h2h', name: l.name, american: l.american })) }));
  assert.match(H.alertsFor(null, H.driftReport(unmatched))[0], /only 0\/40 moneyline sides matched/);

  // End to end with injected fetches: Underdog down → one alert, no throw.
  const down = await H.checkUnderdogHealth({ env: {}, fetchFn: async () => ({ ok: false, status: 503, text: async () => '' }), now: NOW, cache: new Map() });
  assert.equal(down.ok, false);
  assert.equal(down.alerts.length, 1);

  console.log('underdog-health tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
