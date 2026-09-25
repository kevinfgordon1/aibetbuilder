'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { generateKeyPairSync } = require('node:crypto');
const polyHandler = require('./polymarket-stream');
const kalshiHandler = require('./kalshi-stream');
const { kalshiWsHeaders } = kalshiHandler;

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
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.listeners = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  send(data) { this.sent.push(String(data)); }
  close() { this.closed = true; }
  emit(type, ev) {
    for (const fn of this.listeners[type] || []) fn(ev);
  }
}

(async () => {
  {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/polymarket-stream?league=NFL';
    const res = sseRes();
    let ws = null;
    const pending = polyHandler(req, res, {
      hubs: new Map(),
      now: Date.parse('2026-09-22T18:00:00Z'),
      WebSocket: FakeWS,
      onSocket(socket) { ws = socket; },
      fetchFn: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{
          title: 'Falcons vs. Packers',
          ordering: 'away',
          live: true,
          startTime: '2026-09-22T17:00:00Z',
          slug: 'nfl-atl-gb-2026-09-22',
          markets: [{
            sportsMarketType: 'moneyline',
            closed: false,
            outcomes: '["Falcons","Packers"]',
            clobTokenIds: '["tok-away","tok-home"]',
          }],
        }]),
      }),
    });
    for (let i = 0; i < 40 && !ws; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(ws, 'polymarket hub opens the CLOB socket');
    assert.match(ws.url, /ws-subscriptions-clob\.polymarket\.com\/ws\/market/);
    ws.emit('open', {});
    assert.ok(ws.sent.length >= 1);
    const sub = JSON.parse(ws.sent[0]);
    assert.equal(sub.type, 'market');
    assert.deepEqual(sub.assets_ids, ['tok-away', 'tok-home']);
    assert.equal(sub.custom_feature_enabled, true);
    ws.emit('message', {
      data: JSON.stringify({
        event_type: 'best_bid_ask',
        asset_id: 'tok-away',
        best_ask: '0.285',
        timestamp: '1790102024649',
      }),
    });
    assert.ok(res.chunks.some((c) => c.includes('"odds":0.285') && c.includes('"source":"polymarket"') && c.includes('"mode":"ws"')));
    const again = res.chunks.length;
    ws.emit('message', {
      data: JSON.stringify({
        event_type: 'best_bid_ask',
        asset_id: 'tok-away',
        best_ask: '0.285',
        timestamp: '1790102024700',
      }),
    });
    assert.equal(res.chunks.length, again, 'unchanged ask is not a tick');
    req.emit('close');
    await pending;
    assert.equal(ws.closed, true);
  }

  {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/kalshi-stream?league=MLB';
    const res = sseRes();
    let calls = 0;
    const pending = kalshiHandler(req, res, {
      hubs: new Map(),
      pollMs: 30,
      maxPolls: 2,
      fetchFn: async () => {
        calls += 1;
        const ask = calls === 1 ? '0.4400' : '0.4600';
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            events: [{
              title: 'San Diego vs Los Angeles D',
              markets: [{
                ticker: 'KXMLBGAME-26SEP242210SDLAD-SD',
                yes_sub_title: 'San Diego',
                yes_ask_dollars: ask,
                yes_ask_size_fp: '1051.00',
              }],
            }],
          }),
        };
      },
    });
    for (let i = 0; i < 40 && res.chunks.length < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(res.chunks.length >= 2, 'kalshi poll emits the ask and the change');
    assert.match(res.chunks[0], /"source":"kalshi"/);
    assert.match(res.chunks[0], /"mode":"rest-poll"/);
    assert.match(res.chunks[0], /"odds":0\.44/);
    assert.match(res.chunks[1], /"odds":0\.46/);
    assert.match(res.chunks[0], /ingest_ts/);
    req.emit('close');
    await pending;
    assert.ok(calls >= 2);
  }

  {
    // Production bug: a warm /api/kalshi-stream replayed one changed ticker
    // (PIT @ CLE) and the NFL moneyline column stayed "—" for every other game.
    const hubs = new Map();
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      const atl = calls === 1 ? '0.2900' : '0.3100';
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [{
            title: 'Atlanta vs Green Bay',
            markets: [
              {
                ticker: 'KXNFLGAME-26SEP24ATLGB-GB',
                yes_sub_title: 'Green Bay',
                yes_ask_dollars: '0.7200',
              },
              {
                ticker: 'KXNFLGAME-26SEP24ATLGB-ATL',
                yes_sub_title: 'Atlanta',
                yes_ask_dollars: atl,
              },
            ],
          }],
        }),
      };
    };
    const req1 = new EventEmitter();
    req1.method = 'GET';
    req1.url = '/api/kalshi-stream?league=NFL';
    const res1 = sseRes();
    const pending1 = kalshiHandler(req1, res1, {
      hubs,
      pollMs: 20,
      maxPolls: 2,
      fetchFn,
    });
    for (let i = 0; i < 50 && res1.chunks.length < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(res1.chunks.length >= 2, true, 'two polls produce two Kalshi events');
    const moved = JSON.parse(res1.chunks[1].split('data: ')[1]);
    assert.equal(moved.payload.quotes.length, 2, 'a price change still ships both sides');
    assert.equal(moved.payload.quotes.find((q) => q.side === 'Green Bay').odds, 0.72);
    assert.equal(moved.payload.quotes.find((q) => q.side === 'Atlanta').odds, 0.31);

    const req2 = new EventEmitter();
    req2.method = 'GET';
    req2.url = '/api/kalshi-stream?league=NFL';
    const res2 = sseRes();
    const pending2 = kalshiHandler(req2, res2, {
      hubs,
      pollMs: 1000,
      maxPolls: 1,
      fetchFn,
    });
    for (let i = 0; i < 40 && res2.chunks.length < 1; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(res2.chunks.length >= 1, 'late subscriber is replayed a snapshot');
    const replay = JSON.parse(res2.chunks[0].split('data: ')[1]);
    assert.equal(replay.payload.source, 'kalshi');
    assert.equal(replay.payload.quotes.length, 2, 'replay is the full book, not the last changed ticker');
    assert.equal(replay.payload.quotes.find((q) => q.ticker.endsWith('-GB')).odds, 0.72);
    assert.equal(replay.payload.quotes.find((q) => q.ticker.endsWith('-ATL')).odds, 0.31);
    req1.emit('close');
    req2.emit('close');
    await pending1;
    await pending2;
  }

  {
    const res = sseRes();
    await polyHandler({ method: 'POST', url: '/api/polymarket-stream' }, res, { hubs: new Map() });
    assert.equal(res.statusCode, 405);
  }

  {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
    const headers = kalshiWsHeaders({ keyId: 'key-1', pem }, 1700000000000);
    assert.equal(headers['KALSHI-ACCESS-KEY'], 'key-1');
    assert.equal(headers['KALSHI-ACCESS-TIMESTAMP'], '1700000000000');
    assert.ok(headers['KALSHI-ACCESS-SIGNATURE']);
  }

  console.log('venue-stream.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
