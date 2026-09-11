'use strict';

const assert = require('node:assert/strict');
const {
  FEATURED_SPORTS,
  EVENT_MARKETS,
  ODDS_API_TIMEOUT_MS,
  FETCH_ODDS_RESPOND_BY_MS,
  parseRequestedSports,
  isFeaturedOnlyQuery,
  remainingMs,
  featuredOddsUrl,
  featuredMarketsParam,
  eventsInHorizon,
  fetchJson,
  runFetchOddsJob,
  isSupabaseUnreachable,
} = require('./odds-fetch-job');

function identity(data) { return data; }

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function hang() {
  return new Promise(() => {});
}

function createSupabase({ hangUpsert = false, cache = {}, events = [] } = {}) {
  const upserts = [];
  return {
    upserts,
    from(table) {
      const state = { table, eq: null };
      const chain = {
        select() { return chain; },
        eq(col, val) { state.eq = { col, val }; return chain; },
        in() { return chain; },
        gte() { return chain; },
        lt() { return chain; },
        maybeSingle() { return chain; },
        abortSignal() { return chain; },
        upsert(row) {
          upserts.push({ table, row });
          if (hangUpsert && table === 'odds_cache') return hang();
          return Promise.resolve({ error: null });
        },
        delete() { return chain; },
        then(resolve, reject) {
          if (table === 'odds_cache') {
            const sport = state.eq && state.eq.val;
            const row = sport && cache[sport] ? cache[sport] : null;
            return Promise.resolve({ data: row, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: events, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

{
  assert.deepEqual(parseRequestedSports(undefined), FEATURED_SPORTS);
  assert.deepEqual(parseRequestedSports(''), FEATURED_SPORTS);
  assert.deepEqual(parseRequestedSports('baseball_mlb,americanfootball_nfl'), [
    'baseball_mlb',
    'americanfootball_nfl',
  ]);
  assert.deepEqual(parseRequestedSports('not_a_sport'), FEATURED_SPORTS);
  assert.equal(isFeaturedOnlyQuery({ featuredOnly: '1' }), true);
  assert.equal(isFeaturedOnlyQuery({ featured_only: true }), true);
  assert.equal(isFeaturedOnlyQuery({}), false);
  assert.ok(remainingMs(Date.now(), 20000) <= 20000);
  assert.ok(remainingMs(Date.now() - 25000, 20000) < 0);
  assert.match(featuredOddsUrl('baseball_mlb', 'k'), /includeBetLimits=true/);
  assert.match(featuredOddsUrl('baseball_mlb', 'k'), /regions=us,us2,us_ex,eu/);
  assert.match(featuredOddsUrl('baseball_mlb', 'k'), /markets=h2h,spreads,totals/);
  assert.doesNotMatch(featuredOddsUrl('baseball_mlb', 'k'), /h2h_lay/);
  assert.match(featuredOddsUrl('soccer_epl', 'k'), /markets=h2h,h2h_lay,spreads,totals/);
  assert.match(featuredOddsUrl('soccer_usa_mls', 'k'), /h2h_lay/);
  assert.ok(FEATURED_SPORTS.includes('soccer_epl'));
  assert.ok(FEATURED_SPORTS.includes('soccer_usa_mls'));
  assert.equal(featuredMarketsParam('soccer_epl'), 'h2h,h2h_lay,spreads,totals');
  assert.equal(featuredMarketsParam('baseball_mlb'), 'h2h,spreads,totals');
  assert.ok(!EVENT_MARKETS.soccer_epl);
  assert.ok(!EVENT_MARKETS.soccer_usa_mls);
  assert.ok(EVENT_MARKETS.baseball_mlb);
  assert.equal(ODDS_API_TIMEOUT_MS, 8000);
  assert.equal(FETCH_ODDS_RESPOND_BY_MS, 20000);
}

{
  const now = Date.parse('2026-09-08T18:00:00.000Z');
  const games = [
    { id: 'past', commence_time: '2026-09-08T17:00:00.000Z' },
    { id: 'soon', commence_time: '2026-09-08T22:00:00.000Z' },
    { id: 'far', commence_time: '2026-09-10T18:00:00.000Z' },
  ];
  assert.deepEqual(eventsInHorizon(games, now).map((g) => g.id), ['soon']);
}

async function main() {
{
  const t0 = Date.now();
  const out = await fetchJson('https://example.test/hang', {
    timeoutMs: 40,
    fetchImpl: () => hang(),
  });
  assert.ok(Date.now() - t0 < 500);
  assert.equal(out.ok, false);
  assert.equal(out.error.name, 'TimeoutError');
}

{
  const supabase = createSupabase();
  const calls = [];
  const out = await runFetchOddsJob({
    sports: ['baseball_mlb', 'americanfootball_nfl'],
    featuredOnly: true,
    apiKey: 'k',
    applyBookAdjustments: identity,
    supabaseClient: supabase,
    fetchImpl: async (url) => {
      calls.push(url);
      const sport = url.includes('americanfootball_nfl') ? 'americanfootball_nfl' : 'baseball_mlb';
      return jsonRes([{ id: sport, commence_time: '2026-09-08T22:00:00.000Z', bookmakers: [] }]);
    },
  });
  assert.equal(out.success, true);
  assert.deepEqual(out.results.map((r) => r.sport), ['baseball_mlb', 'americanfootball_nfl']);
  assert.ok(out.results.every((r) => r.games === 1 && !r.error));
  assert.equal(supabase.upserts.length, 2);
  assert.ok(!out.results.some((r) => 'event_markets' in r));
  assert.ok(calls.every((u) => /\/odds\/\?/.test(u) && !/\/events\//.test(u)));
}

{
  const t0 = Date.now();
  const supabase = createSupabase();
  const out = await runFetchOddsJob({
    sports: ['baseball_mlb'],
    featuredOnly: true,
    apiKey: 'k',
    applyBookAdjustments: identity,
    supabaseClient: supabase,
    fetchImpl: () => hang(),
    oddsApiTimeoutMs: 40,
  });
  assert.ok(Date.now() - t0 < 500, 'hung Odds API must not hold the cron open');
  assert.equal(out.results[0].sport, 'baseball_mlb');
  assert.match(out.results[0].error, /timed out/i);
  assert.equal(supabase.upserts.length, 0);
}

{
  const supabase = createSupabase({ hangUpsert: true });
  const t0 = Date.now();
  const out = await runFetchOddsJob({
    sports: ['baseball_mlb'],
    featuredOnly: true,
    apiKey: 'k',
    applyBookAdjustments: identity,
    supabaseClient: supabase,
    fetchImpl: async () => jsonRes([{ id: 'g' }]),
    upsertTimeoutMs: 40,
  });
  assert.ok(Date.now() - t0 < 500, 'hung odds_cache upsert must not hang fetch-odds');
  assert.ok(out.results[0].error);
  assert.equal(out.cacheUnreachable, true);
  assert.equal(out.success, false);
  assert.equal(out.featured[0].data[0].id, 'g');
}

{
  assert.equal(isSupabaseUnreachable({ status: 522, message: 'error code: 522' }), true);
  assert.equal(isSupabaseUnreachable({ message: 'Connection terminated due to connection timeout' }), true);
  assert.equal(isSupabaseUnreachable({ message: 'HTTP 401' }), false);
}

{
  const supabase = createSupabase({ hangUpsert: true });
  const t0 = Date.now();
  const out = await runFetchOddsJob({
    sports: ['baseball_mlb', 'americanfootball_nfl'],
    featuredOnly: false,
    apiKey: 'k',
    applyBookAdjustments: identity,
    supabaseClient: supabase,
    fetchImpl: async () => jsonRes([{ id: 'g', commence_time: '2026-09-08T22:00:00.000Z', bookmakers: [] }]),
    upsertTimeoutMs: 40,
  });
  assert.ok(Date.now() - t0 < 500, 'first hung upsert must abort remaining sports and event loops');
  assert.equal(out.cacheUnreachable, true);
  assert.equal(supabase.upserts.length, 1);
  assert.ok(out.results.some((r) => r.skipped === 'supabase_unreachable'));
  assert.ok(!out.results.some((r) => 'event_markets' in r));
}

console.log('odds-fetch-job.test.js: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
