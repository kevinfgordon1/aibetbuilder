'use strict';
// Canonical game schedule (mirror of combo-worker/game-schedule.js) + its consumers here:
// root-for (needle / What to root for), the Today filter, and the Combo Locks game list.
const assert = require('assert');
const G = require('./game-schedule');
const FX = require('./fixtures-espn-schedule-2026-10-27.json'); // real ESPN scoreboards, pulled Oct 27 2026
const games = Object.entries(FX).flatMap(([k, j]) => G.espnRows(k.split('|')[0], j));
const iso = (t) => { const r = G.resolveStart(t, games); assert.ok(r.verified, `${t}: ${r.warn}`); return r.iso; };

// Tonight's legs the needle dropped (no start time) now resolve to official times.
assert.strictEqual(iso('KXNBAGAME-26OCT27DETNYK-NYK'), '2026-10-28T00:00:00.000Z');
assert.strictEqual(iso('KXNBASPREAD-26OCT27SACSAS-SAS5'), '2026-10-28T00:00:00.000Z');
assert.strictEqual(iso('KXNHLGAME-26OCT27BUFSJ-SJ'), '2026-10-28T02:30:00.000Z');
assert.strictEqual(iso('KXNCAAFGAME-26OCT30KSUCOLO-KSU'), '2026-10-31T18:00:00.000Z'); // ML ticker dated a day early
assert.strictEqual(iso('KXNFLGAME-26NOV01INDJAC-IND'), '2026-11-01T18:00:00.000Z');
let r = G.resolveStart('KXNHLGAME-26OCT27LACHI-LA', []);
assert.deepStrictEqual([r.verified, r.source, r.date], [false, 'ticker_date', '2026-10-27']);

(async () => {
  const RF = require('../api/root-for.js')._helpers;
  // applySchedule: canonical overrides a wrong guess; unknown games still get a day + a warning.
  const starts = { 'KXNBAGAME-26OCT27BKNBOS': '2026-10-28T02:30:00.000Z' }; // a Kalshi −3h-style wrong guess
  const evs = ['KXNBAGAME-26OCT27BKNBOS', 'KXNHLGAME-26OCT27BUFSJ', 'KXNHLGAME-26OCT27QQQZZZ', 'KXNBATOTAL-26OCT27PORLAL'];
  const a = RF.applySchedule(evs, starts, games, { 'KXNHLGAME-26OCT27QQQZZZ': '2026-10-27T23:00:00Z' }, {});
  assert.strictEqual(starts['KXNBAGAME-26OCT27BKNBOS'], '2026-10-27T23:30:00.000Z');
  assert.strictEqual(starts['KXNHLGAME-26OCT27BUFSJ'], '2026-10-28T02:30:00.000Z');
  assert.strictEqual(starts['KXNBATOTAL-26OCT27PORLAL'], '2026-10-28T03:00:00.000Z');
  assert.strictEqual(starts['KXNHLGAME-26OCT27QQQZZZ'], '2026-10-27T23:00:00.000Z'); // leg's own saved start
  assert.deepStrictEqual(a.startWarnings.map((w) => [w.event, w.source]), [['KXNHLGAME-26OCT27QQQZZZ', 'lock']]);
  assert.strictEqual(a.startDates['KXNHLGAME-26OCT27BUFSJ'], '2026-10-27');

  // legStarts covers multi-game locks (lockStarts only did single-game ones).
  assert.deepStrictEqual(RF.legStarts([{ legs: [{ ticker: 'KXNBAGAME-26OCT27BKNBOS-BOS', starts_at: '2026-10-27T23:30:00Z' }, { ticker: 'KXNHLGAME-26OCT27BUFSJ-SJ', starts_at: '2026-10-28T02:30:00Z' }] }]),
    { 'KXNBAGAME-26OCT27BKNBOS': '2026-10-27T23:30:00.000Z', 'KXNHLGAME-26OCT27BUFSJ': '2026-10-28T02:30:00.000Z' });

  // loadSchedule: table rows first; days the table lacks come live from ESPN; a missing table falls back fully.
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const ok = (b) => ({ ok: true, status: 200, json: async () => b });
    if (url.includes('/rest/v1/game_schedule')) return ok(games.filter((g) => g.league === 'NBA').map((g) => G.gameToRow(g)));
    const lg = url.includes('/nhl/') ? 'NHL' : url.includes('/nba/') ? 'NBA' : 'X'; const d = /dates=(\d+)/.exec(url)[1];
    return ok(FX[`${lg}|${d}`] || { events: [] });
  };
  const s = await RF.loadSchedule(['KXNBAGAME-26OCT27BKNBOS', 'KXNHLGAME-26OCT27BUFSJ'], { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' }, fakeFetch);
  assert.ok(G.resolveStart('KXNBAGAME-26OCT27BKNBOS', s.games).verified);
  assert.ok(G.resolveStart('KXNHLGAME-26OCT27BUFSJ', s.games).verified);
  assert.ok(calls.some((u) => u.includes('/nhl/')), 'NHL pulled live from ESPN');
  assert.ok(!calls.some((u) => u.includes('/nba/') && u.includes('20261027')), 'NBA Oct 27 came from the table');
  const s2 = await RF.loadSchedule(['KXNHLGAME-26OCT27BUFSJ'], {}, fakeFetch);
  assert.strictEqual(s2.from, 'espn'); assert.ok(G.resolveStart('KXNHLGAME-26OCT27BUFSJ', s2.games).verified);

  // markStartDates + todayEvents: an event with no start time still counts on its day.
  const TD = await import('../src/rootForToday.js');
  const out = { perEvent: [{ event: 'KXNHLGAME-26OCT27QQQZZZ', start: null }, { event: 'KXNBASPREAD-26OCT27BKNBOS-BOS5', start: null }] };
  RF.markStartDates(out, { startDates: { 'KXNHLGAME-26OCT27QQQZZZ': '2026-10-27', 'KXNBAGAME-26OCT27BKNBOS': '2026-10-27' }, startWarnings: [{ event: 'KXNHLGAME-26OCT27QQQZZZ' }] });
  assert.deepStrictEqual([...TD.todayEvents(out.perEvent, Date.parse('2026-10-27T22:00:00Z'), '2026-10-27')].sort(), ['KXNBASPREAD-26OCT27BKNBOS-BOS5', 'KXNHLGAME-26OCT27QQQZZZ']);
  assert.strictEqual(out.startWarnings.length, 1);

  // Combo Locks game list: official start replaces Kalshi's guess; an officially started game moves to `started`.
  const KG = require('../api/kalshi-games.js')._helpers;
  const sports = { nba: [{ key: '26OCT27BKNBOS', title: 'BKN @ BOS', startTime: '2026-10-28T02:30:00.000Z' }, { key: '26OCT27DETNYK', title: 'DET @ NYK', startTime: '2026-10-28T03:00:00.000Z' }], nhl: [{ key: '26OCT27ZZZQQQ', startTime: '2026-10-28T00:00:00.000Z' }] };
  const started = {};
  await KG.applyCanonicalStarts(sports, started, Date.parse('2026-10-27T23:45:00Z'), async () => ({ games }));
  assert.deepStrictEqual(sports.nba.map((g) => [g.key, g.startTime, g.startVerified]), [['26OCT27DETNYK', '2026-10-28T00:00:00.000Z', true]]);
  assert.strictEqual(started.nba[0].key, '26OCT27BKNBOS');
  assert.strictEqual(sports.nhl[0].startVerified, false);
  console.log('lib/game-schedule.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
