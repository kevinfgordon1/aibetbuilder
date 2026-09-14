'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('./betstamp-markets');
const streamHandler = require('./betstamp-stream');

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
    assert.equal(calls.length, 3);
    assert.ok(calls.every((u) => !String(u).includes('test-key-not-real')));
    assert.ok(!JSON.stringify(res.body).includes('test-key-not-real'));
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
  }

  {
    const res = mockRes();
    await streamHandler({ method: 'GET', query: {} }, res, { env: {} });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.missingKey, true);
  }

  {
    const src = fs.readFileSync(path.join(__dirname, 'betstamp-markets.js'), 'utf8');
    const stream = fs.readFileSync(path.join(__dirname, 'betstamp-stream.js'), 'utf8');
    const fetchOdds = fs.readFileSync(path.join(__dirname, 'fetch-odds.js'), 'utf8');
    assert.match(src, /BETSTAMP_API_KEY/);
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
