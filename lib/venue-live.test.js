'use strict';

const assert = require('node:assert/strict');
const {
  moneylineEntriesFromEvent,
  quotesFromPolymarketMessage,
  keepNewerQuote,
  loadPolymarketAsks,
  bestAskFromLevels,
  bestBidFromLevels,
  kalshiYesAskFromNoBids,
  applyPolymarketStreamMessage,
  quotesFromKalshiEvents,
  quotesFromKalshiTicker,
  quotesFromKalshiOrderbook,
  pairFromTicker,
  applyKalshiSchedule,
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
  assert.equal(entries[0].outcomePrice, null);

  const priced = moneylineEntriesFromEvent({
    ...ev,
    startTime: '2026-09-25T00:15:00Z',
    markets: [{
      sportsMarketType: 'moneyline',
      outcomes: '["Falcons","Packers"]',
      outcomePrices: '["0.285","0.715"]',
      clobTokenIds: '["tok-away","tok-home"]',
    }],
  }, 'NFL');
  assert.equal(priced[0].outcomePrice, 0.285);
  assert.equal(priced[0].start, '2026-09-25T00:15:00Z');
  const boot = quotesFromPolymarketMessage({
    event_type: 'best_bid_ask',
    asset_id: 'tok-away',
    best_ask: '0.285',
    timestamp: '1790102024649',
  }, new Map(priced.map((e) => [e.tokenId, e])));
  assert.equal(boot[0].start, '2026-09-25T00:15:00Z');

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
        occurrence_datetime: '2026-09-25T00:15:00Z',
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
  assert.equal(quotes[0].start, '2026-09-25T00:15:00Z');

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
  const cents = quotesFromKalshiTicker({
    type: 'ticker',
    msg: { market_ticker: 'KXNFLGAME-26SEP24ATLGB-GB', yes_ask: 36, ts: 1790102025000 },
  }, meta);
  assert.equal(cents.length, 1);
  assert.equal(cents[0].odds, 0.36, 'ticker yes_ask is cents');
  assert.equal(ticked[0].side, 'Green Bay');
}

{
  const sub = kalshiSubscribeMessage(['KXNFLGAME-26SEP24ATLGB-GB']);
  assert.equal(sub.cmd, 'subscribe');
  assert.deepEqual(sub.params.channels, ['ticker', 'orderbook_delta']);
  assert.deepEqual(pairFromTicker('KXNFLGAME-26SEP24ATLGB-ATL'), ['ATL', 'GB']);
  assert.deepEqual(pairFromTicker('KXMLBGAME-26SEP241905TBNYY-TB'), ['TB', 'NYY']);
  assert.deepEqual(pairFromTicker('KXMLBGAME-26SEP242210SDLAD-SD'), ['SD', 'LAD']);
  assert.deepEqual(pairFromTicker('KXMLBGAME-26SEP241915CINATL-CIN'), ['CIN', 'ATL']);
  const scheduled = applyKalshiSchedule([
    {
      ticker: 'KXNFLGAME-26SEP24ATLGB-ATL',
      side: 'Atlanta',
      start: '2026-09-25T03:15:00Z',
      is_live: false,
      odds: 0.4,
    },
  ], [{
    abbrs: ['ATL', 'GB'],
    start: '2026-09-25T00:15:00Z',
    live: true,
  }], Date.parse('2026-09-25T01:00:00Z'));
  assert.equal(scheduled[0].start, '2026-09-25T00:15:00Z', 'ESPN kickoff replaces occurrence_datetime');
  assert.equal(scheduled[0].is_live, true);
  const books = new Map();
  const meta = new Map([['KXNFLGAME-26SEP24ATLGB-ATL', { ticker: 'KXNFLGAME-26SEP24ATLGB-ATL', side: 'Atlanta', book: 'kalshi' }]]);
  const seeded = quotesFromKalshiOrderbook({
    type: 'orderbook_snapshot',
    msg: {
      market_ticker: 'KXNFLGAME-26SEP24ATLGB-ATL',
      no_dollars: [['0.0100', '4241010.54'], ['0.6400', '100']],
      ts: 1790298104713,
    },
  }, books, meta);
  assert.equal(seeded[0].odds, 0.36, 'yes ask is 1 - best no bid, not the 1c level');
  const deleted = quotesFromKalshiOrderbook({
    type: 'orderbook_delta',
    msg: { market_ticker: 'KXNFLGAME-26SEP24ATLGB-ATL', side: 'no', price_dollars: '0.6400', delta_fp: '-100', ts: 1790298104714 },
  }, books, meta);
  assert.equal(deleted[0].odds, 0.99, 'deleting the best no bid walks the ask up');
  assert.equal(KALSHI_WS_SIGN_PATH, '/trade-api/ws/v2');
}

