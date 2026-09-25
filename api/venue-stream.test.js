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
        event_type: 'book',
        asset_id: 'tok-away',
        timestamp: '1790102024649',
        bids: [{ price: '0.01', size: '100472' }, { price: '0.27', size: '10' }],
        asks: [{ price: '0.99', size: '122237' }, { price: '0.285', size: '12' }],
      }),
    });
    assert.ok(res.chunks.some((c) => c.includes('"odds":0.285') && c.includes('"source":"polymarket"') && c.includes('"complete":false')), 'a websocket book is a delta, not a full snapshot');
    const again = res.chunks.length;
    ws.emit('message', {
      data: JSON.stringify({
        event_type: 'price_change',
        timestamp: '1790102024700',
        price_changes: [{
          asset_id: 'tok-away',
          price: '0.27',
          size: '11',
          side: 'BUY',
          best_ask: '0.15',
        }],
      }),
    });
    assert.equal(res.chunks.length, again, 'a bid change and a stale best_ask are not a new ask');
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
      fetchFn: async (url) => {
        const u = String(url);
        if (u.includes('espn.com') || u.includes('/orderbook')) {
          return { ok: true, status: 200, text: async () => '{}' };
        }
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
    assert.match(res.chunks[0], /"mode":"snapshot"/);
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
    const fetchFn = async (url) => {
      const u = String(url);
      if (u.includes('espn.com') || u.includes('/orderbook')) {
        return { ok: true, status: 200, text: async () => '{}' };
      }
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
    assert.equal(res1.chunks.length >= 2, true, 'a later poll emits the ask that moved');
    const moved = JSON.parse(res1.chunks[1].split('data: ')[1]);
    assert.equal(moved.payload.quotes.length, 1, 'a price change ships only that contract');
    assert.equal(moved.payload.quotes.find((q) => q.side === 'Atlanta').odds, 0.31);
    assert.equal(moved.payload.complete, false, 'after the snapshot, frames are deltas');

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
    assert.equal(replay.payload.complete, true);
    req1.emit('close');
    req2.emit('close');
    await pending1;
    await pending2;
  }

  {
    // A quiet in-game book still has to reach a connected client. Skipping
    // the emit when the ask did not move left the board on the pregame print.
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/kalshi-stream?league=NFL';
    const res = sseRes();
    const pending = kalshiHandler(req, res, {
      hubs: new Map(),
      pollMs: 20,
      maxPolls: 2,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [{
            title: 'Atlanta vs Green Bay',
            markets: [
              { ticker: 'KXNFLGAME-26SEP24ATLGB-ATL', yes_sub_title: 'Atlanta', yes_ask_dollars: '0.3400' },
              { ticker: 'KXNFLGAME-26SEP24ATLGB-GB', yes_sub_title: 'Green Bay', yes_ask_dollars: '0.6700' },
            ],
          }],
        }),
      }),
    });
    for (let i = 0; i < 40 && res.chunks.length < 1; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(res.chunks.length, 1, 'an unchanged ask is not pushed again');
    const only = JSON.parse(res.chunks[0].split('data: ')[1]);
    assert.equal(only.payload.complete, true);
    assert.equal(only.payload.quotes.find((q) => q.side === 'Atlanta').odds, 0.34);
    assert.equal(only.payload.quotes.length, 2);
    req.emit('close');
    await pending;
  }

  {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/polymarket-stream?league=NFL';
    const res = sseRes();
    let posts = 0;
    const pending = polyHandler(req, res, {
      hubs: new Map(),
      now: Date.parse('2026-09-25T00:30:00Z'),
      pollMs: 20,
      maxPolls: 2,
      WebSocket: FakeWS,
      fetchFn: async (url, init) => {
        if (String(url).includes('/books')) {
          posts += 1;
          const posted = JSON.parse(init.body);
          assert.equal(posted[0].token_id, 'tok-away');
          const ask = posts === 1 ? '0.34' : '0.36';
          const book = (assetId, askPx, bidPx) => ({
            asset_id: assetId,
            timestamp: String(1_790_298_104_000 + posts * 1000),
            bids: [{ price: '0.01', size: '100472' }, { price: bidPx, size: '10' }],
            asks: [{ price: '0.99', size: '122237' }, { price: askPx, size: '12' }],
          });
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([
              book('tok-away', ask, '0.33'),
              book('tok-home', '0.67', '0.32'),
            ]),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{
            title: 'Falcons vs. Packers',
            ordering: 'away',
            live: true,
            startTime: '2026-09-25T00:15:00Z',
            markets: [{
              sportsMarketType: 'moneyline',
              outcomes: '["Falcons","Packers"]',
              clobTokenIds: '["tok-away","tok-home"]',
              outcomePrices: '["0.26","0.74"]',
            }],
          }]),
        };
      },
    });
    for (let i = 0; i < 50 && res.chunks.length < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(res.chunks.length >= 2, 'CLOB refresh pushes a new in-game ask');
    const first = JSON.parse(res.chunks[0].split('data: ')[1]);
    const next = JSON.parse(res.chunks[1].split('data: ')[1]);
    assert.equal(first.payload.complete, true);
    assert.equal(first.payload.quotes.length, 2, 'snapshot is both sides, not the gamma cache');
    assert.equal(first.payload.quotes.find((q) => q.side === 'Falcons').odds, 0.34);
    assert.notEqual(first.payload.quotes.find((q) => q.side === 'Falcons').odds, 0.26);
    assert.equal(next.payload.complete, false, 'the refresh that moved one ask is a delta');
    assert.equal(next.payload.quotes.find((q) => q.side === 'Falcons').odds, 0.36);
    assert.equal(next.payload.quotes.length, 1, 'the unchanged Packers ask is not re-sent');
    req.emit('close');
    await pending;
  }

  {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/kalshi-stream?league=NFL';
    const res = sseRes();
    let ws = null;
    const pending = kalshiHandler(req, res, {
      hubs: new Map(),
      pollMs: 5000,
      maxPolls: 1,
      kalshiCreds: { ok: true, keyId: 'key-1', pem: 'unused' },
      wsHeaders: { 'KALSHI-ACCESS-KEY': 'key-1' },
      WebSocket: FakeWS,
      onSocket(socket) { ws = socket; },
      fetchFn: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [{
            title: 'Atlanta vs Green Bay',
            markets: [
              { ticker: 'KXNFLGAME-26SEP24ATLGB-ATL', yes_sub_title: 'Atlanta', yes_ask_dollars: '0.3400' },
              { ticker: 'KXNFLGAME-26SEP24ATLGB-GB', yes_sub_title: 'Green Bay', yes_ask_dollars: '0.6700' },
            ],
          }],
        }),
      }),
    });
    for (let i = 0; i < 40 && !ws; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(ws, 'kalshi hub opens the ticker socket when the key is present');
    assert.match(ws.url, /external-api-ws\.kalshi\.com\/trade-api\/ws\/v2/);
    ws.emit('open', {});
    assert.ok(ws.sent.length >= 1);
    const sub = JSON.parse(ws.sent[0]);
    assert.deepEqual(sub.params.channels, ['ticker', 'orderbook_delta']);
    assert.ok(sub.params.market_tickers.includes('KXNFLGAME-26SEP24ATLGB-ATL'));
    ws.emit('message', {
      data: JSON.stringify({
        type: 'ticker',
        msg: { market_ticker: 'KXNFLGAME-26SEP24ATLGB-ATL', yes_ask: 36, ts: Date.now() },
      }),
    });
    const tick = JSON.parse(res.chunks[res.chunks.length - 1].split('data: ')[1]);
    assert.equal(tick.payload.mode, 'ws');
    assert.equal(tick.payload.complete, false, 'a ticker is a delta, not another full book');
    assert.equal(tick.payload.quotes.length, 1);
    assert.equal(tick.payload.quotes.find((q) => q.side === 'Atlanta').odds, 0.36);
    const same = res.chunks.length;
    ws.emit('message', {
      data: JSON.stringify({
        type: 'ticker',
        msg: { market_ticker: 'KXNFLGAME-26SEP24ATLGB-ATL', yes_ask: 36, ts: Date.now() },
      }),
    });
    assert.equal(res.chunks.length, same, 'unchanged ticker ask is not a second paint');
    ws.emit('message', {
      data: JSON.stringify({
        type: 'orderbook_snapshot',
        sid: 4,
        seq: 20,
        msg: {
          market_ticker: 'KXNFLGAME-26SEP24ATLGB-ATL',
          no_dollars_fp: [['0.6400', '100.00']],
        },
      }),
    });
    const afterBook = res.chunks.length;
    ws.emit('message', {
      data: JSON.stringify({
        type: 'ticker',
        msg: { market_ticker: 'KXNFLGAME-26SEP24ATLGB-ATL', yes_ask: 17, ts: Date.now() },
      }),
    });
    assert.equal(res.chunks.length, afterBook, 'ticker does not override a built book');
    ws.emit('message', {
      data: JSON.stringify({
        type: 'orderbook_delta',
        sid: 4,
        seq: 22,
        msg: {
          market_ticker: 'KXNFLGAME-26SEP24ATLGB-ATL',
          side: 'no',
          price_dollars: '0.6400',
          delta_fp: '-100.00',
        },
      }),
    });
    assert.equal(res.chunks.length, afterBook, 'a seq gap does not emit');
    const snap = ws.sent.map((s) => JSON.parse(s)).find((m) => m.cmd === 'update_subscription');
    assert.equal(snap.params.action, 'get_snapshot');
    assert.deepEqual(snap.params.sids, [4]);
    assert.deepEqual(snap.params.market_tickers, ['KXNFLGAME-26SEP24ATLGB-ATL']);
    req.emit('close');
    await pending;
    assert.equal(ws.closed, true);
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
