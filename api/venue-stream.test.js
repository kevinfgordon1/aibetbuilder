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
