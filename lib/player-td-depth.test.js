'use strict';

// Player anytime-TD No ladders: Kalshi / Polymarket parsing, the cron's
// depth pass, per-venue storage, and the Promo $500 blend on merged books.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  noLevelsFromKalshiOrderbook,
  noLevelsFromPolymarketBook,
  loadKalshiNoLadders,
  attachNoLadders,
  quotesFromKalshiMarkets,
} = require('./player-td-feeds');
const { assemblePropGame, neededLadderQuotes, bestNoPerVenue } = require('./player-props-job');
const { noAskAmericanFromYesBid, impliedFromAmerican, TAKER_FEE_RATE, playerTdLegsForBook } = require('./player-td.cjs');

(async () => {
  // Kalshi: Yes bids → No asks, best first, fee-adjusted, dollar stake.
  const kLevels = noLevelsFromKalshiOrderbook({
    orderbook_fp: { yes_dollars: [['0.0100', '1454.00'], ['0.0200', '693.00'], ['0.0300', '171.00']], no_dollars: [['0.9000', '5.00']] },
  });
  assert.equal(kLevels.length, 3);
  assert.equal(kLevels[0].american, noAskAmericanFromYesBid(0.03, TAKER_FEE_RATE.kalshi));
  assert.ok(kLevels[0].american > kLevels[1].american && kLevels[1].american > kLevels[2].american);
  assert.equal(kLevels[0].size, Math.round(171 * impliedFromAmerican(kLevels[0].american) * 100) / 100);

  // Polymarket US book: bids are Yes bids.
  const pLevels = noLevelsFromPolymarketBook({
    marketData: {
      bids: [{ px: { value: '0.2500' }, qty: '71.28' }, { px: { value: '0.3200' }, qty: '859.52' }],
      offers: [{ px: { value: '0.3300' }, qty: '1359.75' }],
    },
  });
  assert.equal(pLevels.length, 2);
  assert.equal(pLevels[0].american, noAskAmericanFromYesBid(0.32, TAKER_FEE_RATE.polymarket));
  assert.ok(pLevels[0].size > 500 && pLevels[0].size < 860);

  // List payload gives a top-of-book No size.
  const [kq] = quotesFromKalshiMarkets({ markets: [{
    ticker: 'KXNFLTD-26SEP27LACBUF-BUFDKINCAID86-1',
    title: 'Dalton Kincaid: 1+ touchdowns', yes_sub_title: 'Dalton Kincaid: 1+',
    yes_ask_dollars: '0.33', yes_bid_dollars: '0.32', yes_bid_size_fp: '100.00',
  }] });
  assert.ok(kq && kq.noSize > 0 && kq.noLevels.length === 1);

  // Batch orderbooks: explode-encoded tickers, <= 100 per call, then attach.
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.includes('/markets/orderbooks?')) {
      const tickers = [...new URL(url).searchParams.getAll('tickers')];
      assert.ok(tickers.length >= 1 && tickers.length <= 100);
      return { status: 200, json: async () => ({ orderbooks: tickers.map((ticker) => ({ ticker, orderbook_fp: { yes_dollars: [['0.3000', '2000.00']] } })) }) };
    }
    if (url.includes('/book')) {
      return { status: 200, json: async () => ({ marketData: { bids: [{ px: { value: '0.3100' }, qty: '3000' }] } }) };
    }
    return { status: 404, json: async () => ({}) };
  };
  const many = Array.from({ length: 150 }, (_, i) => `KXNFLTD-T${i}-1`);
  const kBooks = await loadKalshiNoLadders(many, { fetchFn, sleepFn: async () => {} });
  assert.equal(kBooks.size, 150);
  assert.equal(calls.filter((u) => u.includes('/markets/orderbooks?')).length, 2);

  // Refused batch → capped per-ticker fallback.
  const single = [];
  const refuse = async (url) => {
    if (url.includes('/markets/orderbooks?')) return { status: 401, json: async () => ({}) };
    single.push(url);
    return { status: 200, json: async () => ({ orderbook_fp: { yes_dollars: [['0.2000', '10.00']] } }) };
  };
  const fb = await loadKalshiNoLadders(['KXNFLTD-A-1', 'KXNFLTD-B-1'], { fetchFn: refuse, sleepFn: async () => {} });
  assert.equal(fb.size, 2);
  assert.ok(single.every((u) => /\/markets\/KXNFLTD-[AB]-1\/orderbook/.test(u)));

  // Polymarket: paced, honors 429 and gives up after repeated throttling.
  const { loadPolymarketNoLadders } = require('./player-td-feeds');
  let hits = 0;
  const throttle = async () => { hits += 1; return { status: 429, headers: { get: () => '1' }, json: async () => ({}) }; };
  const none = await loadPolymarketNoLadders(Array.from({ length: 50 }, (_, i) => `s${i}`), { fetchFn: throttle, sleepFn: async () => {}, polyGapMs: 0 });
  assert.equal(none.size, 0);
  assert.ok(hits <= 6, `stopped after throttling (${hits} calls)`);

  // Cron depth pass: only Promo-usable players, then per-venue ladders stored.
  const gameKey = 'LAC|BUF|2026-09-27';
  const quotes = [
    { book: 'kalshi', market: 'anytime', player: 'Dalton Kincaid', team: 'BUF', gameKey, yesAmerican: 200, noAmerican: -240, noSize: 20, ticker: 'KXNFLTD-26SEP27LACBUF-BUFDKINCAID86-1', commence: '2026-09-27T17:00:00Z' },
    { book: 'polymarket', market: 'anytime', player: 'Dalton Kincaid', team: 'BUF', gameKey, yesAmerican: 190, noAmerican: -230, slug: 'astatc-nfl-lac-buf-2026-09-27-td-dalkin-gte1', commence: '2026-09-27T17:00:00Z' },
    { book: 'polymarket', market: 'anytime', player: 'Nobody Offered', team: 'BUF', gameKey, yesAmerican: 900, noAmerican: -1500, slug: 'astatc-x', commence: '2026-09-27T17:00:00Z' },
    { book: 'underdog_predict', market: 'anytime', player: 'Dalton Kincaid', team: 'BUF', gameKey, yesAmerican: 180, noAmerican: -250, updatedAt: new Date().toISOString() },
  ];
  const event = {
    id: 'evt1', away_team: 'Los Angeles Chargers', home_team: 'Buffalo Bills', commence_time: '2026-09-27T17:00:00Z',
    bookmakers: [{ key: 'draftkings', markets: [{ key: 'player_anytime_td', outcomes: [{ name: 'Yes', description: 'Dalton Kincaid', price: 170 }] }] }],
  };
  const now = Date.parse('2026-09-26T04:00:00Z');
  const first = assemblePropGame(event, quotes, now);
  const needed = neededLadderQuotes([first], quotes);
  assert.deepEqual(needed.map((q) => q.book).sort(), ['kalshi', 'polymarket'], 'no ladder fetch for players without a sportsbook offer, never Underdog');
  const stats = await attachNoLadders(needed, { fetchFn, sleepFn: async () => {} });
  assert.equal(stats.attached, 2);
  const game = assemblePropGame(event, quotes, now);
  const slot = game.players.find((p) => p.name === 'Dalton Kincaid').markets.anytime;
  assert.equal(slot.opp.book, 'polymarket');
  assert.equal(slot.opp.price, -230);
  assert.ok(slot.opp.size > 0);
  assert.equal(slot.opp.levels, undefined, 'ladders live on opps[] only');
  const byBook = Object.fromEntries(slot.opps.map((o) => [o.book, o]));
  assert.ok(byBook.kalshi.levels.length && byBook.polymarket.levels.length);
  assert.equal(byBook.underdog_predict.levels, undefined, 'Underdog stays top-of-book');
  assert.deepEqual(bestNoPerVenue([{ book: 'kalshi', price: -200 }, { book: 'kalshi', price: -180 }]).map((r) => r.price), [-180]);

  // Promo blend on the merged Kalshi + Polymarket book.
  const blend = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'blendAskLadder.js')).href);
  const td = { sport: 'americanfootball_nfl', away: 'Los Angeles Chargers', home: 'Buffalo Bills', commence_time: '2026-09-27T17:00:00Z', gameKey, players: game.players };
  const [leg] = playerTdLegsForBook([td], 'draftkings', { now });
  assert.ok(leg.bestOppLevels.length >= 2);
  assert.deepEqual([...new Set(leg.bestOppLevels.map((l) => l.book))].sort(), ['kalshi', 'polymarket']);
  const walked = blend.applyPmBlendToLeg(leg, null, { promoType: 'boost', numLegs: 1 });
  assert.equal(walked.lowLiquidity, false, 'merged ladder covering $500 profit is not low liquidity');
  assert.ok(walked.pmBlend && walked.pmBlend.american <= leg.bestOpp, 'blend walks down from the top of book');

  // Thin books: partial coverage keeps the low-liquidity behavior.
  const thin = { ...leg, bestOppLevels: [{ american: -230, size: 50 }, { american: -240, size: 40 }] };
  assert.equal(blend.applyPmBlendToLeg(thin, null, {}).lowLiquidity, true);
  // No ladder and no size (old cache rows): still low liquidity.
  const bare = { ...leg, bestOppLevels: undefined, bestOppSize: null };
  assert.equal(blend.applyPmBlendToLeg(bare, null, {}).lowLiquidity, true);

  console.log('player-td-depth.test.js ok');
})().catch((err) => { console.error(err); process.exit(1); });
