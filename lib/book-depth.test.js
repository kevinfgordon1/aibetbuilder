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
  // Novig is keyless now (public v3). Stub the three public calls.
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    if (/\/v3\/public\/catalog\/events\?/.test(url)) {
      return json({ items: [{ eventId: 'ev1', description: 'Louisville @ Ole Miss', status: 'OPEN_PREGAME', league: 'NCAAF' }] });
    }
    if (/\/v3\/public\/catalog\/markets\?event=ev1/.test(url)) {
      return json({ items: [
        { marketId: 'ml', marketType: 'MONEY', status: 'OPEN', strike: '0', outcomes: [{ outcomeId: 'miss', name: 'MISS' }, { outcomeId: 'lou', name: 'LOU' }] },
        { marketId: 't54', marketType: 'TOTAL', status: 'OPEN', strike: '54.5', outcomes: [{ outcomeId: 'o54', name: 'Over 54.5' }, { outcomeId: 'u54', name: 'Under 54.5' }] },
        { marketId: 't55', marketType: 'TOTAL', status: 'OPEN', strike: '55', outcomes: [{ outcomeId: 'o55', name: 'Over 55' }, { outcomeId: 'u55', name: 'Under 55' }] },
      ] });
    }
    if (/\/markets\/t55\/book/.test(url)) {
      return json({ marketId: 't55', seq: 3, orders: { o55: [{ orderId: 'a', price: '0.400', qty: 100 }], u55: [{ orderId: 'b', price: '0.500', qty: 20000 }, { orderId: 'c', price: '0.480', qty: 1000 }] } });
    }
    if (/\/markets\/ml\/book/.test(url)) {
      return json({ marketId: 'ml', seq: 9, orders: { miss: [{ orderId: 'd', price: '0.600', qty: 5000 }], lou: [{ orderId: 'e', price: '0.380', qty: 7000 }] } });
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  const nv = await fetchVenueDepth({
    venue: 'novig',
    market: 'TOT',
    side: 'over',
    line: 55,
    sport: 'americanfootball_ncaaf',
    away: 'Louisville Cardinals',
    home: 'Ole Miss Rebels',
  });
  assert.equal(nv.reason, 'ok');
  // Buying Over 55 takes the Under bids: 1 - 0.50 = 0.50 (-100), 1 - 0.48 = 0.52 (-108).
  assert.deepEqual(nv.levels, [{ american: -100, size: 100 }, { american: -108, size: 5.2 }]);
  assert.ok(calls.every((u) => u.startsWith('https://api.novig.com/v3/public/')));
  const ml = await fetchVenueDepth({
    venue: 'novig',
    market: 'ML',
    team: 'Louisville Cardinals',
    sport: 'americanfootball_ncaaf',
    away: 'Louisville Cardinals',
    home: 'Ole Miss Rebels',
  });
  assert.equal(ml.reason, 'ok');
  assert.deepEqual(ml.levels, [{ american: 150, size: 20 }]);
  // Live (OPEN_INGAME) Novig: the live taker fee c·P·(1−P) rides on the ask.
  // Pregame stays raw (above). Ask 0.50 at c=0.03 → 0.5075 → −103; ML 0.62 → +61 raw, +59.
  {
    const bd = require('./book-depth');
    const mk = { outcomes: [{ outcomeId: 'a' }, { outcomeId: 'b' }] };
    const bk = { orders: { b: [{ price: '0.705', qty: 1500000 }] } };
    assert.deepEqual(bd.novigAsksFromBook(bk, mk, 'a', 0), [{ american: 239, size: 4425 }]);
    assert.deepEqual(bd.novigAsksFromBook(bk, mk, 'a', 0.03), [{ american: 232, size: 4425 }]);
    const live = { status: 'OPEN_INGAME' };
    const pre = { status: 'OPEN_PREGAME' };
    assert.equal(bd.novigLiveFeeRate(pre, { fee: { coefficient: '0.03' } }, {}), 0);
    assert.equal(bd.novigLiveFeeRate(live, { fee: { coefficient: '0.03' } }, {}), 0.03);
    assert.equal(bd.novigLiveFeeRate(live, { fee: { coefficient: '0.06' } }, {}), 0.06);
    assert.equal(bd.novigLiveFeeRate(live, {}, { sport: 'americanfootball_nfl', market: 'ML' }), 0.03);
    assert.equal(bd.novigLiveFeeRate(live, {}, { sport: 'americanfootball_ncaaf', market: 'SPR' }), 0.06);
  }
  global.fetch = realFetch;
  assert.ok(DEPTH_VENUES.has('kalshi'));
  console.log('book-depth.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
