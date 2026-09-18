'use strict';

const assert = require('node:assert/strict');
const b = require('./betstamp');

assert.deepEqual(b.parseLeagues('NFL,NCAAF'), ['NFL', 'NCAAF']);
assert.deepEqual(b.parseLeagues('nhl,NFL'), ['NFL']);
assert.deepEqual(b.parseLeagues(''), ['NFL']);
assert.deepEqual(b.parseBookIds('100,200,999'), [100, 200]);
assert.deepEqual(b.parseBookIds(''), b.TRIAL_BOOK_IDS);
assert.equal(b.parseBool('true'), true);
assert.equal(b.parseBool('0'), false);
assert.equal(b.parseBool(''), null);

assert.equal(b.DEFAULT_TIMEDELTA_HOURS, 240);
assert.equal(b.parseTimedelta(undefined, {}), 240);
assert.equal(b.parseTimedelta('480', {}), 480);
assert.equal(b.parseTimedelta('', { BETSTAMP_TIMEDELTA: '120' }), 120);
assert.equal(b.parseTimedelta('360', { BETSTAMP_TIMEDELTA: '120' }), 360);
assert.equal(b.parseTimedelta('nope', {}), 240);
assert.equal(b.parseTimedelta('0', {}), 240);
assert.equal(b.parseTimedelta('-12', {}), 240);

assert.deepEqual(b.filterMatchRows([
  { id: 'm1', type: 'match' },
  { id: 't1', type: 'tournament' },
  { id: 'f1', type: 'futures' },
  { id: 'bare' },
  { id: 'empty', type: '' },
]).map((r) => r.id), ['m1', 'bare', 'empty']);

const params = b.buildMarketParams({ league: 'NFL', is_live: 'true' }, {});
assert.equal(params.league, 'NFL');
assert.equal(params.is_live, 'true');
assert.match(params.book_ids, /100,200/);
assert.equal(params.bet_types, 'moneyline,spread,total');
assert.equal(params.periods, 'FT');
assert.equal(params.include_alts, 'false');
assert.equal(params.fixture_id, undefined);
assert.equal(params.timedelta, '240');
assert.equal(b.buildMarketParams({ league: 'NFL', timedelta: '336' }, { BETSTAMP_TIMEDELTA: '120' }).timedelta, '336');
assert.equal(b.buildMarketParams({ league: 'NFL' }, { BETSTAMP_TIMEDELTA: '168' }).timedelta, '168');

const altParams = b.buildMarketParams({ league: 'NFL', include_alts: 'true', fixture_id: 'fix-1' });
assert.equal(altParams.include_alts, 'true');
assert.equal(altParams.fixture_id, 'fix-1');
assert.deepEqual(b.filterMarketsToFixture([
  { fixture_id: 'fix-1', id: 'a' },
  { fixture_id: 'fix-2', id: 'b' },
], 'fix-1').map((m) => m.id), ['a']);

const rest = b.restUrl('markets', { league: 'NFL', book_ids: '100', bet_types: 'moneyline' });
assert.match(rest, /api\/markets/);
assert.match(rest, /league=NFL/);
assert.doesNotMatch(rest, /X-API-KEY|apiKey=/);

const stream = b.streamUrl({ league: 'NFL', is_live: 'true', book_ids: '100,200', timedelta: '240' });
assert.match(stream, /stream\.betstamp\.com\/v1\/markets/);
assert.match(stream, /is_live=true/);
assert.doesNotMatch(stream, /timedelta=/);

assert.equal(b.apiKey({}), '');
assert.equal(b.apiKey({ BETSTAMP_API_KEY: '  abc  ' }), 'abc');
assert.match(b.redact('key=abcdefghijklmnopqrstuvwxyz012345'), /\[redacted\]/);

const parsed = b.parseSseChunk('data: {"odds":1.91}\n\n: keepalive\n\n');
assert.equal(parsed.events.length, 2);
assert.deepEqual(parsed.events[0].dataLines, ['{"odds":1.91}']);
const wrapped = JSON.parse(b.wrapSseEvent(parsed.events[0], 42).split('\n').find((l) => l.startsWith('data: ')).slice(6));
assert.equal(wrapped.ingest_ts, 42);
assert.equal(wrapped.payload.odds, 1.91);

{
  const q = b.readQuery({ url: '/api/betstamp-markets?league=NCAAF&is_live=true' });
  assert.equal(q.league, 'NCAAF');
  assert.equal(q.is_live, 'true');
}

