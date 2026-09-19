'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('./betstamp-markets');
const streamHandler = require('./betstamp-stream');
const { createSnapshotCache, SNAPSHOT_CACHE_TTL_MS } = require('../lib/betstamp');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; this.ended = true; return this; },
    end() { this.ended = true; },
  };
}

(async () => {
  {
    const res = mockRes();
    await handler({ method: 'GET', query: { league: 'NFL' } }, res, { env: {} });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.missingKey, true);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /BETSTAMP_API_KEY/);
  }

  {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      const u = String(url);
      if (u.includes('/markets')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ markets: [{ id: 'm1', odds: 1.91, fixture_id: 'f1' }] }) };
      }
      if (u.includes('/fixtures')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ fixtures: [{ id: 'f1', league: 'NFL' }] }) };
      }
      if (u.includes('/teams')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ teams: [{ id: 't1', name: 'Chiefs' }] }) };
      }
      throw new Error('unexpected ' + url);
    };
    const res = mockRes();
    await handler({ method: 'GET', query: { league: 'NFL', is_live: 'true' } }, res, {
      env: { BETSTAMP_API_KEY: 'test-key-not-real' },
      fetchFn,
      gapMs: 0,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.markets.length, 1);
    assert.equal(res.body.fixtures[0].id, 'f1');
    assert.equal(res.body.query.is_live, 'true');
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.equal(res.body.query.timedelta, '240');
    assert.equal(calls.length, 3);
    const marketUrl = calls.find((u) => String(u).includes('/markets'));
    const fixtureUrl = calls.find((u) => String(u).includes('/fixtures'));
    const teamUrl = calls.find((u) => String(u).includes('/teams'));
    assert.match(String(marketUrl), /timedelta=240/);
    assert.match(String(fixtureUrl), /timedelta=240/);
    assert.doesNotMatch(String(teamUrl), /timedelta=/);
    assert.ok(calls.every((u) => !String(u).includes('test-key-not-real')));
    assert.ok(!JSON.stringify(res.body).includes('test-key-not-real'));
  }

  {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(String(url));
      const u = String(url);
      if (u.includes('/markets')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ markets: [{ id: 'u1', odds: 2.0, fixture_id: 'f1', odd_provider_id: 196 }] }) };
      }
      if (u.includes('/fixtures')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ fixtures: [{ id: 'f1', league: 'NFL' }] }) };
      }
      if (u.includes('/teams')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ teams: [] }) };
      }
      throw new Error('unexpected ' + url);
    };
    const res = mockRes();
    await handler({ method: 'GET', query: { league: 'NFL', book_ids: '196,999' } }, res, {
      env: { BETSTAMP_API_KEY: 'test-key-not-real' },
      fetchFn,
      gapMs: 0,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.query.book_ids, '196');
    const marketUrl = calls.find((u) => u.includes('/markets'));
    assert.match(marketUrl, /book_ids=196/);
    assert.doesNotMatch(marketUrl, /book_ids=196,999|100,200/);
    assert.equal(res.body.markets[0].odd_provider_id, 196);
  }

  {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          markets: [
            { id: 'keep', odds: 1.5, fixture_id: 'f1', is_alt: true },
            { id: 'drop', odds: 1.6, fixture_id: 'f9', is_alt: true },
          ],
        }),
      };
    };
    const res = mockRes();
    await handler({ method: 'GET', query: { league: 'NFL', include_alts: 'true', fixture_id: 'f1' } }, res, {
      env: { BETSTAMP_API_KEY: 'test-key-not-real' },
      fetchFn,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.markets.length, 1);
    assert.equal(res.body.markets[0].id, 'keep');
    assert.equal(res.body.fixtures.length, 0);
    assert.equal(calls.length, 1);
    assert.match(String(calls[0]), /include_alts=true/);
    assert.match(String(calls[0]), /fixture_id=f1/);
    assert.match(String(calls[0]), /timedelta=240/);
    assert.equal(res.body.query.timedelta, '240');
  }

  {
    const res = mockRes();
    await streamHandler({ method: 'GET', query: {} }, res, { env: {} });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.missingKey, true);
  }

  {
    const res = mockRes();
    await handler({ method: 'GET', query: { league: 'NFL' } }, res, { env: {} });
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }

  {
    const cache = createSnapshotCache();
    const inflight = new Map();
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      const u = String(url);
      if (u.includes('/markets')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ markets: [{ id: 'm1', fixture_id: 'f1' }] }) };
      }
      if (u.includes('/fixtures')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ fixtures: [{ id: 'f1', league: 'NFL' }] }) };
      }
      if (u.includes('/teams')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ teams: [{ id: 't1' }] }) };
      }
      throw new Error('unexpected ' + url);
    };
    const deps = {
      env: { BETSTAMP_API_KEY: 'test-key-not-real' },
      fetchFn,
      gapMs: 0,
      cache,
      inflight,
      nowMs: 10_000,
    };
    const miss = mockRes();
    await handler({ method: 'GET', query: { league: 'NFL', book_ids: '642', is_live: 'false' } }, miss, deps);
    assert.equal(miss.statusCode, 200);
    assert.equal(miss.headers['X-Betstamp-Cache'], 'MISS');
    assert.match(miss.headers['Cache-Control'], /s-maxage=300/);
    assert.match(miss.headers['Cache-Control'], /stale-while-revalidate=60/);
    assert.doesNotMatch(miss.headers['Cache-Control'], /no-store/);
    assert.equal(calls.length, 3);

    const hit = mockRes();
    await handler({ method: 'GET', query: { league: 'NFL', book_ids: '642', is_live: 'false' } }, hit, {
      ...deps,
      nowMs: 10_000 + 30_000,
    });
    assert.equal(hit.statusCode, 200);
    assert.equal(hit.headers['X-Betstamp-Cache'], 'HIT');
    assert.equal(hit.headers.Age, '30');
    assert.match(hit.headers['Cache-Control'], /s-maxage=270/);
    assert.equal(hit.body.markets[0].id, 'm1');
    assert.equal(calls.length, 3, 'second Promo load within TTL must not re-hit Betstamp');

    const ncaafCalls = [];
    const ncaafFetch = async (url) => {
      ncaafCalls.push(url);
      const u = String(url);
      if (u.includes('/markets')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ markets: [{ id: 'ncaaf-m', fixture_id: 'ncaaf-f' }] }) };
      }
      if (u.includes('/fixtures')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ fixtures: [{ id: 'ncaaf-f', league: 'NCAAF' }] }) };
      }
      if (u.includes('/teams')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ teams: [] }) };
      }
      throw new Error('unexpected ' + url);
    };
    const ncaaf = mockRes();
    await handler({ method: 'GET', query: { league: 'NCAAF', book_ids: '642', is_live: 'false' } }, ncaaf, {
      ...deps,
      fetchFn: ncaafFetch,
      nowMs: 10_000 + 30_000,
    });
    assert.equal(ncaaf.headers['X-Betstamp-Cache'], 'MISS');
    assert.equal(ncaaf.body.markets[0].id, 'ncaaf-m');
    assert.equal(ncaafCalls.length, 3);
    const nflAgain = mockRes();
    await handler({ method: 'GET', query: { league: 'NFL', book_ids: '642', is_live: 'false' } }, nflAgain, {
      ...deps,
      nowMs: 10_000 + 30_000,
    });
    assert.equal(nflAgain.headers['X-Betstamp-Cache'], 'HIT');
    assert.equal(calls.length, 3, 'NCAAF fetch must not blow the NFL cache');

    const expired = mockRes();
    await handler({ method: 'GET', query: { league: 'NFL', book_ids: '642', is_live: 'false' } }, expired, {
      ...deps,
      nowMs: 10_000 + SNAPSHOT_CACHE_TTL_MS + 1,
    });
    assert.equal(expired.headers['X-Betstamp-Cache'], 'MISS');
    assert.equal(calls.length, 6);
  }

  {
    const src = fs.readFileSync(path.join(__dirname, 'betstamp-markets.js'), 'utf8');
    const stream = fs.readFileSync(path.join(__dirname, 'betstamp-stream.js'), 'utf8');
    const fetchOdds = fs.readFileSync(path.join(__dirname, 'fetch-odds.js'), 'utf8');
    assert.match(src, /BETSTAMP_API_KEY/);
    assert.match(src, /fetchSnapshotWithCache/);
    assert.match(src, /s-maxage/);
    assert.match(stream, /text\/event-stream/);
    assert.match(stream, /ingest_ts/);
    assert.match(stream, /X-API-KEY/);
    assert.doesNotMatch(src, /the-odds-api\.com/);
    assert.doesNotMatch(stream, /the-odds-api\.com/);
    assert.doesNotMatch(fetchOdds, /betstamp/i);
  }

  console.log('betstamp-markets.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
