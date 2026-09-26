'use strict';

const assert = require('node:assert/strict');
const { runPlayerPropsJob, redactSecrets } = require('./player-props-job');

(async () => {
  const logs = [];
  const original = console.log;
  console.log = (...args) => { logs.push(args.map(String).join(' ')); };
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    assert.equal(String(url).includes('super-secret-odds-key'), true);
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          if (name === 'x-requests-remaining') return '2200000';
          if (name === 'x-requests-used') return '180';
          if (name === 'x-requests-last') return '1';
          return null;
        },
      },
      json: async () => ({
        id: 'event-1',
        away_team: 'Kansas City Chiefs',
        home_team: 'Miami Dolphins',
        commence_time: '2026-09-27T17:00:00Z',
        bookmakers: [{
          key: 'draftkings',
          markets: [{
            key: 'player_anytime_td',
            outcomes: [{ name: 'Over', description: 'Travis Kelce', price: 160 }],
          }],
        }],
      }),
    };
  };
  const upserts = [];
  const supabaseClient = {
    from(table) {
      const api = {
        upsert(row) {
          assert.equal(table, 'player_prop_cache');
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
        delete() {
          return { eq() { return { lt() { return Promise.resolve({ error: null }); } }; } };
        },
        select() { return api; },
        eq() { return api; },
        maybeSingle() {
          assert.equal(table, 'odds_cache');
          return Promise.resolve({ data: { data: [{ id: 'event-1', away_team: 'Kansas City Chiefs', home_team: 'Miami Dolphins', commence_time: '2026-09-27T17:00:00Z' }] } });
        },
      };
      return api;
    },
  };
  try {
    const result = await runPlayerPropsJob({
      apiKey: 'super-secret-odds-key',
      fetchImpl,
      supabaseClient,
      now: Date.parse('2026-09-27T00:00:00Z'),
      exchangeQuotes: [{
        book: 'kalshi',
        market: 'anytime',
        player: 'Travis Kelce',
        team: 'KC',
        gameKey: 'KC|MIA|2026-09-27',
        yesAmerican: -155,
        noAmerican: 140,
      }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.upserts, 1);
    assert.equal(upserts[0].data.players[0].markets.anytime.offers[0].price, 160);
    assert.equal(upserts[0].data.players[0].markets.anytime.opp.price, 140);
    assert.equal(logs.some((line) => line.includes('x-requests-remaining') || line.includes('2200000')), true);
    assert.equal(logs.some((line) => line.includes('super-secret-odds-key')), false);
    assert.equal(redactSecrets(seen[0]).includes('super-secret-odds-key'), false);
    assert.match(seen[0], /regions=us,us2(&|$)/);
    assert.equal(/us_ex|regions=[^&]*eu|bookmakers=/.test(seen[0]), false);
    assert.match(seen.join('\n'), /markets=player_anytime_td/);
    assert.equal(seen.some((url) => /player_1st_td|player_tds_over|player_rush_reception_tds/.test(url)), false);
  } finally {
    console.log = original;
  }
  console.log('player-props-job.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
