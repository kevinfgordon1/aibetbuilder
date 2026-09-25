'use strict';

const assert = require('node:assert/strict');
const handler = require('./polymarket-board');

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

(async () => {
  const res = jsonRes();
  await handler({ method: 'GET', url: '/api/polymarket-board?league=NFL' }, res, {
    now: Date.parse('2026-09-25T00:30:00Z'),
    fetchFn: async (url, init) => {
      if (String(url).includes('/books')) {
        assert.equal(init && init.method, 'POST');
        const posted = JSON.parse(init.body);
        assert.equal(posted[0].token_id, 'tok-away');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            {
              asset_id: 'tok-away',
              timestamp: '1790298104713',
              bids: [{ price: '0.01', size: '100472' }, { price: '0.33', size: '10' }],
              asks: [{ price: '0.99', size: '122237' }, { price: '0.34', size: '12' }],
            },
            {
              asset_id: 'tok-home',
              timestamp: '1790298104713',
              bids: [{ price: '0.01', size: '10' }, { price: '0.66', size: '8' }],
              asks: [{ price: '0.99', size: '10' }, { price: '0.67', size: '9' }],
            },
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
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.league, 'NFL');
  assert.equal(res.body.quotes.length, 2);
  const falcons = res.body.quotes.find((q) => q.side === 'Falcons');
  const packers = res.body.quotes.find((q) => q.side === 'Packers');
  assert.equal(falcons.book, 'polymarket');
  assert.equal(falcons.book_id, 193);
  assert.equal(falcons.odds, 0.34, 'min ask wins over asks[0] 0.99 and cached gamma 0.26');
  assert.equal(falcons.is_live, true);
  assert.equal(packers.odds, 0.67);
  assert.match(res.headers['Cache-Control'], /no-store/);

  const bad = jsonRes();
  await handler({ method: 'GET', url: '/api/polymarket-board?league=NBA' }, bad, {});
  assert.equal(bad.statusCode, 400);

  console.log('polymarket-board.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
