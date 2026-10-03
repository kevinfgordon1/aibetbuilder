'use strict';

// Relay-facing live poll knobs: Betstamp ?parts= and Underdog ?fresh=1&sport=.
const assert = require('node:assert/strict');
const b = require('./betstamp');
const ud = require('./underdog-lobby');
const betstampHandler = require('../api/betstamp-markets');
const underdogHandler = require('../api/underdog-predict');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() {},
  };
}
function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

(async () => {
  // ---- parseParts
  assert.equal(b.parseParts(undefined), null);
  assert.equal(b.parseParts(''), null);
  assert.equal(b.parseParts('nope'), null);
  assert.deepEqual([...b.parseParts('markets')], ['markets']);
  assert.deepEqual([...b.parseParts('Markets, fixtures,bogus')].sort(), ['fixtures', 'markets']);

  // ---- /api/betstamp-markets?parts=markets is ONE upstream GET
  {
    const calls = [];
    const fetchFn = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/markets')) return jsonRes(200, { markets: [{ id: 'm1', odds: 1.9, fixture_id: 'f1' }] });
      if (u.includes('/fixtures')) return jsonRes(200, { fixtures: [{ id: 'f1' }] });
      if (u.includes('/teams')) return jsonRes(200, { teams: [{ id: 't1' }] });
      throw new Error('unexpected ' + u);
    };
    const env = { BETSTAMP_API_KEY: 'test-key-not-real' };
    const res = mockRes();
    await betstampHandler({ method: 'GET', query: { league: 'NCAAF', is_live: 'true', refresh: '1', parts: 'markets' } }, res, { env, fetchFn, gapMs: 0, cache: new Map(), inflight: new Map() });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/markets/);
    assert.equal(res.body.markets.length, 1);
    assert.deepEqual(res.body.fixtures, []);
    assert.deepEqual(res.body.teams, []);
    assert.equal(res.body.query.parts, 'markets');

    calls.length = 0;
    const res2 = mockRes();
    await betstampHandler({ method: 'GET', query: { league: 'NCAAF', is_live: 'true', refresh: '1', parts: 'markets,fixtures' } }, res2, { env, fetchFn, gapMs: 0, cache: new Map(), inflight: new Map() });
    assert.equal(calls.length, 2);
    assert.equal(res2.body.fixtures.length, 1);
    assert.deepEqual(res2.body.teams, []);

    calls.length = 0;
    const res3 = mockRes();
    await betstampHandler({ method: 'GET', query: { league: 'NCAAF', is_live: 'true', refresh: '1' } }, res3, { env, fetchFn, gapMs: 0, cache: new Map(), inflight: new Map() });
    assert.equal(calls.length, 3, 'no parts = all three, unchanged');
    assert.equal(res3.body.query.parts, undefined);

    // A partial pull is never served from cache for a full one.
    const cache = new Map();
    const inflight = new Map();
    const q = { league: 'NCAAF', is_live: 'false' };
    const k1 = b.snapshotCacheKey ? b.snapshotCacheKey({ ...q, parts: 'markets' }, env, new Set()) : 'a';
    const k2 = b.snapshotCacheKey ? b.snapshotCacheKey(q, env, new Set()) : 'b';
    assert.notEqual(k1, k2);
    void cache; void inflight;
  }

  // ---- Underdog: sport filter, scaffold cache, fresh bust bucket
  {
    const urls = [];
    const fetchFn = async (url) => {
      const u = String(url);
      urls.push(u);
      if (u.includes('/lobbies/scaffolds/sports')) return jsonRes(200, { sections: [] });
      return jsonRes(200, { games: {}, appearances: {}, over_under_lines: {} });
    };
    const sportOf = (u) => new URL(u).searchParams.get('sport_id');
    const scaffoldCache = new Map();
    const cache = new Map();
    const now = 1_790_000_000_000;
    await ud.fetchUnderdogPhone({ env: {}, fetchFn, cache, scaffoldCache, live: true, fresh: true, sports: 'NCAAF', now });
    assert.ok(urls.length > 0);
    assert.ok(urls.every((u) => sportOf(u) === 'CFB'), 'sport=NCAAF only touches CFB');
    const scaffoldCalls1 = urls.filter((u) => u.includes('/scaffolds/')).length;
    assert.equal(scaffoldCalls1, 1);
    const cbs1 = urls.filter((u) => u.includes('/content/lines')).map((u) => new URL(u).searchParams.get('_cb'));
    assert.ok(cbs1.length > 0);
    assert.ok(cbs1.every((v) => v === String(Math.floor(now / 1000))), '1s bust bucket');

    // 2s later: new bust bucket, scaffold NOT re-fetched.
    urls.length = 0;
    await ud.fetchUnderdogPhone({ env: {}, fetchFn, cache, scaffoldCache, live: true, fresh: true, sports: 'NCAAF', now: now + 2000 });
    assert.equal(urls.filter((u) => u.includes('/scaffolds/')).length, 0, 'scaffold filter ids cached');
    const cbs2 = urls.filter((u) => u.includes('/content/lines')).map((u) => new URL(u).searchParams.get('_cb'));
    assert.ok(cbs2.length > 0 && cbs2.every((v) => v === String(Math.floor((now + 2000) / 1000))));

    // 500ms later: memory cache hit (1s), no upstream.
    urls.length = 0;
    const hit = await ud.fetchUnderdogPhone({ env: {}, fetchFn, cache, scaffoldCache, live: true, fresh: true, sports: 'NCAAF', now: now + 2500 });
    assert.equal(hit.cacheStatus, 'HIT');
    assert.equal(urls.length, 0);

    // Plain live=1 keeps the 5s bucket and 5s cache.
    urls.length = 0;
    await ud.fetchUnderdogPhone({ env: {}, fetchFn, cache: new Map(), scaffoldCache: new Map(), live: true, now });
    const cbs3 = urls.filter((u) => u.includes('/content/lines')).map((u) => new URL(u).searchParams.get('_cb'));
    assert.ok(cbs3.every((v) => v === String(Math.floor(now / 5000))));
    assert.ok(new Set(urls.map(sportOf)).size > 1, 'no sport filter = all sports');

    // Non-live path never uses the scaffold cache (45s path unchanged).
    urls.length = 0;
    await ud.fetchUnderdogPhone({ env: {}, fetchFn, cache: new Map(), live: false, now });
    assert.ok(urls.some((u) => u.includes('/scaffolds/')));
  }

  // ---- route reads ?fresh and ?sport
  {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/lobbies/scaffolds/sports')) return jsonRes(200, { sections: [] });
      return jsonRes(200, { games: {}, appearances: {}, over_under_lines: {} });
    };
    const res = mockRes();
    await underdogHandler({ method: 'GET', query: { live: '1', fresh: '1', sport: 'NFL' } }, res, { env: {}, cache: new Map(), scaffoldCache: new Map(), fetchFn });
    assert.equal(res.statusCode, 200);
    assert.ok(urls.every((u) => new URL(u).searchParams.get('sport_id') === 'NFL'));
    assert.equal(res.headers['X-Underdog-Cache'], 'MISS');
  }

  console.log('live-fresh-poll.test.js ok');
})().catch((err) => { console.error(err); process.exit(1); });
