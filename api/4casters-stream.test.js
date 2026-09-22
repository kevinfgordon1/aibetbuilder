'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const handler = require('./4casters-stream');
const {
  FOURCASTERS_BOOK_ID,
  DEFAULT_WS,
  resetFourcastersAuthCache,
  fetchFourcastersToken,
  bestAsk,
  parsePriceMessage,
  quotesFromCatalog,
  applyPriceMessage,
  catalogFromGames,
  priceSubscribeMessage,
  startFourcasters,
} = require('../lib/fourcasters-live');

const NOW = Date.parse('2026-09-22T18:00:00Z');
const SECRET = 'four-secret-not-real';
const AWAY = '607349dc22a237cf46b021fb';
const HOME = '60747bcde3b0844e56d2e7e8';
const GAME = '625ecb5f269b7ff13619ca7c';

function nflGame() {
  return {
    id: GAME,
    league: 'NFL',
    sport: 'football',
    start: '2026-09-25T00:15:00Z',
    ended: false,
    live: false,
    parentGameID: null,
    periodName: 'Full Time',
    isSpecials: false,
    participants: [
      { id: AWAY, longName: 'Atlanta Falcons', shortName: 'ATL', homeAway: 'away' },
      { id: HOME, longName: 'Green Bay Packers', shortName: 'GB', homeAway: 'home' },
    ],
    awayMoneylines: [
      { id: 'o1', type: 'moneyline', sumUntaken: 100, odds: 150, participantID: AWAY },
      { id: 'o1b', type: 'moneyline', sumUntaken: 10, odds: 150, participantID: AWAY },
      { id: 'o2', type: 'moneyline', sumUntaken: 40, odds: 140, participantID: AWAY },
      { id: 'o3', type: 'moneyline', sumUntaken: 0, odds: 200, participantID: AWAY },
      { id: 'o4', type: 'moneyline', sumUntaken: 80, odds: 500, participantID: AWAY, mockOrder: true },
    ],
    homeMoneylines: [
      { id: 'o5', type: 'moneyline', sumUntaken: 80, odds: -170, participantID: HOME },
    ],
    awaySpreads: [
      { id: 's1', type: 'spread', sumUntaken: 50, odds: -110, participantID: AWAY, spread: 3.5 },
      { id: 's2', type: 'spread', sumUntaken: 50, odds: -105, participantID: AWAY, spread: 7.5 },
    ],
    homeSpreads: [
      { id: 's3', type: 'spread', sumUntaken: 50, odds: -110, participantID: HOME, spread: -3.5 },
      { id: 's4', type: 'spread', sumUntaken: 40, odds: -115, participantID: HOME, spread: -7.5 },
    ],
    over: [
      { id: 't1', type: 'total', sumUntaken: 70, odds: -105, total: 47.5, OU: 'over' },
      { id: 't2', type: 'total', sumUntaken: 20, odds: 120, total: 51.5, OU: 'over' },
    ],
    under: [
      { id: 't3', type: 'total', sumUntaken: 60, odds: -115, total: 47.5, OU: 'under' },
    ],
    mainHomeSpread: -3.5,
    mainAwaySpread: 3.5,
    mainTotal: 47.5,
  };
}

function childGame() {
  return {
    id: 'child-1h',
    parentGameID: GAME,
    league: 'NFL',
    start: '2026-09-25T00:15:00Z',
    ended: false,
    periodName: '1H',
    participants: [
      { id: AWAY, longName: 'Atlanta Falcons', shortName: 'ATL', homeAway: 'away' },
      { id: HOME, longName: 'Green Bay Packers', shortName: 'GB', homeAway: 'home' },
    ],
    awayMoneylines: [
      { id: 'c1', type: 'moneyline', sumUntaken: 20, odds: 300, participantID: AWAY },
    ],
    homeMoneylines: [],
    mainTotal: 24.5,
  };
}

function sseRes() {
  const chunks = [];
  return {
    chunks,
    statusCode: 200,
    setHeader() {},
    flushHeaders() {},
    write(chunk) { chunks.push(String(chunk)); },
    end() { this.ended = true; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; },
  };
}

