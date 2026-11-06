'use strict';

// Cold /api/player-td-board must answer inside the deadline even when an
// upstream socket never completes. Prices stay American odds. Novig stays on
// the cron path (loadExchangeTdQuotes) and off the board path.

const assert = require('node:assert/strict');
const http = require('node:http');
const handler = require('../api/player-td-board');
const {
  loadExchangeTdQuotes,
  loadPlayerTdBoard,
  BOARD_DEADLINE_MS,
  BOARD_DEADLINE_GRACE_MS,
  resetPlayerTdBoardCache,
} = require('./player-td-feeds');

const NOW = Date.parse('2026-09-26T12:00:00Z');
const timings = [];

function note(name, elapsed, extra) {
  const row = { name, elapsedMs: elapsed, ...extra };
  timings.push(row);
  console.log(`${name}: ${elapsed}ms ${extra ? JSON.stringify(extra) : ''}`);
}

function httpResult(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const kalshiBody = {
  cursor: '',
  markets: [{
    ticker: 'KXNFLTD-26SEP27KCMIA-KCTKELCE87-1',
    title: 'Travis Kelce: 1+ touchdowns',
    occurrence_datetime: '2026-09-27T17:00:00Z',
    yes_ask_dollars: '0.6400',
    yes_bid_dollars: '0.6200',
  }, {
    ticker: 'KXNFLTD-26OCT05NYGPHI-PHISBARKLEY26-1',
    title: 'Saquon Barkley: 1+ touchdowns',
    occurrence_datetime: '2026-10-05T17:00:00Z',
    yes_ask_dollars: '0.5500',
    yes_bid_dollars: '0.5300',
  }],
};

const polyBody = {
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
};

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

function abortError() {
  return Object.assign(new Error('aborted'), { name: 'TimeoutError' });
}

function routeFactory(calls, behavior) {
  return async function route(url, init) {
    const u = String(url);
    calls.push(u);
    const hang = behavior.hangAll || (behavior.hangUnderdog && u.includes('underdogfantasy'));
    if (hang) {
      if (behavior.honorAbort) {
        return new Promise((resolve, reject) => {
          const signal = init && init.signal;
          const fail = () => reject(abortError());
          if (!signal) {
            const timer = setTimeout(() => resolve(httpResult(200, { markets: [], cursor: '', items: [] })), 30_000);
            timer.unref();
            return;
          }
          if (signal.aborted) return fail();
          signal.addEventListener('abort', fail, { once: true });
        });
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(httpResult(200, {
          markets: [], cursor: '', items: [], over_under_lines: {},
        })), 30_000);
        timer.unref();
      });
    }
    if (behavior.delayMs) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, behavior.delayMs);
        const signal = init && init.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(abortError());
          }, { once: true });
        }
      });
    }
    if (u.includes('series_ticker=KXNFLTD')) return httpResult(200, kalshiBody);
    if (u.includes('series_ticker=KXNFLFIRSTTD')) return httpResult(200, { markets: [], cursor: '' });
    if (u.includes('underdogfantasy')) {
      if (behavior.underdogStatus) return httpResult(behavior.underdogStatus, {});
      return httpResult(200, { over_under_lines: {} });
    }
    if (u.includes('/v1/events/slug/')) return httpResult(200, polyBody);
    if (u.includes('novig.com')) return httpResult(200, { items: [], markets: [], cursor: '' });
    return httpResult(404, {});
  };
}

function boardDeps(calls, behavior, extra) {
  return {
    fetchFn: routeFactory(calls, behavior),
    cache: { at: 0, body: null },
    cacheMs: 45_000,
    now: NOW,
    sleepFn: async () => {},
    deadlineMs: 400,
    fetchTimeoutMs: 150,
    ...extra,
  };
}

function assertAmerican(price, label) {
  assert.equal(typeof price, 'number', label);
  assert.equal(Number.isInteger(price), true, `${label} ${price}`);
}

