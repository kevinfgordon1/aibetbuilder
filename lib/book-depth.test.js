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
  kalshiCatalogTop,
  polyMarketMatches,
  sortAsksBestFirst,
  fetchVenueDepth,
  teamSearchPhrases,
  nameTokens,
  tokensHit,
  teamMatchScore,
  pickBestTeamMatch,
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

{
  const homeNo = parseOppSelection({
    bestOppBook: 'kalshi',
    market: 'ML',
    sport: 'soccer_epl',
    game: 'Chelsea @ Arsenal',
    bestOppName: 'Arsenal ML No',
  });
  assert.equal(homeNo.team, 'Arsenal');
  assert.equal(homeNo.buySide, 'no');
  const drawNo = parseOppSelection({
    bestOppBook: 'polymarket',
    market: 'ML',
    sport: 'soccer_usa_mls',
    game: 'LAFC @ Inter Miami',
    bestOppName: 'Draw No',
  });
  assert.equal(drawNo.team, 'Draw');
  assert.equal(drawNo.buySide, 'no');
  const tieHit = matchKalshiMarket({
    market: 'ML', team: 'Draw', buySide: 'no',
    away: 'Chelsea', home: 'Arsenal',
  }, [{
    title: 'Arsenal vs Chelsea',
    markets: [
      { ticker: 'EPL-ARS', yes_sub_title: 'Arsenal' },
      { ticker: 'EPL-TIE', yes_sub_title: 'Tie' },
    ],
  }]);
  assert.equal(tieHit.ticker, 'EPL-TIE');
  assert.equal(tieHit.buySide, 'no');
  const twoWay = parseOppSelection({
    bestOppBook: 'kalshi',
    market: 'ML',
    sport: 'baseball_mlb',
    game: 'Yankees @ Red Sox',
    bestOppName: 'Red Sox ML',
  });
  assert.equal(twoWay.buySide, 'yes');
}

// ── Soccer ML: generic "united"/"city" must not pick the opponent
{
  const mlsEvent = {
    title: 'DC United vs Atlanta',
    event_ticker: 'KXMLSGAME-26SEP13DCATL',
    markets: [
      { ticker: 'KXMLSGAME-DC', yes_sub_title: 'DC United' },
      { ticker: 'KXMLSGAME-ATL', yes_sub_title: 'Atlanta' },
      { ticker: 'KXMLSGAME-TIE', yes_sub_title: 'Tie' },
    ],
  };
  const atlSel = {
    market: 'ML', team: 'Atlanta United', buySide: 'no',
    away: 'Atlanta United FC', home: 'DC United',
  };
  const atlHit = matchKalshiMarket(atlSel, [mlsEvent]);
  assert.equal(atlHit.ticker, 'KXMLSGAME-ATL', 'Atlanta United → Atlanta No, not DC United');
  assert.equal(atlHit.buySide, 'no');
  const atlFc = matchKalshiMarket({ ...atlSel, team: 'Atlanta United FC' }, [mlsEvent]);
  assert.equal(atlFc.ticker, 'KXMLSGAME-ATL');
  const dcHit = matchKalshiMarket({
    market: 'ML', team: 'DC United', buySide: 'no',
    away: 'Atlanta United FC', home: 'DC United',
  }, [mlsEvent]);
  assert.equal(dcHit.ticker, 'KXMLSGAME-DC');
  const shortAtl = matchKalshiMarket({ ...atlSel, team: 'Atlanta' }, [mlsEvent]);
  assert.equal(shortAtl.ticker, 'KXMLSGAME-ATL');
  assert.ok(teamMatchScore('Atlanta', 'Atlanta United FC') > teamMatchScore('DC United', 'Atlanta United FC'));
  assert.equal(teamMatchScore('DC United', 'Atlanta United'), 0);
  assert.equal(tokensHit(nameTokens('DC United'), nameTokens('Atlanta United')), false);
  assert.ok(tokensHit(nameTokens('Atlanta'), nameTokens('Atlanta United FC')));

  const eplEvent = {
    title: 'Chelsea vs Manchester City',
    markets: [
      { ticker: 'EPL-CHE', yes_sub_title: 'Chelsea' },
      { ticker: 'EPL-MCI', yes_sub_title: 'Manchester City' },
      { ticker: 'EPL-TIE', yes_sub_title: 'Tie' },
    ],
  };
  const cityHit = matchKalshiMarket({
    market: 'ML', team: 'Manchester City', buySide: 'no',
    away: 'Manchester City', home: 'Chelsea',
  }, [eplEvent]);
  assert.equal(cityHit.ticker, 'EPL-MCI', 'City must not land on Chelsea');
  const cheHit = matchKalshiMarket({
    market: 'ML', team: 'Chelsea FC', buySide: 'no',
    away: 'Manchester City', home: 'Chelsea',
  }, [eplEvent]);
  assert.equal(cheHit.ticker, 'EPL-CHE');
  const manU = matchKalshiMarket({
    market: 'ML', team: 'Manchester United FC', buySide: 'no',
    away: 'Manchester United', home: 'Manchester City',
  }, [{
    title: 'Manchester United vs Manchester City',
    markets: [
      { ticker: 'EPL-MUN', yes_sub_title: 'Manchester United' },
      { ticker: 'EPL-MCI2', yes_sub_title: 'Manchester City' },
      { ticker: 'EPL-TIE2', yes_sub_title: 'Tie' },
    ],
  }]);
  assert.equal(manU.ticker, 'EPL-MUN', 'United vs City must use generic token as tie-break');

  const labels = ['DC United', 'Atlanta', 'Tie'];
  assert.equal(pickBestTeamMatch('Atlanta United', labels), 'Atlanta');
  assert.notEqual(pickBestTeamMatch('Atlanta United FC', labels), 'DC United');
  assert.equal(pickBestTeamMatch('Draw', labels), null, 'draw stays special-cased, not scored as a club');

  const dcPoly = polyMarketMatches(
    { market: 'ML', team: 'Atlanta United FC', buySide: 'no', away: 'Atlanta United FC', home: 'DC United' },
    { question: 'DC United vs Atlanta: Will DC United win?', groupItemTitle: 'DC United', outcomes: ['Yes', 'No'] },
  );
  assert.equal(dcPoly, false, 'full event title mentioning Atlanta must not select DC United Yes/No');
  const atlPoly = polyMarketMatches(
    { market: 'ML', team: 'Atlanta United FC', buySide: 'no', away: 'Atlanta United FC', home: 'DC United' },
    { question: 'DC United vs Atlanta: Will Atlanta win?', groupItemTitle: 'Atlanta', outcomes: ['Yes', 'No'] },
  );
  assert.equal(atlPoly.tokenSide, 'no');
  assert.equal(atlPoly.label, 'Atlanta');

  assert.equal(prophetXGroupMatches({
    market: 'ML', team: 'Atlanta United FC',
  }, [{ name: 'DC United', price: 1.8, quantity: 10 }]), false);
  assert.equal(prophetXGroupMatches({
    market: 'ML', team: 'Atlanta United FC',
  }, [{ name: 'Atlanta', price: 1.8, quantity: 10 }]), true);
  assert.equal(prophetXGroupMatches({
    market: 'ML', team: 'Draw',
  }, [{ name: 'Tie', price: 1.5, quantity: 5 }]), true);
}

{
  const top = kalshiCatalogTop({
    no_ask_dollars: '0.5800',
    yes_bid_size_fp: '2053.00',
  }, 'no');
  assert.ok(top && top.american < 0);
  assert.equal(top.size, 2053);
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
