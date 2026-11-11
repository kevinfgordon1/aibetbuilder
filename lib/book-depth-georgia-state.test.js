'use strict';

// Nov 10 2026 ~6:50 PM ET. Promo Builder, No Promo, Underdog Predict, $100, 1 leg:
// Georgia Southern ML @ Georgia State. The card hedged "Georgia State" with
// West Georgia's book (top +373, blend +268, true odds -268, EV +7.7%).
// Live GAST book at 6:55 PM ET: buying Georgia State YES is 1 - 0.63 = 37c,
// about +159 after the Kalshi taker fee, with deep size.
const assert = require('assert');
const bd = require('./book-depth');

// orderbook_fp arrays are ascending. The best bid is the LAST element.
// A 1c NO bid sits first so a reader that treats index 0 as the best bid fails.
const GAST_BOOK = {
  yes_dollars: [
    ['0.3200', '4190.00'],
    ['0.3300', '3830.00'],
    ['0.3400', '195.00'],
    ['0.3600', '65.00'],
  ],
  no_dollars: [
    ['0.0100', '2304.00'],
    ['0.6100', '6389.00'],
    ['0.6200', '11474.00'],
    ['0.6300', '19978.00'],
  ],
};

function georgiaLeg(bestOppName) {
  return bd.parseOppSelection({
    bestOppBook: 'kalshi',
    sport: 'americanfootball_ncaaf',
    market: 'ML',
    game: 'Georgia Southern Eagles @ Georgia State Panthers',
    bestOppName,
    commence_time: '2026-11-14T20:30:00Z',
  });
}

const mk = (ticker, label) => ({ ticker, yes_sub_title: label });
// West Georgia is listed first, same day, the way the live catalog was ordered.
const events = [
  { event_ticker: 'KXNCAAFGAME-26NOV14UNAUWGA', title: 'North Alabama vs West Georgia', markets: [mk('KXNCAAFGAME-26NOV14UNAUWGA-UWGA', 'West Georgia'), mk('KXNCAAFGAME-26NOV14UNAUWGA-UNA', 'North Alabama')] },
  { event_ticker: 'KXNCAAFGAME-26NOV14GTCLEM', title: 'Georgia Tech vs Clemson', markets: [mk('KXNCAAFGAME-26NOV14GTCLEM-GT', 'Georgia Tech'), mk('KXNCAAFGAME-26NOV14GTCLEM-CLEM', 'Clemson')] },
  { event_ticker: 'KXNCAAFGAME-26NOV14MIZZUGA', title: 'Missouri vs Georgia', markets: [mk('KXNCAAFGAME-26NOV14MIZZUGA-UGA', 'Georgia'), mk('KXNCAAFGAME-26NOV14MIZZUGA-MIZZ', 'Missouri')] },
  { event_ticker: 'KXNCAAFGAME-26NOV14GASOGAST', title: 'Georgia Southern vs Georgia St.', markets: [mk('KXNCAAFGAME-26NOV14GASOGAST-GAST', 'Georgia St.'), mk('KXNCAAFGAME-26NOV14GASOGAST-GASO', 'Georgia Southern')] },
  { event_ticker: 'KXNCAAFGAME-26NOV21GASOTROY', title: 'Georgia Southern vs Troy', markets: [mk('KXNCAAFGAME-26NOV21GASOTROY-GASO', 'Georgia Southern'), mk('KXNCAAFGAME-26NOV21GASOTROY-TROY', 'Troy')] },
];

assert.deepStrictEqual(bd.nameTokens('Georgia St.'), ['georgia', 'state']);
assert.deepStrictEqual(bd.nameTokens('Georgia State Panthers'), ['georgia', 'state', 'panthers']);
assert.deepStrictEqual(bd.nameTokens('St. Louis Blues'), ['saint', 'louis', 'blues']);
assert.equal(bd.teamMatchScore('West Georgia', 'Georgia State Panthers'), 0);
assert.equal(bd.teamMatchScore('Georgia', 'Georgia State Panthers'), 0);
assert.equal(bd.teamMatchScore('Georgia Tech', 'Georgia State Panthers'), 0);
assert.equal(bd.teamMatchScore('Georgia Southern', 'Georgia State Panthers'), 0);
assert.ok(bd.teamMatchScore('Georgia St.', 'Georgia State Panthers') > 0);
assert.equal(bd.teamMatchScore('Iowa', 'Iowa State Cyclones'), 0);
assert.ok(bd.teamMatchScore('Iowa State', 'Iowa State Cyclones') > 0);
assert.ok(bd.teamMatchScore('Iowa', 'Iowa Hawkeyes') > 0);

