'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const handler = require('./novig-stream');
const {
  NOVIG_BOOK_ID,
  novigWsUrl,
  resetNovigAuthCache,
  fetchNovigToken,
  catalogFromMarkets,
  quotesFromCatalog,
  applyNovigMessage,
  startNovig,
} = require('../lib/novig-live');

const NOW = Date.parse('2026-09-22T18:00:00Z');
const SECRET = 'super-secret-not-real';

function gameEvent(status = 'OPEN_PREGAME') {
  return {
    id: 'ev-1',
    status,
    type: 'Game',
    game: {
      league: 'NFL',
      status: status === 'OPEN_INGAME' ? 'IN_PROGRESS' : 'SCHEDULED',
      scheduledStart: '2026-09-25T00:15:00Z',
      awayTeam: { name: 'Atlanta Falcons', symbol: 'ATL' },
      homeTeam: { name: 'Green Bay Packers', symbol: 'GB' },
    },
  };
}

function moneyMarket() {
  return {
    id: 'm-ml',
    type: 'MONEY',
    league: 'NFL',
    status: 'OPEN',
    eventId: 'ev-1',
    event: gameEvent(),
    outcomes: [
      { id: 'oc-home', index: 0, description: 'Green Bay Packers', competitor: { name: 'Green Bay Packers' } },
      { id: 'oc-away', index: 1, description: 'Atlanta Falcons', competitor: { name: 'Atlanta Falcons' } },
    ],
    book: {
      outcomeLadders: [
        { outcomeId: 'oc-home', bids: [{ id: 'bid-home', price: 0.715, qty: 100, currency: 'CASH' }, { id: 'bid-coin', price: 0.9, qty: 500, currency: 'COIN' }] },
        { outcomeId: 'oc-away', bids: [{ id: 'bid-away', price: 0.28, qty: 50, currency: 'CASH' }] },
      ],
    },
  };
}

function spreadMarket({ id, strike, consensus, homeBid, awayBid }) {
  return {
    id,
    type: 'SPREAD',
    league: 'NFL',
    status: 'OPEN',
    strike,
    isConsensus: consensus,
    eventId: 'ev-1',
    event: gameEvent(),
    outcomes: [
      { id: `${id}-home`, index: 0, description: `Packers ${strike}`, competitor: { name: 'Green Bay Packers' } },
      { id: `${id}-away`, index: 1, description: `Falcons ${-strike}`, competitor: { name: 'Atlanta Falcons' } },
    ],
    book: {
      outcomeLadders: [
        { outcomeId: `${id}-home`, bids: [{ id: `${id}-bh`, price: homeBid, qty: 40, currency: 'CASH' }] },
        { outcomeId: `${id}-away`, bids: [{ id: `${id}-ba`, price: awayBid, qty: 40, currency: 'CASH' }] },
      ],
    },
  };
}

function totalMarket() {
  return {
    id: 'm-tot',
    type: 'TOTAL',
    league: 'NFL',
    status: 'OPEN',
    strike: 47.5,
    isConsensus: true,
    eventId: 'ev-1',
    event: gameEvent(),
    outcomes: [
      { id: 'oc-over', index: 0, description: 'Over 47.5' },
      { id: 'oc-under', index: 1, description: 'Under 47.5' },
    ],
    book: {
      outcomeLadders: [
        { outcomeId: 'oc-over', bids: [{ id: 'bid-over', price: 0.51, qty: 80, currency: 'CASH' }] },
        { outcomeId: 'oc-under', bids: [{ id: 'bid-under', price: 0.48, qty: 70, currency: 'CASH' }] },
      ],
    },
  };
}

function propMarket() {
  return {
    id: 'm-prop',
    type: 'PASSING_YARDS',
    league: 'NFL',
    playerId: 'player-1',
    status: 'OPEN',
    strike: 275.5,
    eventId: 'ev-1',
    event: gameEvent(),
    outcomes: [
      { id: 'prop-over', index: 0, description: 'Over 275.5' },
      { id: 'prop-under', index: 1, description: 'Under 275.5' },
    ],
    book: {
      outcomeLadders: [
        { outcomeId: 'prop-over', bids: [{ id: 'p1', price: 0.5, qty: 10, currency: 'CASH' }] },
        { outcomeId: 'prop-under', bids: [{ id: 'p2', price: 0.5, qty: 10, currency: 'CASH' }] },
      ],
    },
  };
}