class FakeWS {
  constructor(url, opts) {
    this.url = url;
    this.opts = opts || {};
    this.sent = [];
    this.pings = 0;
    this.listeners = {};
    FakeWS.last = this;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  send(data) { this.sent.push(String(data)); }
  ping() { this.pings += 1; }
  close() {
    this.closed = true;
    this.emit('close', {});
  }
  emit(type, ev) {
    for (const fn of this.listeners[type] || []) fn(ev);
  }
}

function creds(extra) {
  return {
    username: 'four-user',
    password: SECRET,
    token: '',
    apiBase: 'https://api.4casters.io',
    wsUrl: DEFAULT_WS,
    ...extra,
  };
}

function loginOk(token) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: { user: { auth: token, username: 'four-user' } } }),
  };
}

(async () => {
  resetFourcastersAuthCache();
  assert.equal(FOURCASTERS_BOOK_ID, 197);
  assert.equal(DEFAULT_WS, 'wss://streaming-api.4casters.io/price-stream');
  assert.deepEqual(priceSubscribeMessage('nfl'), {
    type: 'subscribe',
    gameIDs: [],
    leagueIDs: ['NFL'],
    sportIDs: [],
    replace: true,
  });
  assert.deepEqual(priceSubscribeMessage('NCAAF').leagueIDs, ['NCAAF']);
  assert.deepEqual(priceSubscribeMessage('MLB').leagueIDs, ['MLB']);

  assert.deepEqual(bestAsk([
    { odds: -110, sumUntaken: 100 },
    { odds: 200, sumUntaken: 5 },
    { odds: 400, sumUntaken: 0 },
    { odds: 900, sumUntaken: 10, mockOrder: true },
  ]), { odds: 200, size: 5 });
  assert.deepEqual(bestAsk([
    { odds: 150, sumUntaken: 100 },
    { odds: 150, sumUntaken: 10 },
    { odds: 140, sumUntaken: 40 },
  ]), { odds: 150, size: 110 });

  const parsed = parsePriceMessage(JSON.stringify([
    'orderUpdate',
    { type: 'moneyline', gameID: GAME, participantID: AWAY, sideOrders: [] },
  ]));
  assert.equal(parsed.type, 'orderUpdate');
  assert.equal(parsed.payload.gameID, GAME);
  assert.equal(parsePriceMessage('not-json'), null);
  assert.equal(parsePriceMessage(JSON.stringify({ type: 'subscribe' })), null);

  {
    const catalog = catalogFromGames([nflGame(), childGame()], 'NFL', NOW);
    const quotes = quotesFromCatalog(catalog, NOW);
    const mlAway = quotes.find((q) => q.token_id === `fc:${GAME}:ml:away`);
    const mlHome = quotes.find((q) => q.token_id === `fc:${GAME}:ml:home`);
    const sprAway = quotes.find((q) => q.token_id === `fc:${GAME}:spr:away`);
    const sprHome = quotes.find((q) => q.token_id === `fc:${GAME}:spr:home`);
    const over = quotes.find((q) => q.token_id === `fc:${GAME}:tot:over`);
    const under = quotes.find((q) => q.token_id === `fc:${GAME}:tot:under`);
    assert.equal(mlAway.odds, 150);
    assert.equal(mlAway.size, 110);
    assert.equal(mlAway.side, 'Atlanta Falcons');
    assert.equal(mlAway.book, 'fourcasters');
    assert.equal(mlHome.odds, -170);
    assert.equal(sprAway.odds, -110);
    assert.equal(sprAway.line, 3.5);
    assert.equal(sprHome.line, -3.5);
    assert.equal(over.odds, -105);
    assert.equal(over.line, 47.5);
    assert.equal(under.odds, -115);
    assert.equal(quotes.some((q) => q.odds === 300 || q.line === 7.5 || q.line === 51.5), false);
    applyPriceMessage(catalog, {
      type: 'orderUpdate',
      payload: {
        gameID: GAME,
        league: 'NFL',
        type: 'moneyline',
        participantID: AWAY,
        sideOrders: [{ id: 'live', type: 'moneyline', sumUntaken: 25, odds: 160, participantID: AWAY }],
      },
    });
    const next = quotesFromCatalog(catalog, NOW);
    assert.equal(next.find((q) => q.token_id === `fc:${GAME}:ml:away`).odds, 160);
    assert.equal(next.find((q) => q.token_id === `fc:${GAME}:ml:home`).odds, -170);
    applyPriceMessage(catalog, {
      type: 'orderUpdate',
      payload: {
        gameID: GAME,
        league: 'NFL',
        type: 'moneyline1x2',
        market: 'draw',
        side: 'yes',
        sideOrders: [{ id: 'draw', odds: 220, sumUntaken: 40, market: 'draw', side: 'yes' }],
      },
    });
    assert.equal(quotesFromCatalog(catalog, NOW).find((q) => q.token_id === `fc:${GAME}:ml:away`).odds, 160);
    applyPriceMessage(catalog, {
      type: 'matchedVolumeUpdate',
      payload: { gameID: GAME, matchedVolume: 10 },
    });
    applyPriceMessage(catalog, {
      type: 'gameUpdate',
      payload: {
        id: 'game-nested',
        league: 'NFL',
        start: '2026-09-26T17:00:00Z',
        ended: false,
        live: false,
        periodName: 'Full Time',
        participants: [
          { id: 'away-2', longName: 'Dallas Cowboys', shortName: 'DAL', homeAway: 'away' },
          { id: 'home-2', longName: 'New York Giants', shortName: 'NYG', homeAway: 'home' },
        ],
        awayMoneylines: [],
        homeMoneylines: [{ odds: -120, sumUntaken: 10, participantID: 'home-2' }],
        awaySpreads: { '2.5': [{ odds: -108, sumUntaken: 15, participantID: 'away-2' }] },
        homeSpreads: { '-2.5': [{ odds: -112, sumUntaken: 15 }] },
        over: { '44.5': [{ odds: -102, sumUntaken: 12 }] },
        under: { '44.5': [{ odds: -118, sumUntaken: 12 }] },
        mainAwaySpread: 2.5,
        mainHomeSpread: -2.5,
        mainTotal: 44.5,
        messageType: 'marketOpen',
      },
    });
    const nested = quotesFromCatalog(catalog, NOW).filter((q) => q.away === 'Dallas Cowboys');
    assert.equal(nested.find((q) => q.bet_type === 'moneyline' && q.side === 'Dallas Cowboys'), undefined);
    assert.equal(nested.find((q) => q.side === 'New York Giants' && q.bet_type === 'moneyline').odds, -120);
    assert.equal(nested.find((q) => q.bet_type === 'spread' && q.side === 'Dallas Cowboys').line, 2.5);
    assert.equal(nested.find((q) => q.bet_type === 'total' && q.side === 'Under').odds, -118);
  }

  {
    resetFourcastersAuthCache();
    let calls = 0;
    let clock = NOW;
    const deps = creds({
      token: '',
      tokenTtlMs: 1000,
      nowMs: () => clock,
      fetchFn: async (url) => {
        assert.match(String(url), /\/user\/login$/);
        calls += 1;
        return loginOk('cached-token');
      },
    });
    assert.equal(await fetchFourcastersToken(deps), 'cached-token');
    clock += 500;
    assert.equal(await fetchFourcastersToken(deps), 'cached-token');
    assert.equal(calls, 1, 'token is cached inside the expiry window');
    clock += 2000;
    assert.equal(await fetchFourcastersToken(deps), 'cached-token');
    assert.equal(calls, 2, 'expired token logs in again');
  }

  {
    resetFourcastersAuthCache();
    let called = false;
    const token = await fetchFourcastersToken(creds({
      username: '',
      password: '',
      token: 'Bearer override-token',
      fetchFn: async () => { called = true; throw new Error('login should not run'); },
    }));
    assert.equal(token, 'override-token');
    assert.equal(called, false);
  }

  {
    resetFourcastersAuthCache();
    const fetchFn = async () => ({ ok: false, status: 401, text: async () => '' });
    assert.equal(await fetchFourcastersToken(creds({ fetchFn, nowMs: NOW })), null);
  }

  {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/4casters-stream?league=NFL';
    const res = sseRes();
    let fetched = false;
    const pending = handler(req, res, creds({
      hubs: new Map(),
      username: '',
      password: '',
      token: '',
      fetchFn: async () => { fetched = true; throw new Error('should not fetch'); },
      WebSocket: FakeWS,
    }));
    for (let i = 0; i < 40 && !res.chunks.length; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(fetched, false);
    assert.match(res.chunks[0], /"source":"fourcasters"/);
    assert.match(res.chunks[0], /"mode":"needs-credentials"/);
    assert.match(res.chunks[0], /"note":"fourcasters_needs_credentials"/);
    assert.match(res.chunks[0], /"quotes":\[\]/);
    assert.doesNotMatch(res.chunks.join(''), /four-secret/);
    req.emit('close');
    await pending;
  }

  {
    resetFourcastersAuthCache();
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/4casters-stream?league=NFL';
    const res = sseRes();
    let ws = null;
    let logins = 0;
    const pending = handler(req, res, creds({
      hubs: new Map(),
      nowMs: NOW,
      refreshMs: 0,
      retryMs: 60_000,
      pingMs: 20,
      pongStaleMs: 60_000,
      WebSocket: FakeWS,
      onSocket(socket) { ws = socket; },
      fetchFn: async (url, init) => {
        const u = String(url);
        assert.doesNotMatch(u, /four-secret/);
        if (u.endsWith('/user/login')) {
          const body = JSON.parse(init.body);
          assert.equal(body.username, 'four-user');
          assert.equal(body.password, SECRET);
          logins += 1;
          return loginOk('fc-token');
        }
        if (u.includes('/exchange/v2/getOrderbook')) {
          assert.match(u, /league=NFL/);
          assert.match(init.headers.authorization, /^Bearer fc-token$/);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ data: { games: [nflGame(), childGame()] } }),
          };
        }
        throw new Error(`unexpected ${u}`);
      },
    }));
    for (let i = 0; i < 50 && !ws; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(ws, '4casters hub opens the price stream');
    assert.equal(ws.url, DEFAULT_WS);
    assert.equal(ws.opts.headers.Authorization, 'fc-token');
    assert.equal(logins, 1);
    assert.ok(res.chunks.some((c) => c.includes('"odds":150') && c.includes('"source":"fourcasters"') && c.includes('"mode":"ws"')));
    assert.ok(res.chunks.some((c) => c.includes('"odds":-170')));
    assert.ok(res.chunks.some((c) => c.includes('"bet_type":"spread"') && c.includes('"line":3.5')));
    assert.ok(res.chunks.some((c) => c.includes('"bet_type":"total"') && c.includes('"line":47.5')));
    assert.ok(!res.chunks.some((c) => c.includes('"line":7.5') || c.includes('"odds":300') || c.includes('"line":51.5')));
    ws.emit('open', {});
    assert.deepEqual(ws.sent.map((s) => JSON.parse(s)), [priceSubscribeMessage('NFL')]);
    for (let i = 0; i < 20 && ws.pings < 1; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(ws.pings >= 1, 'price stream pings on an interval');
    const before = res.chunks.length;
    ws.emit('message', {
      data: JSON.stringify([
        'orderUpdate',
        {
          gameID: GAME,
          league: 'NFL',
          type: 'total',
          OU: 'under',
          total: 8.5,
          mainTotal: 47.5,
          sideOrders: [{ id: 'alt', type: 'total', sumUntaken: 255, odds: 104, OU: 'under', total: 8.5 }],
        },
      ]),
    });
    assert.equal(res.chunks.length, before, 'an alt total is not a board tick');
    ws.emit('message', {
      data: JSON.stringify([
        'orderUpdate',
        {
          gameID: GAME,
          league: 'NFL',
          live: false,
          type: 'moneyline',
          participantID: AWAY,
          sideOrders: [{ id: 'live', type: 'moneyline', sumUntaken: 25, odds: 160, participantID: AWAY }],
        },
      ]),
    });
    assert.ok(res.chunks.length > before);
    assert.ok(res.chunks.some((c) => c.includes('"odds":160') && c.includes(`"token_id":"fc:${GAME}:ml:away"`)));
    const same = res.chunks.length;
    ws.emit('message', { data: JSON.stringify({ type: 'subscribed' }) });
    assert.equal(res.chunks.length, same, 'non-tuple frames are not ticks');
    req.emit('close');
    await pending;
    assert.equal(ws.closed, true);
  }

  {
    resetFourcastersAuthCache();
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/4casters-stream?league=NCAAF';
    const res = sseRes();
    let opened = false;
    let books = 0;
    const pending = handler(req, res, creds({
      hubs: new Map(),
      nowMs: NOW,
      refreshMs: 0,
      retryMs: 60_000,
      WebSocket: class extends FakeWS {
        constructor(url, opts) { super(url, opts); opened = true; }
      },
      fetchFn: async (url, init) => {
        const u = String(url);
        if (u.endsWith('/user/login')) {
          const body = JSON.parse(init.body);
          return loginOk(body.username === 'four-user' && books === 0 ? 'stale-token' : 'fresh-token');
        }
        if (u.includes('/exchange/v2/getOrderbook')) {
          books += 1;
          assert.match(u, /league=NCAAF/);
          if (books === 1) {
            assert.match(init.headers.authorization, /^Bearer stale-token$/);
            return { ok: false, status: 401, text: async () => '{"error":{"message":"InvalidCredentials"}}' };
          }
          assert.match(init.headers.authorization, /^Bearer fresh-token$/);
          return { ok: true, status: 200, text: async () => JSON.stringify({ data: { games: [] } }) };
        }
        throw new Error(`unexpected ${u}`);
      },
    }));
    for (let i = 0; i < 40 && !opened; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(books, 2, 'a 401 logs in again before the book is read');
    assert.equal(opened, true);
    assert.match(res.chunks[0], /"source":"fourcasters"/);
    assert.match(res.chunks[0], /"quotes":\[\]/);
    req.emit('close');
    await pending;
  }

  {
    resetFourcastersAuthCache();
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/4casters-stream?league=MLB';
    const res = sseRes();
    let opened = false;
    const pending = handler(req, res, creds({
      hubs: new Map(),
      username: '',
      password: '',
      token: 'mlb-token',
      nowMs: NOW,
      refreshMs: 0,
      retryMs: 60_000,
      WebSocket: class extends FakeWS {
        constructor(url, opts) { super(url, opts); opened = true; }
      },
      fetchFn: async (url, init) => {
        const u = String(url);
        assert.doesNotMatch(u, /\/user\/login/);
        assert.match(u, /league=MLB/);
        assert.equal(init.headers.authorization, 'Bearer mlb-token');
        return { ok: true, status: 200, text: async () => '{"data":{"games":[]}}' };
      },
    }));
    for (let i = 0; i < 40 && !opened; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(opened, true);
    assert.equal(FakeWS.last.opts.headers.Authorization, 'mlb-token');
    req.emit('close');
    await pending;
  }

  {
    resetFourcastersAuthCache();
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/4casters-stream?league=NFL';
    const res = sseRes();
    let opened = false;
    const pending = handler(req, res, creds({
      hubs: new Map(),
      nowMs: NOW,
      refreshMs: 0,
      retryMs: 60_000,
      WebSocket: class extends FakeWS {
        constructor(url, opts) { super(url, opts); opened = true; }
      },
      fetchFn: async (url) => {
        if (String(url).endsWith('/user/login')) {
          return { ok: false, status: 401, text: async () => '{"error":"unauthorized"}' };
        }
        throw new Error('book fetch without a token');
      },
    }));
    for (let i = 0; i < 40 && !res.chunks.length; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(opened, false);
    assert.match(res.chunks[0], /"note":"fourcasters_unauthorized"/);
    assert.match(res.chunks[0], /"quotes":\[\]/);
    assert.doesNotMatch(res.chunks.join(''), new RegExp(SECRET));
    req.emit('close');
    await pending;
  }

  {
    const res = sseRes();
    await handler({ method: 'POST', url: '/api/4casters-stream' }, res, { hubs: new Map(), username: '', password: '', token: '' });
    assert.equal(res.statusCode, 405);
  }

  {
    const res = sseRes();
    await handler({ method: 'GET', url: '/api/4casters-stream?league=NBA' }, res, { hubs: new Map(), username: '', password: '', token: '' });
    assert.equal(res.statusCode, 400);
  }

  {
    const env = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
    const vercel = fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8');
    const vite = fs.readFileSync(path.join(__dirname, '../vite.config.js'), 'utf8');
    assert.match(env, /FOURCASTERS_USERNAME=/);
    assert.match(env, /FOURCASTERS_PASSWORD=/);
    assert.match(env, /FOURCASTERS_TOKEN=/);
    assert.match(env, /FOURCASTERS_API_BASE=https:\/\/api\.4casters\.io/);
    assert.match(env, /wss:\/\/streaming-api\.4casters\.io\/price-stream/);
    assert.doesNotMatch(env, /FOURCASTERS_PASSWORD=\S/);
    assert.doesNotMatch(env, /FOURCASTERS_TOKEN=\S/);
    assert.doesNotMatch(env, /FOURCASTERS_USERNAME=\S/);
    assert.doesNotMatch(env, /VITE_FOURCASTERS/);
    assert.match(vercel, /api\/4casters-stream\.js/);
    assert.match(vite, /\/api\/4casters-stream/);
    const src = fs.readFileSync(path.join(__dirname, '../lib/fourcasters-live.js'), 'utf8');
    assert.doesNotMatch(src, /four-secret|password\s*[:=]\s*['"][^'"]+['"]/);
    assert.match(src, /Authorization: rawToken\(token\)/);
    assert.match(src, /Bearer \$\{rawToken\(auth\)\}/);
  }

  assert.equal(typeof startFourcasters, 'function');
  console.log('4casters-stream.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
