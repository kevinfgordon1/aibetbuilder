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

console.log('betstamp.test.js ok');
