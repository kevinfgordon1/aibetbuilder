'use strict';

const assert = require('node:assert/strict');
const handler = require('./player-td-board');

function jsonRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; },
    end() { this.ended = true; },
  };
}

(async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (String(url).includes('series_ticker=KXNFLTD')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          cursor: '',
          markets: [{
            ticker: 'KXNFLTD-26SEP27KCMIA-KCTKELCE87-1',
            title: 'Travis Kelce: 1+ touchdowns',
            occurrence_datetime: '2026-09-27T17:00:00Z',
            yes_ask_dollars: '0.6400',
            yes_bid_dollars: '0.6200',
          }, {
            ticker: 'KXNFLTD-26SEP27KCMIA-KCTKELCE87-2',
            title: 'Travis Kelce: 2+ touchdowns',
            occurrence_datetime: '2026-09-27T17:00:00Z',
            yes_ask_dollars: '0.2600',
            yes_bid_dollars: '0.2500',
          }, {
            ticker: 'KXNFLTD-26OCT05NYGPHI-PHISBARKLEY26-1',
            title: 'Saquon Barkley: 1+ touchdowns',
            occurrence_datetime: '2026-10-05T17:00:00Z',
            yes_ask_dollars: '0.5500',
            yes_bid_dollars: '0.5300',
          }],
        }),
      };
    }
    if (String(url).includes('series_ticker=KXNFLFIRSTTD')) {
      return { ok: true, status: 200, json: async () => ({ markets: [], cursor: '' }) };
    }
    if (String(url).includes('underdogfantasy')) {
      return { ok: true, status: 200, json: async () => ({ over_under_lines: {} }) };
    }
    if (String(url).includes('/v1/events/slug/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          event: {
            slug: 'nfl-kc-mia-2026-09-27',
            startTime: '2026-09-27T17:00:00Z',
            teams: [
              { id: 63, name: 'Kansas City Chiefs', displayAbbreviation: 'KC' },
              { id: 67, name: 'Miami Dolphins', displayAbbreviation: 'MIA' },
            ],
            markets: [{
              sportsMarketType: 'football_player_touchdowns',
              line: 1,
              metadata: { playerName: 'Travis Kelce', lineLabel: '1+', teamId: 63 },
              bestAskQuote: { value: '0.6000' },
              bestBidQuote: { value: '0.5800' },
            }],
          },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const res = jsonRes();
  await handler({ method: 'GET', url: '/api/player-td-board' }, res, {
    fetchFn,
    supabaseClient: null,
    cache: { at: 0, body: null },
    cacheMs: 0,
    now: Date.parse('2026-09-26T12:00:00Z'),
    sleepFn: async () => {},
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.games.length, 1);
  const kelce = res.body.games[0].players.find((p) => p.name === 'Travis Kelce');
  assert.ok(kelce);
  assert.equal(typeof kelce.anytime.kalshi, 'number');
  assert.equal(typeof kelce.anytime.polymarket, 'number');
  assert.ok(kelce.anytime.best != null);
  assert.equal(String(kelce.anytime.kalshi).includes('.'), false);
  assert.equal(kelce.two.kalshi, null);
  assert.equal(kelce.first.kalshi, null);
  assert.ok(calls.some((url) => String(url).includes('nfl-kc-mia-2026-09-27')));
  assert.equal(calls.some((url) => String(url).includes('KXNFLFIRSTTD')), false);
  assert.equal(calls.some((url) => String(url).includes('2026-10-05')), false);
  assert.equal(calls.some((url) => String(url).includes('novig.com')), false, 'cold board must not spend the 25s Novig budget');
  assert.match(res.headers['Cache-Control'], /stale-while-revalidate=240/);

  const warmedCalls = [];
  const warmed = jsonRes();
  const fetchedAt = '2026-09-26T11:55:00.000Z';
  await handler({ method: 'GET', url: '/api/player-td-board' }, warmed, {
    now: Date.parse('2026-09-26T12:00:00Z'),
    fetchFn: async (url) => { warmedCalls.push(String(url)); throw new Error('upstream'); },
    supabaseClient: {
      from(table) {
        assert.equal(table, 'player_prop_cache');
        return {
          select() { return this; },
          eq(col, val) {
            assert.equal(col, 'event_id');
            assert.equal(val, 'nfl-player-td-board');
            return this;
          },
          maybeSingle: async () => ({
            error: null,
            data: {
              fetched_at: fetchedAt,
              data: {
                fetchedAt,
                games: [{ gameKey: 'KC|MIA|2026-09-27', players: [{ name: 'Travis Kelce' }] }],
              },
            },
          }),
        };
      },
    },
  });
  assert.equal(warmed.statusCode, 200);
  assert.equal(warmed.body.cached, true);
  assert.equal(warmed.body.games[0].players[0].name, 'Travis Kelce');
  assert.equal(warmedCalls.length, 0, 'a cron snapshot must not hit Kalshi, Polymarket, Underdog, or Novig');
  assert.match(warmed.headers['Cache-Control'], /s-maxage=60/);

  const stale = jsonRes();
  const staleCalls = [];
  const staleAt = '2026-09-26T11:40:00.000Z';
  await handler({ method: 'GET', url: '/api/player-td-board' }, stale, {
    now: Date.parse('2026-09-26T12:00:00Z'),
    fetchFn: async (url) => { staleCalls.push(String(url)); throw new Error('upstream'); },
    supabaseClient: {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({
            error: null,
            data: { fetched_at: staleAt, data: { fetchedAt: staleAt, games: [{ gameKey: 'g', players: [] }] } },
          }),
        };
      },
    },
  });
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.body.cached, true);
  assert.equal(staleCalls.length, 0, 'a snapshot inside 30 minutes is served stale, not rebuilt');
  console.log('player-td-board.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
