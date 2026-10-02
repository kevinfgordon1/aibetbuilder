'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const handler = require('./novig-stream');
const { NOVIG_BOOK_ID, novigConfigured, novigKeyConfigured, startNovig, novigWsUrl } = require('../lib/novig-live');
const feed = require('../lib/novig-feed');

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

(async () => {
  assert.equal(NOVIG_BOOK_ID, 195);
  assert.equal(novigConfigured(), true, 'public v3 needs no key');
  assert.equal(novigKeyConfigured({}), false);
  assert.equal(novigWsUrl('https://api.novig.com'), 'wss://api.novig.com/v3/ws');

  // Pure feed pieces: bids per outcome, ask = 1 - opposite best bid.
  {
    const cat = feed.buildCatalog('NFL', {
      items: [{ eventId: 'e', description: 'Atlanta Falcons @ Green Bay Packers', league: 'NFL', status: 'OPEN_PREGAME', startsTs: Date.now() + 3600e3 }],
    }, {
      items: [{ marketId: 'm', eventId: 'e', marketType: 'MONEY', status: 'OPEN', strike: '0', outcomes: [{ outcomeId: 'gb', name: 'GB' }, { outcomeId: 'atl', name: 'ATL' }] }],
    });
    const market = cat.groups.get('e|MONEY')[0];
    const book = feed.bookFromSnapshot({ seq: 1, orders: { gb: [{ orderId: '1', price: '0.715', qty: 100 }], atl: [{ orderId: '2', price: '0.280', qty: 50 }] } });
    const quotes = feed.quotesForMarket(cat.events.get('e'), market, book, 'NFL');
    assert.deepEqual(quotes.map((q) => [q.side, q.odds, q.american]), [['Green Bay Packers', 0.72, -257], ['Atlanta Falcons', 0.285, 251]]);
    assert.ok(quotes.every((q) => q.book === 'novig' && q.book_id === 195 && q.bet_type === 'moneyline'));
  }

  // Market fee.coefficient rides on the quote (pre-fee ask); is_live from the event.
  {
    const mk = (status, fee) => feed.buildCatalog('NFL', {
      items: [{ eventId: 'e', description: 'Pittsburgh Steelers @ Cleveland Browns', league: 'NFL', status, startsTs: Date.now() - 600e3 }],
    }, {
      items: [{ marketId: 'm', eventId: 'e', marketType: 'MONEY', status: 'OPEN', strike: '0', fee, outcomes: [{ outcomeId: 'cle', name: 'CLE' }, { outcomeId: 'pit', name: 'PIT' }] }],
    });
    const book = feed.bookFromSnapshot({ seq: 1, orders: { cle: [{ orderId: '1', price: '0.705', qty: 100 }], pit: [{ orderId: '2', price: '0.705', qty: 100 }] } });
    const live = mk('OPEN_INGAME', { coefficient: '0.03', makerCredit: '0.5', charged: 'WHEN_LIVE' });
    const lq = feed.quotesForMarket(live.events.get('e'), live.groups.get('e|MONEY')[0], book, 'NFL');
    assert.ok(lq.every((q) => q.is_live === true && q.fee_coefficient === 0.03 && q.odds === 0.295));
    const none = mk('OPEN_INGAME', undefined);
    const nq = feed.quotesForMarket(none.events.get('e'), none.groups.get('e|MONEY')[0], book, 'NFL');
    assert.ok(nq.every((q) => q.fee_coefficient === undefined));
  }

  // Handler streams whatever the feed publishes, as source novig.
  {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/novig-stream?league=NFL';
    const res = sseRes();
    let stopped = false;
    const pending = handler(req, res, {
      hubs: new Map(),
      createNovigFeed: (opts) => {
        assert.deepEqual(opts.leagues, ['NFL']);
        setTimeout(() => opts.onQuotes('NFL', [{ token_id: 'a', odds: 0.285, book: 'novig', league: 'NFL' }], 'rest'), 5);
        return { ready: Promise.resolve(), stop() { stopped = true; } };
      },
    });
    for (let i = 0; i < 40 && !res.chunks.length; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    const text = res.chunks.join('');
    assert.match(text, /"source":"novig"/);
    assert.match(text, /"odds":0.285/);
    assert.doesNotMatch(text, /needs-credentials/);
    req.emit('close');
    await pending;
    assert.equal(stopped, true);
  }

  {
    const res = sseRes();
    await handler({ method: 'POST', url: '/api/novig-stream' }, res, { hubs: new Map() });
    assert.equal(res.statusCode, 405);
  }

  {
    const res = sseRes();
    await handler({ method: 'GET', url: '/api/novig-stream?league=NBA' }, res, { hubs: new Map() });
    assert.equal(res.statusCode, 400);
  }

  {
    const env = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
    const vercel = fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8');
    assert.match(env, /NOVIG_KEY_ID=/);
    assert.match(env, /NOVIG_PRIVATE_KEY=/);
    assert.match(env, /NOVIG_API_BASE=https:\/\/api\.novig\.com/);
    assert.doesNotMatch(env, /NOVIG_KEY_ID=\S/);
    assert.doesNotMatch(env, /NOVIG_PRIVATE_KEY=\S/);
    assert.doesNotMatch(env, /NOVIG_CLIENT_SECRET/);
    assert.doesNotMatch(env, /VITE_NOVIG/);
    assert.match(vercel, /api\/novig-stream\.js/);
  }

  assert.equal(typeof startNovig, 'function');
  console.log('novig-stream.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
