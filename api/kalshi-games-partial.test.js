'use strict';
// Nov 4 2026: one KXNCAAMBTOTAL fetch failed on prod, every NCAAB game went out with total: [] and the CDN kept
// that slate, so Promo -> Combo Locks said "no matching TOT on Southeastern Louisiana vs Auburn". A spread / total /
// prop series that does not load must be reported as `partial` (unknown, not missing), never silently empty.
const assert = require('node:assert/strict');
const handler = require('./kalshi-games.js');
const h = handler._helpers;
const fx = require('./fixtures-kalshi-ncaamb.json');

const bySeries = { KXNCAAMBGAME: fx.side, KXNCAAMBSPREAD: fx.spread, KXNCAAMBTOTAL: fx.total };
const fetchWith = (down) => async (url) => {
  const series = new URL(url).searchParams.get('series_ticker');
  if (down.includes(series)) return null;
  return { events: bySeries[series] || [], cursor: '' };
};
const opts = (fetchFn) => ({ fetchFn, occurrenceStartOffsetMs: handler.OCCURRENCE_START_OFFSET_MS.ncaab });

(async () => {
  const ok = await h.fetchSportGames(handler.MARKET_SERIES.ncaab, opts(fetchWith([])));
  assert.equal(ok.failed, false);
  assert.deepEqual(ok.partial, []);

  const noTotals = await h.fetchSportGames(handler.MARKET_SERIES.ncaab, opts(fetchWith(['KXNCAAMBTOTAL'])));
  assert.equal(noTotals.failed, false, 'moneylines loaded, so the sport itself is not failed');
  assert.deepEqual(noTotals.partial, ['total'], 'missing totals are reported, not silently empty');

  const noSides = await h.fetchSportGames(handler.MARKET_SERIES.ncaab, opts(fetchWith(['KXNCAAMBGAME'])));
  assert.equal(noSides.failed, true);
  assert.deepEqual(noSides.partial, []);

  // fetchFn never reaches groupSportGames' options.
  const both = await h.fetchSportGames(handler.MARKET_SERIES.ncaab, opts(fetchWith(['KXNCAAMBSPREAD', 'KXNCAAMBTOTAL'])));
  assert.deepEqual(both.partial.sort(), ['spread', 'total']);
  console.log('kalshi-games partial slate: ok');
})().catch((e) => { console.error(e); process.exit(1); });