{
  const catalog = new Map([
    ['tok-away', {
      tokenId: 'tok-away', league: 'NFL', away: 'Falcons', home: 'Packers', side: 'Falcons', live: true,
    }],
  ]);
  const askFrame = (ask, ts) => ({
    event_type: 'best_bid_ask',
    asset_id: 'tok-away',
    best_bid: String(Number(ask) - 0.01),
    best_ask: String(ask),
    timestamp: ts,
  });
  const levelFrame = (ask, ts) => ({
    event_type: 'price_change',
    timestamp: ts,
    price_changes: [{
      asset_id: 'tok-away',
      best_bid: String(Number(ask) - 0.01),
      best_ask: String(ask),
      price: String(Number(ask) - 0.01),
      side: 'BUY',
    }],
  });
  // No debounce. Older and same-instant frames must not rewind the ask.
  const frames = [
    askFrame(0.16, 200),
    levelFrame(0.15, 100),
    askFrame(0.16, 200),
    levelFrame(0.15, 150),
    askFrame(0.17, 300),
  ];
  let kept = null;
  const seen = [];
  for (const msg of frames) {
    const [quote] = quotesFromPolymarketMessage(msg, catalog);
    assert.equal(quote.odds, Number(msg.best_ask || msg.price_changes[0].best_ask));
    kept = keepNewerQuote(kept, quote);
    seen.push(kept.odds);
  }
  assert.deepEqual(seen, [0.16, 0.16, 0.16, 0.16, 0.17]);
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

{
  // Captured from CLOB /book for Falcons ML token
  // 14210704817622273694337463543394151487165262472482884963494075149888333468129
  // during ATL @ GB. Index 0 is the worst level on both sides.
  const token = '14210704817622273694337463543394151487165262472482884963494075149888333468129';
  const captured = {
    event_type: 'book',
    asset_id: token,
    timestamp: '1790298104713',
    bids: [
      { price: '0.01', size: '100472' },
      { price: '0.33', size: '53087' },
      { price: '0.34', size: '37696.75' },
      { price: '0.35', size: '2127.24' },
    ],
    asks: [
      { price: '0.99', size: '122237' },
      { price: '0.38', size: '4068' },
      { price: '0.37', size: '11092.11' },
      { price: '0.36', size: '50269.62' },
    ],
  };
  assert.equal(bestBidFromLevels(captured.bids), 0.35);
  assert.equal(bestAskFromLevels(captured.asks), 0.36);
  assert.notEqual(Number(captured.bids[0].price), 0.35);
  assert.notEqual(Number(captured.asks[0].price), 0.36);
  const store = new Map();
  const seeded = applyPolymarketStreamMessage(store, captured);
  assert.equal(seeded[0].bestAsk, 0.36, 'snapshot ask is min size>0, not asks[0]');
  const deleted = applyPolymarketStreamMessage(store, {
    event_type: 'price_change',
    timestamp: '1790298104714',
    price_changes: [{
      asset_id: token,
      price: '0.36',
      size: '0',
      side: 'SELL',
      best_ask: '0.15',
    }],
  });
  assert.equal(deleted[0].bestAsk, 0.37, 'size 0 removes the level; stale best_ask 0.15 does not paint');
  const bid = applyPolymarketStreamMessage(store, {
    event_type: 'price_change',
    timestamp: '1790298104715',
    price_changes: [{
      asset_id: token,
      price: '0.15',
      size: '500',
      side: 'BUY',
      best_ask: '0.15',
    }],
  });
  assert.equal(bid[0].bestAsk, 0.37, 'a bid delta is not the cost to buy');
  const early = applyPolymarketStreamMessage(new Map(), {
    event_type: 'price_change',
    timestamp: '1790298104712',
    price_changes: [{ asset_id: token, price: '0.15', size: '10', side: 'SELL', best_ask: '0.15' }],
  });
  assert.equal(early.length, 0, 'a level before the snapshot is not the ask');
  // Captured Kalshi orderbook_fp.no_dollars for KXNFLGAME-26SEP24ATLGB-ATL.
  // Index 0 is the 1c no bid. Best no bid was 0.64, so the yes ask is 0.36.
  const noBids = [
    ['0.0100', '4241010.54'],
    ['0.3500', '1637.93'],
    ['0.6400', '499131.13'],
  ];
  assert.equal(kalshiYesAskFromNoBids(noBids), 0.36);
  assert.notEqual(kalshiYesAskFromNoBids(noBids), 0.99);
  assert.equal(kalshiYesAskFromNoBids([
    ['0.0100', '4241010.54'],
    ['0.3500', '100'],
    ['0.6400', '0'],
  ]), 0.65, 'a size-0 best no bid is deleted');
}

(async () => {
  const asks = await loadPolymarketAsks([
    { tokenId: 'tok-away', league: 'NFL', away: 'Falcons', home: 'Packers', side: 'Falcons', live: true },
  ], {
    now: Date.parse('2026-09-25T00:48:00.000Z'),
    fetchFn: async (url, init) => {
      assert.match(String(url), /\/books/);
      assert.equal(JSON.parse(init.body)[0].token_id, 'tok-away');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{
          asset_id: 'tok-away',
          timestamp: '1790298104713',
          bids: [{ price: '0.01', size: '100472' }, { price: '0.35', size: '2127.24' }],
          asks: [{ price: '0.99', size: '122237' }, { price: '0.36', size: '50269.62' }],
        }]),
      };
    },
  });
  assert.equal(asks[0].odds, 0.36, 'loader uses min ask, not asks[0]');
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
