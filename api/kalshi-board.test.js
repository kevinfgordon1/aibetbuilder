'use strict';

const assert = require('node:assert/strict');
const handler = require('./kalshi-board');

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
  await handler({ method: 'GET', url: '/api/kalshi-board?league=NFL' }, res, {
    fetchFn: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        events: [{
          title: 'Atlanta vs Green Bay',
          markets: [
            {
              ticker: 'KXNFLGAME-26SEP24ATLGB-GB',
              yes_sub_title: 'Green Bay',
              yes_ask_dollars: '0.6900',
            },
            {
              ticker: 'KXNFLGAME-26SEP24ATLGB-ATL',
              yes_sub_title: 'Atlanta',
              yes_ask_dollars: '0.3200',
            },
            {
              ticker: 'KXNFLSPREAD-26SEP24ATLGB-GB3',
              yes_sub_title: 'Green Bay',
              yes_ask_dollars: '0.5500',
            },
          ],
        }],
      }),
    }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.league, 'NFL');
  assert.equal(res.body.quotes.length, 2, 'moneyline book only, both sides');
  const gb = res.body.quotes.find((q) => q.side === 'Green Bay');
  const atl = res.body.quotes.find((q) => q.side === 'Atlanta');
  assert.equal(gb.book, 'kalshi');
  assert.equal(gb.book_id, 194);
  assert.equal(gb.away, 'Atlanta');
  assert.equal(gb.home, 'Green Bay');
  assert.equal(gb.odds, 0.69);
  assert.equal(gb.bet_type, 'moneyline');
  assert.equal(atl.odds, 0.32);
  assert.match(res.headers['Cache-Control'], /no-store/);

  const bad = jsonRes();
  await handler({ method: 'GET', url: '/api/kalshi-board?league=NBA' }, bad, {});
  assert.equal(bad.statusCode, 400);

  console.log('kalshi-board.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