function kelceOf(body) {
  const game = (body.games || [])[0];
  assert.ok(game, 'expected a game');
  const kelce = (game.players || []).find((player) => player.name === 'Travis Kelce');
  assert.ok(kelce, 'expected Kelce');
  return kelce;
}

async function callHandler(deps) {
  const res = jsonRes();
  const started = Date.now();
  await handler({ method: 'GET', url: '/api/player-td-board' }, res, deps);
  return { res, elapsed: Date.now() - started };
}

function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  return res;
}

function listen(deps) {
  const server = http.createServer((req, res) => {
    decorate(res);
    handler(req, res, deps).catch((err) => {
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end(String(err && err.message || err));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

(async () => {
  resetPlayerTdBoardCache();
  assert.equal(BOARD_DEADLINE_MS, 8000);
  assert.ok(BOARD_DEADLINE_MS < 12_000);
  assert.ok(BOARD_DEADLINE_GRACE_MS < 1000);

  // Complete books inside the budget. American odds, no Novig.
  {
    const calls = [];
    const deps = boardDeps(calls, { delayMs: 40 }, { deadlineMs: 1500, fetchTimeoutMs: 1000 });
    const { res, elapsed } = await callHandler(deps);
    note('complete-within-budget', elapsed, { status: res.statusCode, calls: calls.length });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.partial, false);
    assert.equal(res.body.stale, false);
    assert.equal(res.body.sources.novig, 'skipped');
    assert.equal(res.body.sources.kalshi, 'ok');
    assert.equal(res.body.sources.polymarket, 'ok');
    assert.equal(calls.some((url) => url.includes('novig.com')), false);
    const kelce = kelceOf(res.body);
    assertAmerican(kelce.anytime.kalshi, 'kalshi');
    assertAmerican(kelce.anytime.polymarket, 'polymarket');
    assert.ok(elapsed < 1500, `complete path took ${elapsed}ms`);
    assert.ok(elapsed >= 40, `complete path returned before the upstream delay (${elapsed}ms)`);
  }

  // A socket that never answers must not hold the handler for 30s.
  {
    const calls = [];
    const deps = boardDeps(calls, { hangAll: true }, { deadlineMs: 250, fetchTimeoutMs: 80 });
    const { res, elapsed } = await callHandler(deps);
    note('hung-upstream-ignored-abort', elapsed, { status: res.statusCode, calls: calls.length });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'player_td_unavailable');
    assert.deepEqual(res.body.games, []);
    assert.equal(res.body.partial, true);
    assert.equal(res.body.stale, false);
    assert.equal(res.body.sources.kalshi, 'timeout');
    assert.equal(res.body.sources.underdog, 'timeout');
    assert.equal(res.body.sources.polymarket, 'timeout');
    assert.equal(res.body.sources.novig, 'skipped');
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.ok(elapsed < 2000, `hung upstream held the handler for ${elapsed}ms`);
    assert.ok(elapsed + 40 >= 250, `hung upstream returned too early (${elapsed}ms)`);
  }

  // Abort-aware hung sockets settle through fetchJson, same bound.
  {
    const calls = [];
    const deps = boardDeps(calls, { hangAll: true, honorAbort: true }, { deadlineMs: 250, fetchTimeoutMs: 60 });
    const { res, elapsed } = await callHandler(deps);
    note('hung-upstream-honors-abort', elapsed, { status: res.statusCode, calls: calls.length });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.sources.kalshi, 'timeout');
    assert.ok(elapsed < 2000, elapsed);
  }

  // Three cold callers share one fan-out and one deadline.
  {
    const calls = [];
    const deps = boardDeps(calls, { hangAll: true }, { deadlineMs: 300, fetchTimeoutMs: 80 });
    const started = Date.now();
    const results = await Promise.all([callHandler(deps), callHandler(deps), callHandler(deps)]);
    const elapsed = Date.now() - started;
    note('concurrent-cold-hang', elapsed, { calls: calls.length, statuses: results.map((row) => row.res.statusCode) });
    assert.deepEqual(results.map((row) => row.res.statusCode), [502, 502, 502]);
    assert.equal(calls.filter((url) => url.includes('series_ticker=KXNFLTD')).length, 1);
    assert.equal(calls.filter((url) => url.includes('underdogfantasy')).length, 1);
    assert.ok(elapsed < 2000, `concurrent hang took ${elapsed}ms`);
    assert.ok(elapsed < 300 * 2, `concurrent callers did not share the deadline (${elapsed}ms)`);
  }

  // A slow Underdog must not block Polymarket once Kalshi has a game.
  {
    const calls = [];
    const deps = boardDeps(calls, { hangUnderdog: true }, { deadlineMs: 350, fetchTimeoutMs: 100 });
    const { res, elapsed } = await callHandler(deps);
    note('slow-underdog-poly-still-loads', elapsed, {
      status: res.statusCode,
      sources: res.body.sources,
      poly: calls.some((url) => url.includes('/v1/events/slug/')),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.partial, true);
    assert.equal(res.body.stale, false);
    assert.equal(res.body.sources.kalshi, 'ok');
    assert.equal(res.body.sources.underdog, 'timeout');
    assert.equal(res.body.sources.polymarket, 'ok');
    assert.equal(res.body.sources.novig, 'skipped');
    assert.ok(calls.some((url) => url.includes('nfl-kc-mia-2026-09-27')));
    assert.equal(calls.some((url) => url.includes('novig.com')), false);
    const kelce = kelceOf(res.body);
    assertAmerican(kelce.anytime.kalshi, 'kalshi');
    assertAmerican(kelce.anytime.polymarket, 'polymarket');
    assert.equal(kelce.anytime.underdog_predict, null);
    assert.ok(elapsed < 2000, elapsed);
    assert.ok(elapsed + 40 >= 350, `slow underdog returned too early (${elapsed}ms)`);
  }

  // One book HTTP-fails. The prices that arrived stay, and the miss is visible.
  {
    const calls = [];
    const deps = boardDeps(calls, { underdogStatus: 500 }, { deadlineMs: 1500, fetchTimeoutMs: 400 });
    const { res, elapsed } = await callHandler(deps);
    note('underdog-500-partial', elapsed, { sources: res.body.sources, calls: calls.length });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.partial, true);
    assert.equal(res.body.sources.underdog, 'error');
    assert.equal(res.body.sources.kalshi, 'ok');
    assert.equal(res.body.sources.polymarket, 'ok');
    const kelce = kelceOf(res.body);
    assertAmerican(kelce.anytime.kalshi, 'kalshi');
    assertAmerican(kelce.anytime.polymarket, 'polymarket');
    assert.equal(kelce.anytime.underdog_predict, null);
    assert.equal(calls.filter((url) => url.includes('novig.com')).length, 0);
    assert.ok(calls.filter((url) => url.includes('underdogfantasy')).length >= 1);
  }

  // Expired in-process board is kept, labeled stale, when the refresh cannot finish.
  {
    const calls = [];
    const fetchedAt = '2026-09-26T11:59:00.000Z';
    const cache = {
      at: NOW - 60_000,
      body: {
        ok: true,
        league: 'NFL',
        fetchedAt,
        partial: false,
        stale: false,
        games: [{
          gameKey: 'KC|MIA|2026-09-27',
          away: 'Kansas City Chiefs',
          home: 'Miami Dolphins',
          awayAbbr: 'KC',
          homeAbbr: 'MIA',
          commence: '2026-09-27T17:00:00.000Z',
          players: [{
            name: 'Travis Kelce',
            anytime: { kalshi: -155, polymarket: -150, underdog_predict: null, best: -150, bestBook: 'polymarket' },
          }],
        }],
        sources: {
          kalshi: { status: 'ok' },
          underdog: { status: 'ok' },
          polymarket: { status: 'ok' },
          novig: { status: 'skipped' },
        },
      },
    };
    const deps = boardDeps(calls, { hangAll: true }, {
      cache,
      cacheMs: 45_000,
      deadlineMs: 250,
      fetchTimeoutMs: 80,
    });
    const { res, elapsed } = await callHandler(deps);
    note('stale-cache-on-timeout', elapsed, { status: res.statusCode, sources: res.body.sources });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.stale, true);
    assert.equal(res.body.cached, true);
    assert.equal(res.body.partial, true);
    assert.equal(res.body.fetchedAt, fetchedAt);
    assert.equal(res.body.sources.kalshi, 'timeout');
    const kelce = kelceOf(res.body);
    assert.equal(kelce.anytime.kalshi, -155);
    assertAmerican(kelce.anytime.kalshi, 'stale kalshi');
    assert.equal(cache.at, NOW - 60_000);
    assert.equal(cache.body.games[0].players[0].anytime.kalshi, -155);
    assert.ok(elapsed < 2000, elapsed);
  }

  // A fresh cache does not touch upstreams.
  {
    const calls = [];
    const cache = {
      at: NOW - 1000,
      body: {
        ok: true,
        league: 'NFL',
        fetchedAt: '2026-09-26T11:59:59.000Z',
        partial: false,
        games: [{ gameKey: 'g', players: [{ name: 'Travis Kelce', anytime: { kalshi: -155 } }] }],
        sources: { kalshi: { status: 'ok' }, underdog: { status: 'empty' }, polymarket: { status: 'empty' }, novig: { status: 'skipped' } },
      },
    };
    const deps = boardDeps(calls, {}, { cache, fetchFn: async () => { throw new Error('cache hit must not fetch'); } });
    const { res, elapsed } = await callHandler(deps);
    note('fresh-cache', elapsed, { calls: calls.length });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.cached, true);
    assert.equal(res.body.stale, false);
    assert.equal(res.body.partial, false);
    assert.equal(calls.length, 0);
    assert.equal(kelceOf(res.body).anytime.kalshi, -155);
  }

  // Partial results are cached briefly, then the next poll tries again.
  {
    const calls = [];
    const cache = { at: 0, body: null };
    const firstDeps = boardDeps(calls, { underdogStatus: 500 }, {
      cache,
      deadlineMs: 1500,
      fetchTimeoutMs: 400,
    });
    const first = await callHandler(firstDeps);
    assert.equal(first.res.body.partial, true);
    const afterFirst = calls.length;
    const second = await callHandler({ ...firstDeps, now: NOW + 1000 });
    assert.equal(second.res.body.cached, true);
    assert.equal(second.res.body.partial, true);
    assert.equal(calls.length, afterFirst, 'partial cache should suppress an immediate refetch');
    const third = await callHandler({ ...firstDeps, now: NOW + 15_000 });
    assert.ok(calls.length > afterFirst, 'partial cache expires before the full poll interval');
    assert.equal(third.res.body.partial, true);
    note('partial-cache-ttl', third.elapsed, { refetchCalls: calls.length - afterFirst });
  }

  // The promo cron still walks Novig. The board deadline must not leak into it.
  {
    const calls = [];
    await loadExchangeTdQuotes({
      fetchFn: async (url) => {
        calls.push(String(url));
        return httpResult(200, { markets: [], cursor: '', items: [], over_under_lines: {} });
      },
      sleepFn: async () => {},
      now: NOW,
      attempts: 1,
    });
    assert.ok(calls.some((url) => url.includes('novig.com')), 'cron quote load still requests Novig');
    assert.ok(calls.some((url) => url.includes('api.elections.kalshi.com')));
  }

  // Direct loader: default deadline constant is what a cold call uses.
  {
    const calls = [];
    const started = Date.now();
    const board = await loadPlayerTdBoard({
      fetchFn: routeFactory(calls, { hangAll: true }),
      cache: { at: 0, body: null },
      cacheMs: 0,
      now: NOW,
      sleepFn: async () => {},
      fetchTimeoutMs: 100,
      deadlineMs: BOARD_DEADLINE_MS,
    });
    const elapsed = Date.now() - started;
    note('default-deadline-constant', elapsed, { ok: board.ok });
    assert.equal(board.ok, false);
    assert.ok(elapsed < BOARD_DEADLINE_MS + BOARD_DEADLINE_GRACE_MS + 500, elapsed);
    assert.ok(elapsed + 100 >= BOARD_DEADLINE_MS, `default deadline returned early (${elapsed}ms)`);
  }

  // A real accepted socket that never writes is aborted by the deadline.
  {
    const blackhole = http.createServer(() => {});
    await new Promise((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
    const port = blackhole.address().port;
    const calls = [];
    try {
      const started = Date.now();
      const { res, elapsed } = await callHandler(boardDeps(calls, {}, {
        deadlineMs: 400,
        fetchTimeoutMs: 200,
        fetchFn: (url, init) => {
          calls.push(String(url));
          return fetch(`http://127.0.0.1:${port}/hang`, { signal: init && init.signal });
        },
      }));
      note('real-socket-hang', elapsed, { status: res.statusCode, calls: calls.length });
      assert.equal(res.statusCode, 502);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.sources.kalshi, 'timeout');
      assert.equal(res.body.sources.novig, 'skipped');
      assert.ok(elapsed < 2000, `real socket held the handler for ${elapsed}ms`);
      assert.equal(calls.filter((url) => url.includes('series_ticker=KXNFLTD')).length <= 4, true);
    } finally {
      await new Promise((resolve, reject) => blackhole.close((err) => (err ? reject(err) : resolve())));
    }
  }

  // Full HTTP: three concurrent cold requests against a hung upstream.
  {
    const calls = [];
    const deps = boardDeps(calls, { hangAll: true, honorAbort: true }, { deadlineMs: 300, fetchTimeoutMs: 80 });
    const server = await listen(deps);
    try {
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}/api/player-td-board`;
      const started = Date.now();
      const responses = await Promise.all([fetch(url), fetch(url), fetch(url)]);
      const elapsed = Date.now() - started;
      const bodies = await Promise.all(responses.map((res) => res.json()));
      note('http-concurrent-cold', elapsed, {
        statuses: responses.map((res) => res.status),
        calls: calls.length,
      });
      assert.deepEqual(responses.map((res) => res.status), [502, 502, 502]);
      for (const body of bodies) {
        assert.equal(body.ok, false);
        assert.equal(body.error, 'player_td_unavailable');
        assert.equal(body.sources.novig, 'skipped');
        assert.equal(body.games.length, 0);
      }
      const kalshiCalls = calls.filter((url) => url.includes('series_ticker=KXNFLTD')).length;
      const dogCalls = calls.filter((url) => url.includes('underdogfantasy')).length;
      assert.ok(kalshiCalls >= 1 && kalshiCalls <= 4, `kalshi fan-out ${kalshiCalls}`);
      assert.ok(dogCalls >= 1 && dogCalls <= 3, `underdog fan-out ${dogCalls}`);
      assert.ok(elapsed < 2000, elapsed);
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }

  // Full HTTP: healthy upstream, American odds, partial flag off.
  {
    const calls = [];
    const deps = boardDeps(calls, { delayMs: 20 }, { deadlineMs: 1500, fetchTimeoutMs: 1000 });
    const server = await listen(deps);
    try {
      const port = server.address().port;
      const started = Date.now();
      const res = await fetch(`http://127.0.0.1:${port}/api/player-td-board`);
      const elapsed = Date.now() - started;
      const body = await res.json();
      note('http-complete', elapsed, { status: res.status });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const kelce = kelceOf(body);
      assertAmerican(kelce.anytime.kalshi, 'http kalshi');
      assertAmerican(kelce.anytime.polymarket, 'http polymarket');
      assert.equal(body.partial, false);
      assert.equal(body.sources.novig, 'skipped');
      assert.ok(elapsed < 1500, elapsed);
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }

  console.log(`TIMINGS ${JSON.stringify(timings)}`);
  console.log('player-td-board-budget.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
