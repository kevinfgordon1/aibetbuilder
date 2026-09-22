'use strict';

const assert = require('node:assert/strict');
const {
  moneylineEntriesFromEvent,
  quotesFromPolymarketMessage,
  quotesFromKalshiEvents,
  quotesFromKalshiTicker,
  kalshiSubscribeMessage,
  eventInWindow,
  formatQuoteSse,
  KALSHI_WS_SIGN_PATH,
} = require('./venue-live');
const { CACHE_TTL_MS, UNDERDOG_LIVE_CACHE_MS, fetchUnderdogPhone, resetUnderdogPhoneCache } = require('./underdog-lobby');

{
  const ev = {
    title: 'Falcons vs. Packers',
    ordering: 'away',
    slug: 'nfl-atl-gb-2026-09-25',
    live: false,
    markets: [
      {
        sportsMarketType: 'moneyline',
        outcomes: '["Falcons","Packers"]',
        clobTokenIds: '["tok-away","tok-home"]',
      },
      {
        sportsMarketType: 'spreads',
        outcomes: '["Packers","Falcons"]',
        clobTokenIds: '["tok-spread","tok-spread-no"]',
        line: -3.5,
      },
      {
        sportsMarketType: 'moneyline',
        question: 'Will the Falcons win?',
        outcomes: '["Yes","No"]',
        clobTokenIds: '["yes","no"]',
      },
    ],
  };
  const entries = moneylineEntriesFromEvent(ev, 'NFL');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.side), ['Falcons', 'Packers']);
  assert.equal(entries[0].away, 'Falcons');
  assert.equal(entries[0].home, 'Packers');
  assert.equal(entries[0].tokenId, 'tok-away');

  const catalog = new Map(entries.map((e) => [e.tokenId, e]));
  const quotes = quotesFromPolymarketMessage({
    event_type: 'best_bid_ask',
    asset_id: 'tok-away',
    best_bid: '0.270',
    best_ask: '0.285',
    timestamp: '1790102024649',
  }, catalog);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].book, 'polymarket');
  assert.equal(quotes[0].book_id, 193);
  assert.equal(quotes[0].odds, 0.285);
  assert.equal(quotes[0].side, 'Falcons');

  const fromChange = quotesFromPolymarketMessage({
    event_type: 'price_change',
    timestamp: '1790102024691',
    price_changes: [{ asset_id: 'tok-home', price: '0.71', best_ask: '0.720' }],
  }, catalog);
  assert.equal(fromChange[0].odds, 0.72);
  assert.equal(fromChange[0].side, 'Packers');

  const bookSnap = quotesFromPolymarketMessage({
    event_type: 'book',
    asset_id: 'tok-away',
    asks: [{ price: '0.999', size: '10' }],
  }, catalog);
  assert.equal(bookSnap.length, 0, 'full book snapshots are not asks');
}

{
  const now = Date.parse('2026-09-22T18:00:00Z');
  assert.equal(eventInWindow({ live: true }, now), true);
  assert.equal(eventInWindow({ startTime: '2026-09-25T00:15:00Z' }, now), true);
  assert.equal(eventInWindow({ startTime: '2026-10-20T00:15:00Z' }, now), false);
  assert.equal(eventInWindow({ startTime: '2026-05-23T17:00:00Z' }, now), false);
}

{
  const quotes = quotesFromKalshiEvents([{
    title: 'Atlanta vs Green Bay',
    markets: [
      {
        ticker: 'KXNFLGAME-26SEP24ATLGB-GB',
        yes_sub_title: 'Green Bay',
        yes_ask_dollars: '0.7200',
        yes_ask_size_fp: '1051.00',
      },
      {
        ticker: 'KXNFLGAME-26SEP24ATLGB-ATL',
        yes_sub_title: 'Atlanta',
        yes_ask_dollars: '0.2900',
      },
      {
        ticker: 'KXNFLSPREAD-26SEP24ATLGB-GB3',
        yes_sub_title: 'Green Bay',
        yes_ask_dollars: '0.5500',
      },
    ],
  }], 'NFL');
  assert.equal(quotes.length, 2);
  assert.equal(quotes[0].book_id, 194);
  assert.equal(quotes[0].odds, 0.72);
  assert.equal(quotes[0].side, 'Green Bay');
  assert.equal(quotes[0].size, 1051);
  assert.equal(quotes[0].is_live, false);

  const meta = new Map(quotes.map((q) => [q.ticker, q]));
  const ticked = quotesFromKalshiTicker({
    type: 'ticker',
    msg: {
      market_ticker: 'KXNFLGAME-26SEP24ATLGB-GB',
      yes_ask_dollars: '0.7300',
      ts: 1790102024649,
    },
  }, meta);
  assert.equal(ticked.length, 1);
  assert.equal(ticked[0].odds, 0.73);
  assert.equal(ticked[0].side, 'Green Bay');
}

{
  const sub = kalshiSubscribeMessage(['KXNFLGAME-26SEP24ATLGB-GB']);
  assert.equal(sub.cmd, 'subscribe');
  assert.deepEqual(sub.params.channels, ['ticker']);
  assert.equal(KALSHI_WS_SIGN_PATH, '/trade-api/ws/v2');
}

{
  const sse = formatQuoteSse([{ book: 'polymarket', odds: 0.285 }], 123, { source: 'polymarket', mode: 'ws' });
  assert.match(sse, /^event: quote\ndata: /);
  const data = JSON.parse(sse.split('data: ')[1]);
  assert.equal(data.ingest_ts, 123);
  assert.equal(data.payload.source, 'polymarket');
  assert.equal(data.payload.mode, 'ws');
  assert.equal(data.payload.quotes[0].odds, 0.285);
}

(async () => {
  assert.equal(UNDERDOG_LIVE_CACHE_MS, 30_000);
  assert.ok(CACHE_TTL_MS > UNDERDOG_LIVE_CACHE_MS);
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ games: {}, appearances: {}, over_under_lines: {} }),
  });
  const cache = new Map();
  resetUnderdogPhoneCache(cache);
  const first = await fetchUnderdogPhone({ fetchFn, cache, now: 1_000, live: true });
  assert.equal(first.cacheStatus, 'MISS');
  const held = await fetchUnderdogPhone({ fetchFn, cache, now: 1_000 + 29_000, live: true });
  assert.equal(held.cacheStatus, 'HIT');
  const expired = await fetchUnderdogPhone({ fetchFn, cache, now: 1_000 + 30_001, live: true });
  assert.equal(expired.cacheStatus, 'MISS');
  const cold = await fetchUnderdogPhone({ fetchFn, cache, now: 1_000 + 30_001, live: false });
  assert.equal(cold.cacheStatus, 'MISS', 'live cache must not satisfy the default 45s path');
  const still = await fetchUnderdogPhone({ fetchFn, cache, now: 1_000 + 40_000, live: false });
  assert.equal(still.cacheStatus, 'HIT');
  console.log('venue-live.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