function bookMarkets() {
  return [
    moneyMarket(),
    spreadMarket({ id: 'm-spr-main', strike: -3.5, consensus: true, homeBid: 0.52, awayBid: 0.46 }),
    spreadMarket({ id: 'm-spr-alt', strike: -7.5, consensus: false, homeBid: 0.5, awayBid: 0.5 }),
    totalMarket(),
    propMarket(),
  ];
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
    this.listeners = {};
    FakeWS.last = this;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  send(data) { this.sent.push(String(data)); }
  close() {
    this.closed = true;
    this.emit('close', {});
  }
  emit(type, ev) {
    for (const fn of this.listeners[type] || []) fn(ev);
  }
}

function creds(extra) {
  return { clientId: 'novig-client', clientSecret: SECRET, apiBase: 'https://api.novig.us', ...extra };
}

(async () => {
  resetNovigAuthCache();
  assert.equal(NOVIG_BOOK_ID, 195);
  assert.equal(novigWsUrl('https://api.novig.us'), 'wss://api.novig.us/tape');
  assert.equal(novigWsUrl('https://api-qa.novig.us/'), 'wss://api-qa.novig.us/tape');

  {
    const catalog = catalogFromMarkets(bookMarkets(), 'NFL', NOW);
    const quotes = quotesFromCatalog(catalog);
    const mlAway = quotes.find((q) => q.bet_type === 'moneyline' && q.side === 'Atlanta Falcons');
    const mlHome = quotes.find((q) => q.bet_type === 'moneyline' && q.side === 'Green Bay Packers');
    assert.equal(mlAway.odds, 0.285, 'ask is 1 - best opposite CASH bid');
    assert.equal(mlAway.book_id, 195);
    assert.equal(mlAway.size, 100);
    assert.equal(mlHome.odds, 0.72);
    assert.equal(quotes.some((q) => q.token_id === 'prop-over'), false, 'player props stay off the board');
    const spreads = quotes.filter((q) => q.bet_type === 'spread');
    assert.equal(spreads.length, 2);
    assert.ok(spreads.every((q) => q.market_id === 'm-spr-main'), 'consensus spread is the main line');
    const awaySpr = spreads.find((q) => q.side === 'Atlanta Falcons');
    assert.equal(awaySpr.line, 3.5);
    const homeSpr = spreads.find((q) => q.side === 'Green Bay Packers');
    assert.equal(homeSpr.line, -3.5);
    const over = quotes.find((q) => q.bet_type === 'total' && q.side === 'Over');
    const under = quotes.find((q) => q.bet_type === 'total' && q.side === 'Under');
    assert.equal(over.odds, 0.52);
    assert.equal(under.odds, 0.49);
    assert.equal(over.line, 47.5);
    assert.equal(under.line, 47.5);

    const oneSided = catalogFromMarkets([{
      ...moneyMarket(),
      book: { outcomeLadders: [{ outcomeId: 'oc-away', bids: [{ id: 'only', price: 0.4, qty: 10, currency: 'CASH' }] }] },
    }], 'NFL', NOW);
    const oneQuotes = quotesFromCatalog(oneSided);
    assert.equal(oneQuotes.find((q) => q.side === 'Atlanta Falcons'), undefined, 'same-side bid is not an ask');
    assert.equal(oneQuotes.find((q) => q.side === 'Green Bay Packers').odds, 0.6);

    applyNovigMessage(catalog, {
      type: 'PLACE',
      order: { id: 'bid-new', price: 0.75, qty: 20, currency: 'CASH', marketId: 'm-ml', outcomeId: 'oc-home', status: 'OPEN' },
      market: { id: 'm-ml' },
    });
    const lifted = quotesFromCatalog(catalog).find((q) => q.token_id === 'oc-away');
    assert.equal(lifted.odds, 0.25);
    applyNovigMessage(catalog, {
      type: 'CANCEL',
      order: { id: 'bid-new', marketId: 'm-ml', outcomeId: 'oc-home' },
    });
    const restored = quotesFromCatalog(catalog).find((q) => q.token_id === 'oc-away');
    assert.equal(restored.odds, 0.285);
    applyNovigMessage(catalog, { type: 'EVENT_GOLIVE', market: { id: 'm-ml', eventId: 'ev-1' } });
    assert.equal(catalog.events.get('ev-1').live, true);
    assert.equal(catalog.markets.get('m-ml').orders.size, 0, 'go-live drains resting orders');
    applyNovigMessage(catalog, { type: 'CLOSE', market: { id: 'm-tot' } });
    assert.equal(catalog.markets.has('m-tot'), false);

    const mlb = catalogFromMarkets([{
      id: 'm-mlb',
      type: 'MONEY',
      league: 'MLB',
      status: 'OPEN',
      eventId: 'ev-mlb',
      event: {
        id: 'ev-mlb',
        status: 'OPEN_INGAME',
        game: {
          league: 'MLB',
          scheduledStart: '2026-09-22T17:00:00Z',
          awayTeam: { name: 'Atlanta Braves' },
          homeTeam: { name: 'New York Mets' },
        },
      },
      outcomes: [
        { id: 'mets', index: 0, competitor: { name: 'New York Mets' } },
        { id: 'braves', index: 1, competitor: { name: 'Atlanta Braves' } },
      ],
      book: {
        outcomeLadders: [
          { outcomeId: 'mets', bids: [{ id: 'bm', price: 0.6, qty: 5, currency: 'CASH' }] },
          { outcomeId: 'braves', bids: [{ id: 'bb', price: 0.38, qty: 5, currency: 'CASH' }] },
        ],
      },
    }], 'MLB', NOW);
    const braves = quotesFromCatalog(mlb).find((q) => q.side === 'Atlanta Braves');
    assert.equal(braves.league, 'MLB');
    assert.equal(braves.is_live, true);
    assert.equal(braves.odds, 0.4);
  }

  {
    resetNovigAuthCache();
    let calls = 0;
    const fetchFn = async (url) => {
      calls += 1;
      assert.doesNotMatch(String(url), /super-secret/);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'cached-token', expires_in: 1800 }),
      };
    };
    let clock = NOW;
    const deps = creds({ fetchFn, nowMs: () => clock });
    assert.equal(await fetchNovigToken(deps), 'cached-token');
    clock += 60 * 1000;
    assert.equal(await fetchNovigToken(deps), 'cached-token');
    assert.equal(calls, 1, 'token is cached inside the expiry window');
    clock += 30 * 60 * 1000;
    assert.equal(await fetchNovigToken(deps), 'cached-token');
    assert.equal(calls, 2, 'expired token is fetched again');
  }

  {
    resetNovigAuthCache();
    const fetchFn = async () => ({ ok: false, status: 401, text: async () => '' });
    assert.equal(await fetchNovigToken(creds({ fetchFn, nowMs: NOW })), null);
    assert.equal(await fetchNovigToken(creds({ fetchFn, nowMs: NOW })), null);
  }

  {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/novig-stream?league=NFL';
    const res = sseRes();
    let fetched = false;
    const pending = handler(req, res, creds({
      hubs: new Map(),
      clientId: '',
      clientSecret: '',
      fetchFn: async () => { fetched = true; throw new Error('should not fetch'); },
      WebSocket: FakeWS,
    }));
    for (let i = 0; i < 40 && !res.chunks.length; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(fetched, false);
    assert.match(res.chunks[0], /"source":"novig"/);
    assert.match(res.chunks[0], /"mode":"needs-credentials"/);
    assert.match(res.chunks[0], /"note":"novig_needs_credentials"/);
    assert.match(res.chunks[0], /"quotes":\[\]/);
    assert.doesNotMatch(res.chunks.join(''), /super-secret/);
    req.emit('close');
    await pending;
  }

  {
    resetNovigAuthCache();
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/novig-stream?league=NFL';
    const res = sseRes();
    let ws = null;
    const pending = handler(req, res, creds({
      hubs: new Map(),
      nowMs: NOW,
      refreshMs: 0,
      retryMs: 60_000,
      WebSocket: FakeWS,
      onSocket(socket) { ws = socket; },
      fetchFn: async (url, init) => {
        const u = String(url);
        assert.doesNotMatch(u, /super-secret/);
        if (u.includes('/auth/emm-token')) {
          const body = JSON.parse(init.body);
          assert.equal(body.grant_type, 'client_credentials');
          assert.equal(body.client_id, 'novig-client');
          assert.equal(body.client_secret, SECRET);
          return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tape-token', expires_in: 1800 }) };
        }
        if (u.includes('/markets/open')) {
          assert.match(u, /league=NFL/);
          assert.match(init.headers.authorization, /^Bearer tape-token$/);
          if (!u.includes('marketType=MONEY')) {
            return { ok: true, status: 200, text: async () => '[]' };
          }
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{
              id: 'm-ml',
              type: 'MONEY',
              league: 'NFL',
              eventId: 'ev-1',
              event: gameEvent(),
              outcomes: [],
            }]),
          };
        }
        if (u.includes('/getMarketsByEvent/ev-1')) {
          assert.match(u, /currency=CASH/);
          return { ok: true, status: 200, text: async () => JSON.stringify(bookMarkets()) };
        }
        throw new Error(`unexpected ${u}`);
      },
    }));
    for (let i = 0; i < 50 && !ws; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(ws, 'novig hub opens the tape');
    assert.equal(ws.url, 'wss://api.novig.us/tape');
    assert.equal(ws.opts.headers.Authorization, 'Bearer tape-token');
    assert.ok(res.chunks.some((c) => c.includes('"odds":0.285') && c.includes('"source":"novig"') && c.includes('"mode":"ws"')));
    assert.ok(res.chunks.some((c) => c.includes('"bet_type":"spread"') && c.includes('"line":3.5')));
    assert.ok(res.chunks.some((c) => c.includes('"bet_type":"total"') && c.includes('"line":47.5')));
    assert.ok(!res.chunks.some((c) => c.includes('prop-over') || c.includes('-7.5')));
    ws.emit('open', {});
    assert.deepEqual(ws.sent.map((s) => JSON.parse(s)), [
      { event: 'subscribe', data: 'tape' },
      { event: 'subscribe', data: 'lifecycle' },
    ]);
    const before = res.chunks.length;
    ws.emit('message', {
      data: JSON.stringify({
        type: 'PLACE',
        order: { id: 'bid-live', price: 0.8, qty: 12, currency: 'CASH', marketId: 'm-ml', outcomeId: 'oc-home', status: 'OPEN' },
        market: { id: 'm-ml', description: 'ATL @ GB' },
      }),
    });
    assert.ok(res.chunks.length > before);
    assert.ok(res.chunks.some((c) => c.includes('"odds":0.2') && c.includes('"token_id":"oc-away"')));
    const same = res.chunks.length;
    ws.emit('message', { data: JSON.stringify({ event: 'subscribed', data: { channel: 'tape' } }) });
    assert.equal(res.chunks.length, same, 'subscription acks are not ticks');
    req.emit('close');
    await pending;
    assert.equal(ws.closed, true);
  }

  {
    resetNovigAuthCache();
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/novig-stream?league=NCAAF';
    const res = sseRes();
    let opened = false;
    const pending = handler(req, res, creds({
      hubs: new Map(),
      nowMs: NOW,
      refreshMs: 0,
      retryMs: 60_000,
      WebSocket: class extends FakeWS { constructor(url, opts) { super(url, opts); opened = true; } },
      fetchFn: async (url) => {
        if (String(url).includes('/auth/emm-token')) {
          return { ok: false, status: 401, text: async () => '{"error":"unauthorized"}' };
        }
        throw new Error('book fetch without a token');
      },
    }));
    for (let i = 0; i < 40 && !res.chunks.length; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(opened, false);
    assert.match(res.chunks[0], /"note":"novig_unauthorized"/);
    assert.match(res.chunks[0], /"quotes":\[\]/);
    assert.doesNotMatch(res.chunks.join(''), new RegExp(SECRET));
    req.emit('close');
    await pending;
  }

  {
    const res = sseRes();
    await handler({ method: 'POST', url: '/api/novig-stream' }, res, { hubs: new Map(), clientId: '', clientSecret: '' });
    assert.equal(res.statusCode, 405);
  }

  {
    const res = sseRes();
    await handler({ method: 'GET', url: '/api/novig-stream?league=NBA' }, res, { hubs: new Map(), clientId: '', clientSecret: '' });
    assert.equal(res.statusCode, 400);
  }

  {
    const env = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
    const vercel = fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8');
    assert.match(env, /NOVIG_CLIENT_ID=/);
    assert.match(env, /NOVIG_CLIENT_SECRET=/);
    assert.match(env, /NOVIG_API_BASE=https:\/\/api\.novig\.us/);
    assert.doesNotMatch(env, /NOVIG_CLIENT_SECRET=\S/);
    assert.doesNotMatch(env, /NOVIG_CLIENT_ID=\S/);
    assert.match(vercel, /api\/novig-stream\.js/);
    const src = fs.readFileSync(path.join(__dirname, '../lib/novig-live.js'), 'utf8');
    assert.doesNotMatch(src, /super-secret|client_secret\s*[:=]\s*['"][^'"]+['"]/);
  }

  // startNovig is exercised through the handler. Touch the export so a
  // refactor that drops it fails this file instead of the board.
  assert.equal(typeof startNovig, 'function');

  console.log('novig-stream.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
