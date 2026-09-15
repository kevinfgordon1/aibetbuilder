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

  console.log('betstamp.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
