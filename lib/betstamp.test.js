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

const params = b.buildMarketParams({ league: 'NFL', is_live: 'true' });
assert.equal(params.league, 'NFL');
assert.equal(params.is_live, 'true');
assert.match(params.book_ids, /100,200/);
assert.equal(params.bet_types, 'moneyline,spread,total');
assert.equal(params.periods, 'FT');
assert.equal(params.include_alts, 'false');
assert.equal(params.fixture_id, undefined);

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

const stream = b.streamUrl({ league: 'NFL', is_live: 'true', book_ids: '100,200' });
assert.match(stream, /stream\.betstamp\.com\/v1\/markets/);
assert.match(stream, /is_live=true/);

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
  console.log('betstamp.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
