'use strict';

const assert = require('node:assert/strict');
const {
  parseOppSelection,
  eventMatchesTeams,
  lineEqual,
  kalshiAsksFromOrderbook,
  polymarketAsksFromBook,
  flattenProphetXSelections,
  prophetXGroupMatches,
  prophetXAsksFromGroup,
  matchKalshiMarket,
  polyMarketMatches,
  sortAsksBestFirst,
  fetchVenueDepth,
  teamSearchPhrases,
  DEPTH_VENUES,
} = require('./book-depth');

// ── parse Kevin-style totals opp (promo Under → best opp is Over)
{
  const sel = parseOppSelection({
    bestOppBook: 'prophetx',
    market: 'TOT',
    sport: 'americanfootball_ncaaf',
    game: 'Louisville Cardinals @ Ole Miss Rebels',
    name: 'Louisville Cardinals/Ole Miss Rebels u55',
    bestOppName: 'Louisville Cardinals/Ole Miss Rebels o55',
  });
  assert.ok(sel);
  assert.equal(sel.venue, 'prophetx');
  assert.equal(sel.side, 'over');
  assert.equal(sel.line, 55);
  assert.ok(eventMatchesTeams('Louisville vs Ole Miss: Total Points', sel.away, sel.home));
  assert.equal(parseOppSelection({ bestOppBook: 'pinnacle', market: 'TOT', game: 'A @ B', bestOppName: 'A/B o55' }), null);
}

{
  const ml = parseOppSelection({
    bestOppBook: 'kalshi',
    market: 'ML',
    sport: 'baseball_mlb',
    game: 'Yankees @ Red Sox',
    bestOppName: 'Red Sox ML',
  });
  assert.equal(ml.side, 'ml');
  assert.equal(ml.team, 'Red Sox');

  const spr = parseOppSelection({
    bestOppBook: 'polymarket',
    market: 'SPR',
    sport: 'americanfootball_ncaaf',
    game: 'Louisville Cardinals @ Ole Miss Rebels',
    bestOppName: 'Ole Miss Rebels -6.5',
  });
  assert.equal(spr.side, 'spread');
  assert.equal(spr.line, -6.5);
  assert.equal(spr.team, 'Ole Miss Rebels');
}

assert.equal(lineEqual(55.5, 55.5), true);
assert.equal(lineEqual(55, 55.5), false, 'do not invent a half-point match');
assert.ok(teamSearchPhrases('Louisville Cardinals', 'Ole Miss Rebels').includes('louisville ole miss'));

// ── Kalshi orderbook → ask ladder (Under = buy NO = 1 − yes bids)
{
  const fp = {
    yes_dollars: [['0.4400', '425.00'], ['0.5000', '100.00'], ['0.5100', '50.00']],
    no_dollars: [['0.4800', '200.00']],
  };
  const under = kalshiAsksFromOrderbook(fp, 'no');
  assert.ok(under.length >= 3);
  const pxs = under.map((l) => l.american);
  // ask 0.56, 0.50, 0.49 → american +79 / +100 / +104
  assert.ok(pxs.includes(104) || pxs.includes(105) || under.some((l) => l.american >= 100));
  const over = kalshiAsksFromOrderbook(fp, 'yes');
  assert.ok(over.length >= 1);
  assert.ok(over.every((l) => l.size > 0));
}

// ── Polymarket asks (unsorted) → stake $ = price * size
{
  const raw = polymarketAsksFromBook({
    asks: [
      { price: '0.99', size: '40' },
      { price: '0.53', size: '28' },
      { price: '0.54', size: '100' },
    ],
  });
  assert.equal(raw.length, 3);
  const best = sortAsksBestFirst(raw, 'polymarket');
  assert.ok(best[0].american > best[best.length - 1].american, 'best American first');
  assert.ok(best[0].size > 0);
}