const gast = bd.matchKalshiMarket(georgiaLeg('Georgia State Panthers ML'), events);
assert.equal(gast && gast.ticker, 'KXNCAAFGAME-26NOV14GASOGAST-GAST');
assert.equal(gast && gast.buySide, 'yes');
const gaso = bd.matchKalshiMarket(georgiaLeg('Georgia Southern Eagles ML'), events);
assert.equal(gaso && gaso.ticker, 'KXNCAAFGAME-26NOV14GASOGAST-GASO');
assert.equal(gaso && gaso.buySide, 'yes');

function ladder(book, side) {
  return bd.sortAsksBestFirst(bd.kalshiAsksFromOrderbook(book, side), 'kalshi');
}

const asks = ladder(GAST_BOOK, 'yes');
assert.ok(asks.length >= 2, 'walks more than the top of book');
assert.equal(asks[0].american, 159, 'Georgia State YES ask is 37c, about +159 after the 0.07 taker fee');
for (let i = 1; i < asks.length; i++) {
  assert.ok(asks[i].american < asks[i - 1].american, `ladder goes worse: ${asks.map((l) => l.american).join(',')}`);
}
assert.ok(asks[0].size > 7000, 'top NO bid 19,978 contracts is real size, not an 8-dollar phantom');
assert.ok(!asks.some((l) => l.american >= 250), 'YES bids and the 1c NO bid are not asks');

// Same book under the websocket field name.
const fp = {
  yes_dollars_fp: GAST_BOOK.yes_dollars,
  no_dollars_fp: GAST_BOOK.no_dollars,
};
assert.equal(ladder(fp, 'yes')[0].american, 159);

// $2,000 of profit fills on the top ask alone. True odds are the inverse of that hedge.
(async () => {
  const { blendLegToMinDepth } = await import('../src/promoMinDepth.js');
  const { blendAskLadderToPayout } = await import('../src/blendAskLadder.js');
  const leg = {
    bestOppBook: 'kalshi',
    sport: 'americanfootball_ncaaf',
    game: 'Georgia Southern Eagles @ Georgia State Panthers',
    bestOppName: 'Georgia State Panthers ML',
    market: 'ML',
    dk: -209,
    bestOpp: 159,
    bestOppQuoted: 159,
    bestOppVenues: [],
  };
  const walk = blendAskLadderToPayout(asks, { targetPayout: 2000 });
  assert.equal(walk.american, 159);
  assert.equal(walk.levelsUsed, 1);
  const md = blendLegToMinDepth(leg, 2000, asks, {});
  assert.equal(md.complete, true);
  assert.equal(md.american, 159);
  assert.equal(md.venue, 'kalshi');
  assert.equal(md.parts.length, 1);
  assert.equal(md.parts[0].american, 159);
  const oppP = 100 / (159 + 100);
  const trueP = 1 - oppP;
  const trueAm = Math.round(-100 * trueP / (1 - trueP));
  assert.equal(trueAm, -159, 'True Odds are the inverse of the Georgia State hedge, not -268');
  const dec = 1 + 100 / 209;
  const ev = trueP * (dec - 1) * 100 - (1 - trueP) * 100;
  assert.ok(ev < 0, `Underdog -209 against a -159 fair is not +EV (got ${ev.toFixed(2)})`);
  console.log('book-depth-georgia-state ok', { top: asks[0], trueAm, ev: Number(ev.toFixed(2)) });
})().catch((e) => { console.error(e); process.exit(1); });