(async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        markets: [
          { id: 'm1', odds: 1.91, fixture_id: 'f1', is_alt: true },
          { id: 'm2', odds: 2.10, fixture_id: 'f2', is_alt: true },
        ],
      }),
    };
  };
  const snap = await b.fetchSnapshot(
    { league: 'NFL', include_alts: 'true', fixture_id: 'f1' },
    { env: { BETSTAMP_API_KEY: 'test-key-not-real' }, fetchFn },
  );
  assert.equal(calls.length, 1, 'fixture alt pull is markets-only');
  assert.match(calls[0], /include_alts=true/);
  assert.match(calls[0], /fixture_id=f1/);
  assert.doesNotMatch(calls[0], /test-key-not-real/);
  assert.equal(snap.markets.length, 1);
  assert.equal(snap.markets[0].fixture_id, 'f1');
  assert.deepEqual(snap.fixtures, []);
  assert.deepEqual(snap.teams, []);
  assert.equal(snap.query.include_alts, 'true');
  assert.equal(snap.query.fixture_id, 'f1');
  assert.equal(snap.query.timedelta, '240');
  assert.match(calls[0], /timedelta=240/);

  const slateCalls = [];
  const slateFetch = async (url) => {
    slateCalls.push(String(url));
    const u = String(url);
    if (u.includes('/markets')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          markets: [
            { id: 'keep-typed', type: 'match', fixture_id: 'f1' },
            { id: 'drop-futures', type: 'tournament', fixture_id: 'tourney' },
            { id: 'keep-untyped', fixture_id: 'f2' },
          ],
        }),
      };
    }
    if (u.includes('/fixtures')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          fixtures: [
            { id: 'f1', type: 'match', league: 'NFL' },
            { id: 'tourney', type: 'tournament', league: 'NFL' },
            { id: 'f2', league: 'NFL' },
          ],
        }),
      };
    }
    if (u.includes('/teams')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ teams: [{ id: 't1' }] }) };
    }
    throw new Error('unexpected ' + url);
  };
  const slate = await b.fetchSnapshot(
    { league: 'NFL', timedelta: '336' },
    { env: { BETSTAMP_API_KEY: 'test-key-not-real' }, fetchFn: slateFetch, gapMs: 0 },
  );
  assert.equal(slateCalls.length, 3);
  const marketUrl = slateCalls.find((u) => u.includes('/markets'));
  const fixtureUrl = slateCalls.find((u) => u.includes('/fixtures'));
  const teamUrl = slateCalls.find((u) => u.includes('/teams'));
  assert.match(marketUrl, /timedelta=336/);
  assert.match(fixtureUrl, /timedelta=336/);
  assert.match(fixtureUrl, /league=NFL/);
  assert.doesNotMatch(teamUrl, /timedelta=/);
  assert.equal(slate.query.timedelta, '336');
  assert.deepEqual(slate.markets.map((m) => m.id), ['keep-typed', 'keep-untyped']);
  assert.deepEqual(slate.fixtures.map((f) => f.id), ['f1', 'f2']);

  assert.equal(b.SNAPSHOT_CACHE_TTL_MS, 5 * 60 * 1000);
  assert.equal(b.SNAPSHOT_CACHE_SWR_SEC, 60);
  const nflKey = b.snapshotCacheKey({ league: 'NFL', book_ids: '642', is_live: 'false' }, {});
  const ncaafKey = b.snapshotCacheKey({ league: 'NCAAF', book_ids: '642', is_live: 'false' }, {});
  const nflLiveKey = b.snapshotCacheKey({ league: 'NFL', book_ids: '642', is_live: 'true' }, {});
  const nflAltKey = b.snapshotCacheKey({ league: 'NFL', book_ids: '642', include_alts: 'true', fixture_id: 'f1' }, {});
  assert.notEqual(nflKey, ncaafKey, 'NFL and NCAAF must not share a cache key');
  assert.notEqual(nflKey, nflLiveKey);
  assert.notEqual(nflKey, nflAltKey);
  assert.equal(
    b.snapshotCacheKey({ league: 'NFL', book_ids: '642,200' }, {}),
    b.snapshotCacheKey({ league: 'NFL', book_ids: '200,642' }, {}),
  );
  assert.equal(b.snapshotCacheWantsRefresh({ refresh: '1' }, {}), true);
  assert.equal(b.snapshotCacheWantsRefresh({ force: 'true' }, {}), true);
  assert.equal(b.snapshotCacheWantsRefresh({}, { force: true }), true);
  assert.equal(b.snapshotCacheWantsRefresh({}, {}), false);
  assert.match(b.snapshotCacheControl(b.SNAPSHOT_CACHE_TTL_MS), /s-maxage=300/);
  assert.match(b.snapshotCacheControl(b.SNAPSHOT_CACHE_TTL_MS), /stale-while-revalidate=60/);

  function slateFetchFor(league) {
    let calls = 0;
    const fetchFn = async (url) => {
      calls += 1;
      const u = String(url);
      if (u.includes('/markets')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ markets: [{ id: `${league}-m`, fixture_id: `${league}-f` }] }) };
      }
      if (u.includes('/fixtures')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ fixtures: [{ id: `${league}-f`, league }] }) };
      }
      if (u.includes('/teams')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ teams: [{ id: `${league}-t` }] }) };
      }
      throw new Error('unexpected ' + url);
    };
    return { fetchFn, count: () => calls };
  }

  {
    const cache = b.createSnapshotCache();
    const inflight = new Map();
    const nfl = slateFetchFor('NFL');
    const now = 5_000;
    const miss = await b.fetchSnapshotWithCache(
      { league: 'NFL', book_ids: '642', is_live: 'false' },
      { env: { BETSTAMP_API_KEY: 'test-key-not-real' }, fetchFn: nfl.fetchFn, gapMs: 0, cache, inflight, nowMs: now },
    );
    assert.equal(miss.cacheStatus, 'MISS');
    assert.equal(miss.snap.markets[0].id, 'NFL-m');
    assert.equal(nfl.count(), 3);
    const hit = await b.fetchSnapshotWithCache(
      { league: 'NFL', book_ids: '642', is_live: 'false' },
      { env: { BETSTAMP_API_KEY: 'test-key-not-real' }, fetchFn: nfl.fetchFn, gapMs: 0, cache, inflight, nowMs: now + 60_000 },
    );
    assert.equal(hit.cacheStatus, 'HIT');
    assert.equal(hit.ageMs, 60_000);
    assert.equal(hit.snap.markets[0].id, 'NFL-m');
    assert.equal(nfl.count(), 3, 'TTL hit must not re-call Betstamp');

    const ncaaf = slateFetchFor('NCAAF');
    const ncaafMiss = await b.fetchSnapshotWithCache(
      { league: 'NCAAF', book_ids: '642', is_live: 'false' },
      { env: { BETSTAMP_API_KEY: 'test-key-not-real' }, fetchFn: ncaaf.fetchFn, gapMs: 0, cache, inflight, nowMs: now + 60_000 },
    );
    assert.equal(ncaafMiss.cacheStatus, 'MISS');
    assert.equal(ncaaf.count(), 3);
    const nflStill = await b.fetchSnapshotWithCache(
      { league: 'NFL', book_ids: '642', is_live: 'false' },
      { env: { BETSTAMP_API_KEY: 'test-key-not-real' }, fetchFn: nfl.fetchFn, gapMs: 0, cache, inflight, nowMs: now + 60_000 },
    );
    assert.equal(nflStill.cacheStatus, 'HIT');
    assert.equal(nfl.count(), 3, 'NCAAF miss must not evict a warm NFL key');

    const expired = await b.fetchSnapshotWithCache(
      { league: 'NFL', book_ids: '642', is_live: 'false' },
      { env: { BETSTAMP_API_KEY: 'test-key-not-real' }, fetchFn: nfl.fetchFn, gapMs: 0, cache, inflight, nowMs: now + b.SNAPSHOT_CACHE_TTL_MS + 1 },
    );
    assert.equal(expired.cacheStatus, 'MISS');
    assert.equal(nfl.count(), 6);

    const afterForce = await b.fetchSnapshotWithCache(
      { league: 'NFL', book_ids: '642', is_live: 'false', refresh: '1' },
      { env: { BETSTAMP_API_KEY: 'test-key-not-real' }, fetchFn: nfl.fetchFn, gapMs: 0, cache, inflight, nowMs: now + 10_000 },
    );
    assert.equal(afterForce.cacheStatus, 'MISS');
    assert.equal(nfl.count(), 9, '?refresh=1 bypasses server TTL');
  }

  console.log('betstamp.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