// ── Kalshi match: exact total line only
{
  const events = [{
    title: 'Louisville vs Ole Miss: Total Points',
    event_ticker: 'KXNCAAFTOTAL-26SEP06LOUMISS',
    markets: [
      { ticker: 'KXNCAAFTOTAL-26SEP06LOUMISS-55', yes_sub_title: 'Over 54.5 points scored' },
      { ticker: 'KXNCAAFTOTAL-26SEP06LOUMISS-56', yes_sub_title: 'Over 55.5 points scored' },
    ],
  }];
  const hit55 = matchKalshiMarket({
    market: 'TOT', side: 'under', line: 55.5, away: 'Louisville Cardinals', home: 'Ole Miss Rebels',
  }, events);
  assert.equal(hit55.ticker, 'KXNCAAFTOTAL-26SEP06LOUMISS-56');
  assert.equal(hit55.buySide, 'no');
  const missEven = matchKalshiMarket({
    market: 'TOT', side: 'over', line: 55, away: 'Louisville Cardinals', home: 'Ole Miss Rebels',
  }, events);
  assert.equal(missEven, null, 'u55 does not become 55.5');
}

// ── Polymarket market match: game total, not team total
{
  const sel = { market: 'TOT', side: 'under', line: 55.5, team: null, away: 'Louisville', home: 'Ole Miss' };
  assert.ok(polyMarketMatches(sel, { question: 'O/U 55.5' }));
  assert.equal(polyMarketMatches(sel, { question: 'Louisville Team Total: O/U 55.5' }), false);
  assert.equal(polyMarketMatches(sel, { question: 'O/U 54.5' }), false);
  const spr = { market: 'SPR', side: 'spread', line: -6.5, team: 'Ole Miss Rebels', away: 'Louisville', home: 'Ole Miss' };
  const sprHit = polyMarketMatches(spr, { question: 'Spread: Ole Miss (-6.5)' });
  assert.equal(sprHit.tokenSide, 'yes');
}

// ── ProphetX v3 grouped selections: multiple prices = real depth
{
  const groups = flattenProphetXSelections([
    [
      { name: 'Over', price: 1.96, line: 55, quantity: 54 },
      { name: 'Over', price: 2.0, line: 55, quantity: 420 },
      { name: 'Over', price: 1.95, line: 55, quantity: 1100 },
    ],
    [{ name: 'Under', price: 1.9, line: 55, quantity: 10 }],
  ]);
  assert.equal(groups.length, 2);
  const sel = { market: 'TOT', side: 'over', line: 55, team: null };
  assert.equal(prophetXGroupMatches(sel, groups[0]), true);
  assert.equal(prophetXGroupMatches(sel, groups[1]), false);
  const asks = prophetXAsksFromGroup(groups[0]);
  assert.equal(asks.length, 3);
  assert.ok(asks.some((a) => a.size === 420));
}

// ── no credentials → empty levels, do not invent
(async () => {
  delete process.env.PROPHETX_API_KEY;
  delete process.env.PROPHETX_ACCESS_KEY;
  delete process.env.PROPHETX_SECRET_KEY;
  delete process.env.NOVIG_CLIENT_ID;
  delete process.env.NOVIG_CLIENT_SECRET;
  const px = await fetchVenueDepth({
    venue: 'prophetx',
    market: 'TOT',
    side: 'over',
    line: 55,
    sport: 'americanfootball_ncaaf',
    away: 'Louisville Cardinals',
    home: 'Ole Miss Rebels',
  });
  assert.deepEqual(px.levels, []);
  assert.equal(px.reason, 'prophetx_needs_credentials');
  const nv = await fetchVenueDepth({
    venue: 'novig',
    market: 'TOT',
    side: 'over',
    line: 55,
    sport: 'americanfootball_ncaaf',
    away: 'Louisville Cardinals',
    home: 'Ole Miss Rebels',
  });
  assert.deepEqual(nv.levels, []);
  assert.equal(nv.reason, 'novig_needs_credentials');
  assert.ok(DEPTH_VENUES.has('kalshi'));
  console.log('book-depth.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
