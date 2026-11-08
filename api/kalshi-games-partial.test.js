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
  // NFL anytime TD reads KXNFLTD and the legacy KXNFLANYTD together. A miss on
  // either series is a partial prop ladder, not an empty one.
  const nflSeries = { ...handler.MARKET_SERIES.nfl, prop: handler.PROP_SERIES.nfl.series };
  const nflBy = {
    KXNFLGAME: [{ event_ticker: 'KXNFLGAME-26NOV08HOULAC', title: 'Houston vs Los Angeles C', sub_title: 'HOU vs LAC (Nov 8)', markets: [
      { ticker: 'KXNFLGAME-26NOV08HOULAC-HOU', yes_sub_title: 'Houston' },
      { ticker: 'KXNFLGAME-26NOV08HOULAC-LAC', yes_sub_title: 'Los Angeles C' },
    ] }],
    KXNFLTD: [{ event_ticker: 'KXNFLTD-26NOV08HOULAC', markets: [
      { ticker: 'KXNFLTD-26NOV08HOULAC-LACOGADSDEN86-1', yes_sub_title: 'Oronde Gadsden: 1+', title: 'Oronde Gadsden: 1+ touchdowns', status: 'active' },
    ] }],
    KXNFLANYTD: [{ event_ticker: 'KXNFLANYTD-26NOV08HOULAC', markets: [
      { ticker: 'KXNFLANYTD-26NOV08HOULAC-LACOLD', yes_sub_title: 'Legacy Scorer: 1+', status: 'active' },
    ] }],
  };
  const nflFetch = (down) => async (url) => {
    const series = new URL(url).searchParams.get('series_ticker');
    if (down.includes(series)) return null;
    return { events: nflBy[series] || [], cursor: '' };
  };
  const bothTd = await h.fetchSportGames(nflSeries, { fetchFn: nflFetch([]), propKind: 'td', nowMs: Date.parse('2026-11-08T16:00:00Z') });
  assert.equal(bothTd.failed, false);
  assert.deepEqual(bothTd.partial, []);
  const players = bothTd[0].markets.prop.map((p) => p.player).sort();
  assert.deepEqual(players, ['Legacy Scorer', 'Oronde Gadsden']);
  const missingLegacy = await h.fetchSportGames(nflSeries, { fetchFn: nflFetch(['KXNFLANYTD']), propKind: 'td', nowMs: Date.parse('2026-11-08T16:00:00Z') });
  assert.equal(missingLegacy.failed, false);
  assert.deepEqual(missingLegacy.partial, ['prop']);

  console.log('kalshi-games partial slate: ok');
})().catch((e) => { console.error(e); process.exit(1); });
