'use strict';

// MLB 1+ HR: ticker/slug/Underdog parsing, player matching, game assembly,
// the cron job (event gating, credits, row shape) and the fetch handler.
const assert = require('node:assert/strict');
const td = require('./player-td.cjs');
const feeds = require('./player-hr-feeds');
const job = require('./player-hr-job');
const { attachNoLadders, createPolyBookLimiter, loadPolymarketNoLadders } = require('./player-td-feeds');

const NOW = Date.parse('2026-09-26T15:00:00Z'); // 11:00 AM ET

// ── Kalshi ticker parsing
{
  const p = td.parseKalshiHrTicker('KXMLBHR-26SEP262140LAASEA-SEAJRODRGUEZ44-1');
  assert.equal(p.market, 'hr');
  assert.equal(p.away, 'LAA');
  assert.equal(p.home, 'SEA');
  assert.equal(p.team, 'SEA');
  assert.equal(p.date, '2026-09-26');
  assert.equal(p.gameKey, 'MLB|LAA|SEA|2026-09-26');
  // 9:40 PM EDT = 01:40Z next day (occurrence_datetime says 04:40Z, 3h late).
  assert.equal(p.commence, '2026-09-27T01:40:00.000Z');
  assert.equal(td.parseKalshiHrTicker('KXMLBHR-26SEP262140LAASEA-SEAJRODRGUEZ44-2'), null, '2+ is ignored');
  assert.equal(td.parseKalshiHrTicker('KXNFLTD-26SEP28PHICHI-CHIDSWIFT4-1'), null);
  const two = td.parseKalshiHrTicker('KXMLBHR-26SEP261910CLEKC-KCBWITT7-1');
  assert.deepEqual([two.away, two.home, two.team], ['CLE', 'KC', 'KC']);
  const az = td.parseKalshiHrTicker('KXMLBHR-26SEP262040AZSD-SDMMACHADO13-1');
  assert.deepEqual([az.away, az.home, az.team], ['AZ', 'SD', 'SD']);
  assert.equal(az.commence, '2026-09-27T00:40:00.000Z');
  // Winter (EST) wall clock converts with a 5h offset.
  assert.equal(td.easternWallClockToIso('2026-12-05', '1910'), '2026-12-06T00:10:00.000Z');
  assert.deepEqual(td.splitMlbTeamCode('HOUATH'), ['HOU', 'ATH']);
  assert.deepEqual(td.splitMlbTeamCode('COLCWS'), ['COL', 'CWS']);
}

// ── Team names and slugs
{
  assert.equal(td.mlbAbbrFromName('St. Louis Cardinals'), 'STL');
  assert.equal(td.mlbAbbrFromName('St Louis Cardinals'), 'STL');
  assert.equal(td.mlbAbbrFromName('Athletics'), 'ATH');
  assert.equal(td.mlbAbbrFromName('Oakland Athletics'), 'ATH');
  assert.equal(td.mlbAbbrFromName('Arizona Diamondbacks'), 'AZ');
  assert.equal(td.mlbAbbrFromName('Chicago White Sox'), 'CWS');
  assert.equal(td.mlbGameKeyFromTeams('Los Angeles Angels', 'Seattle Mariners', '2026-09-27T01:40:00Z'), 'MLB|LAA|SEA|2026-09-26');
  assert.equal(td.pairKeyFromMlbSlug('mlb-cle-kc-2026-09-26').gameKey, 'MLB|CLE|KC|2026-09-26');
  assert.deepEqual(feeds.polymarketHrSlugs([
    { away_team: 'Colorado Rockies', home_team: 'Chicago White Sox', commence_time: '2026-09-26T23:10:00Z' },
    { away_team: 'Arizona Diamondbacks', home_team: 'San Diego Padres', commence_time: '2026-09-27T00:40:00Z' },
  ]), ['mlb-col-cws-2026-09-26', 'mlb-az-sd-2026-09-26']);
}

// ── Name matching: accents, Jr., initials
{
  assert.ok(td.samePlayer('Julio Rodriguez', 'Julio Rodríguez'));
  assert.ok(td.samePlayer('Jose Ramirez', 'José Ramírez'));
  assert.ok(td.samePlayer('Bobby Witt', 'Bobby Witt Jr.'));
  assert.ok(td.samePlayer('Ronald Acuna Jr.', 'Ronald Acuña Jr.'));
  assert.ok(td.samePlayer('C.J. Abrams', 'CJ Abrams'));
  assert.ok(td.samePlayer('Elly De La Cruz', 'Elly de la Cruz'));
  assert.ok(!td.samePlayer('Will Smith', 'Josh Smith'));
  assert.ok(td.commenceCompatible('2026-09-26T17:05:00Z', '2026-09-26T17:05:00.000Z'));
  assert.ok(!td.commenceCompatible('2026-09-26T17:05:00Z', '2026-09-26T23:10:00Z'), 'doubleheader game 2 is a different game');
  assert.ok(td.startsLaterTodayEt('2026-09-27T01:40:00Z', NOW), '9:40 PM ET tonight is today ET');
  assert.ok(!td.startsLaterTodayEt('2026-09-27T17:00:00Z', NOW), 'tomorrow is out');
  assert.ok(!td.startsLaterTodayEt('2026-09-26T14:00:00Z', NOW), 'started is out');
}

// ── Kalshi market → quote (No ask from the Yes bid, fee-inclusive)
const kalshiMarket = (ticker, title, bid, ask, size, extra) => ({
  ticker, title, status: 'active', yes_bid_dollars: bid, yes_ask_dollars: ask, yes_bid_size_fp: size,
  occurrence_datetime: '2026-09-27T04:40:00Z', updated_time: '2026-09-26T14:59:00Z', ...extra,
});
{
  const quotes = feeds.quotesFromKalshiHrMarkets({ markets: [
    kalshiMarket('KXMLBHR-26SEP262140LAASEA-SEAJRODRGUEZ44-1', 'Julio Rodríguez: 1+ home runs?', '0.1200', '0.1600', '1045.00'),
    kalshiMarket('KXMLBHR-26SEP262140LAASEA-SEAJRODRGUEZ44-2', 'Julio Rodríguez: 2+ home runs?', '0.0200', '0.0400', '10.00'),
    kalshiMarket('KXMLBHR-26SEP262140LAASEA-SEACRALEIGH29-1', 'Cal Raleigh: 1+ home runs?', null, '0.2300', null),
    kalshiMarket('KXMLBHR-26SEP262140LAASEA-LAAMTROUT27-1', 'Mike Trout: 1+ home runs?', '0.1300', '0.1700', '413', { status: 'closed' }),
  ] }, NOW);
  assert.equal(quotes.length, 2, '2+ and closed markets drop');
  const julio = quotes[0];
  assert.equal(julio.player, 'Julio Rodríguez');
  assert.equal(julio.team, 'SEA');
  assert.equal(julio.commence, '2026-09-27T01:40:00.000Z');
  assert.equal(julio.noAmerican, td.noAskAmericanFromYesBid(0.12, 0.07));
  assert.equal(julio.noAmerican, -788);
  assert.equal(julio.yesAmerican, td.boardYesAmerican(0.16, 0.07));
  assert.ok(julio.noSize > 900);
  assert.equal(quotes[1].noAmerican, null, 'no Yes bid, no No price');
}

// ── Polymarket US event → quotes (line 1 only, closed skipped)
{
  const event = {
    slug: 'mlb-cle-kc-2026-09-26',
    startTime: '2026-09-26T23:10:00Z',
    teams: [{ id: 3007, name: 'Cleveland Guardians', abbreviation: 'cle' }, { id: 3012, name: 'Kansas City Royals', abbreviation: 'kc' }],
    markets: [
      { sportsMarketType: 'baseball_player_home_runs', line: 1, slug: 'astatc-mlb-cle-kc-2026-09-26-hr-bobwit-gte1', metadata: { playerName: 'Bobby Witt Jr.', teamId: 3012 }, bestBidQuote: { value: '0.1400' }, bestAskQuote: { value: '0.2100' } },
      { sportsMarketType: 'baseball_player_home_runs', line: 2, slug: 'x-gte2', metadata: { playerName: 'Bobby Witt Jr.', teamId: 3012 }, bestBidQuote: { value: '0.0200' }, bestAskQuote: { value: '0.0300' } },
      { sportsMarketType: 'baseball_player_home_runs', line: 1, slug: 'x-closed', closed: true, metadata: { playerName: 'Jo Adell', teamId: 3007 }, bestBidQuote: { value: '0.1000' }, bestAskQuote: { value: '0.1800' } },
      { sportsMarketType: 'baseball_player_hits', line: 1, metadata: { playerName: 'Steven Kwan' }, bestBidQuote: { value: '0.6' }, bestAskQuote: { value: '0.7' } },
    ],
  };
  const quotes = feeds.quotesFromPolymarketHrEvent({ event });
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].team, 'KC');
  assert.equal(quotes[0].gameKey, 'MLB|CLE|KC|2026-09-26');
  assert.equal(quotes[0].noAmerican, td.noAskAmericanFromYesBid(0.14, 0.07));
  assert.equal(quotes[0].slug, 'astatc-mlb-cle-kc-2026-09-26-hr-bobwit-gte1');
}

// ── Underdog ml_player_hr lines (event_ticker is the Kalshi game)
{
  const body = {
    games: [{ id: 144138, full_team_names_title: 'New York Mets @ Washington Nationals', scheduled_at: '2026-09-26T16:35:00Z' }],
    appearances: [{ id: 'a1', match_id: 144138, team_id: 't1' }],
    teams: [{ id: 't1', abbr: 'NYM' }],
    over_under_lines: [{
      stat_value: '0.5',
      over_under: { appearance_stat: { appearance_id: 'a1', stat: 'ml_player_hr' } },
      options: [
        { choice: 'higher', selection_header: 'Juan Soto', event_ticker: 'KXMLBHR-26SEP261235NYMWSH', updated_at: '2026-09-26T14:00:00Z', odds: { prediction: { american: '+426' } } },
        { choice: 'lower', selection_header: 'Juan Soto', event_ticker: 'KXMLBHR-26SEP261235NYMWSH', updated_at: '2026-09-26T14:00:00Z', odds: { prediction: { american: '-667' } } },
      ],
    }, {
      stat_value: '0.5',
      over_under: { appearance_stat: { appearance_id: 'a1', stat: 'hits' } },
      options: [{ choice: 'higher', selection_header: 'Juan Soto', odds: { prediction: { american: '-200' } } }],
    }],
  };
  const quotes = feeds.quotesFromUnderdogHr(body, { now: NOW });
  assert.equal(quotes.length, 1);
  assert.deepEqual(
    [quotes[0].book, quotes[0].player, quotes[0].team, quotes[0].gameKey, quotes[0].yesAmerican, quotes[0].noAmerican],
    ['underdog_predict', 'Juan Soto', 'NYM', 'MLB|NYM|WSH|2026-09-26', 426, -667],
  );
  assert.equal(quotes[0].commence, '2026-09-26T16:35:00Z');
  assert.match(feeds.underdogHrLinesUrl({ base: 'https://x', product: 'fantasy', productExperienceId: 'pe', stateConfigId: 'sc' }), /filter_id=b4110658-5fce-4e94-b25e-c6e3d760e02c.*sport_id=MLB/);
}

// ── Game assembly
const LAA_SEA = {
  id: 'ev-laa-sea',
  away_team: 'Los Angeles Angels',
  home_team: 'Seattle Mariners',
  commence_time: '2026-09-27T01:40:00Z',
  bookmakers: [
    { key: 'draftkings', markets: [{ key: 'batter_home_runs', last_update: '2026-09-26T14:58:00Z', outcomes: [
      { name: 'Over', description: 'Julio Rodriguez', price: 380, point: 0.5 },
      { name: 'Under', description: 'Julio Rodriguez', price: -550, point: 0.5 },
      { name: 'Over', description: 'Julio Rodriguez', price: 2000, point: 1.5 },
      { name: 'Over', description: 'Cal Raleigh', price: 250, point: 0.5 },
      { name: 'Over', description: 'Mike Trout', price: 330, point: 0.5 },
      { name: 'Over', description: 'Luke Raley', price: 600, point: 0.5 },
    ] }] },
    { key: 'fanduel', markets: [{ key: 'batter_home_runs', outcomes: [
      { name: 'Over', description: 'Julio Rodríguez', price: 400, point: 0.5 },
    ] }] },
    { key: 'fliff', markets: [{ key: 'batter_home_runs', outcomes: [{ name: 'Over', description: 'Julio Rodriguez', price: 900, point: 0.5 }] }] },
    { key: 'courtside', markets: [{ key: 'batter_home_runs', outcomes: [{ name: 'Over', description: 'Cal Raleigh', price: 900, point: 0.5 }] }] },
  ],
};
function hrQuote(book, player, no, extra) {
  return {
    book, market: 'hr', player, team: '', away: 'LAA', home: 'SEA', gameKey: 'MLB|LAA|SEA|2026-09-26',
    commence: '2026-09-27T01:40:00.000Z', yesAmerican: 450, noAmerican: no, updatedAt: '2026-09-26T14:59:00Z', ...extra,
  };
}
{
  const quotes = [
    hrQuote('kalshi', 'Julio Rodríguez', -788, { team: 'SEA', ticker: 'KXMLBHR-26SEP262140LAASEA-SEAJRODRGUEZ44-1', noSize: 900, noLevels: [{ american: -788, size: 900 }] }),
    hrQuote('polymarket', 'Julio Rodriguez', -700, { team: 'SEA', slug: 'pm-julio', noSize: 50, noLevels: [{ american: -700, size: 50 }, { american: -760, size: 300 }] }),
    hrQuote('kalshi', 'Cal Raleigh', -367, { team: 'SEA', ticker: 't-cal' }),
    hrQuote('kalshi', 'Mike Trout', null, { team: 'LAA', ticker: 't-trout' }),
    // Doubleheader-style mismatch: same teams and date, first pitch 6 hours off.
    hrQuote('kalshi', 'Luke Raley', -500, { team: 'SEA', commence: '2026-09-26T19:40:00.000Z', ticker: 't-raley' }),
  ];
  const game = job.assembleHrGame(LAA_SEA, quotes, NOW);
  assert.equal(game.sport, 'baseball_mlb');
  assert.equal(game.gameKey, 'MLB|LAA|SEA|2026-09-26');
  const names = game.players.map((p) => p.name);
  assert.deepEqual(names, ['Cal Raleigh', 'Julio Rodriguez'], 'Trout (no book) and Raley (other game) have no fair price');
  const julio = game.players.find((p) => p.name === 'Julio Rodriguez');
  const slot = julio.markets.hr;
  assert.deepEqual(slot.offers.map((o) => [o.book, o.price]).sort(), [['draftkings', 380], ['fanduel', 400]], 'Over 0.5 only; Fliff never an offer');
  assert.equal(slot.opp.book, 'polymarket', 'best No is the highest American');
  assert.equal(slot.opp.price, -700);
  assert.equal(slot.opp.count, 2);
  assert.equal(julio.team, 'SEA');
  assert.deepEqual(slot.opps.map((o) => o.book).sort(), ['kalshi', 'polymarket']);
  assert.ok(slot.opps.every((o) => o.source === 'exchange'), 'HR fair prices are exchange-only (no de-vig)');
  const cal = game.players.find((p) => p.name === 'Cal Raleigh');
  assert.deepEqual(cal.markets.hr.offers.map((o) => o.book), ['draftkings'], 'Courtside never an offer');

  // Only events with an exchange 1+ HR No are worth an Odds API call.
  const other = { id: 'ev-nym-wsh', away_team: 'New York Mets', home_team: 'Washington Nationals', commence_time: '2026-09-26T16:35:00Z' };
  assert.deepEqual(job.eventsWithExchangeHr([LAA_SEA, other], quotes).map((g) => g.id), ['ev-laa-sea']);
  // Ladders only for Kalshi/Polymarket quotes on players a sportsbook prices.
  const needed = job.neededHrLadderQuotes([LAA_SEA], quotes, NOW);
  assert.deepEqual(needed.map((q) => q.ticker || q.slug).sort(), ['KXMLBHR-26SEP262140LAASEA-SEAJRODRGUEZ44-1', 'pm-julio', 't-cal']);
}

// ── Promo legs from a cached MLB row
{
  const quotes = [
    hrQuote('kalshi', 'Julio Rodríguez', -788, { team: 'SEA', noSize: 900, noLevels: [{ american: -788, size: 900 }, { american: -850, size: 2000 }] }),
    hrQuote('polymarket', 'Julio Rodriguez', -700, { team: 'SEA', noSize: 50, noLevels: [{ american: -700, size: 50 }] }),
  ];
  const game = job.assembleHrGame(LAA_SEA, quotes, NOW);
  const rows = [{ event_id: game.eventId, sport: 'baseball_mlb', away_team: game.away, home_team: game.home, commence_time: game.commence_time, data: game }];
  const props = td.playerTdsFromCacheRows(rows);
  assert.equal(props[0].sport, 'baseball_mlb');
  const legs = td.playerTdLegsForBook(props, 'draftkings', { now: NOW });
  assert.equal(legs.length, 1);
  const leg = legs[0];
  assert.equal(leg.name, 'Julio Rodriguez 1+ HR');
  assert.equal(leg.market, 'HR');
  assert.equal(leg.playerProp, 'hr');
  assert.equal(leg.playerTd, true);
  assert.equal(leg.dk, 380);
  assert.equal(leg.bestOpp, -700);
  assert.equal(leg.bestOppBook, 'polymarket');
  assert.equal(leg.bestOppName, 'Julio Rodriguez No 1+ HR');
  assert.equal(leg.game, 'Los Angeles Angels @ Seattle Mariners');
  assert.equal(leg.sport, 'baseball_mlb');
  assert.deepEqual(leg.bestOppLevels.map((l) => l.american), [-700, -788, -850], 'merged Kalshi + Polymarket ladder');
  // Matching books = Kalshi only → Kalshi No prices the leg.
  const kOnly = td.playerTdLegsForBook(props, 'draftkings', { now: NOW, matchingBooks: ['kalshi', 'draftkings'] });
  assert.equal(kOnly[0].bestOpp, -788);
  assert.deepEqual(kOnly[0].bestOppLevels.map((l) => l.american), [-788, -850]);
  // Sportsbooks only → no exchange fair price → no leg.
  assert.equal(td.playerTdLegsForBook(props, 'draftkings', { now: NOW, matchingBooks: ['draftkings', 'fanduel'] }).length, 0);
  // Sport filter: NFL-only Promo does not get HR legs.
  assert.equal(td.playerTdLegsForBook(props, 'draftkings', { now: NOW, sportFilter: ['americanfootball_nfl'] }).length, 0);
  assert.equal(td.playerTdLegsForBook(props, 'draftkings', { now: NOW, sportFilter: ['baseball_mlb'] }).length, 1);
  // Fliff never a leg; a started game never a leg.
  assert.equal(td.playerTdLegsForBook(props, 'fliff', { now: NOW }).length, 0);
  assert.equal(td.playerTdLegsForBook(props, 'draftkings', { now: Date.parse('2026-09-27T02:00:00Z') }).length, 0);

  // Correlation: same game conflicts (HR vs HR and HR vs that game's ML);
  // another game does not. NFL and MLB legs with lookalike keys never collide.
  const ml = { name: 'Seattle Mariners ML', game: 'Los Angeles Angels @ Seattle Mariners' };
  const other = { ...leg, name: 'Cal Raleigh 1+ HR' };
  const elsewhere = { ...leg, name: 'Juan Soto 1+ HR', game: 'New York Mets @ Washington Nationals', tdGameKey: 'MLB|NYM|WSH|2026-09-26' };
  assert.ok(td.promoLegsCorrelate(leg, other));
  assert.ok(td.promoLegsCorrelate(leg, ml));
  assert.ok(!td.promoLegsCorrelate(leg, elsewhere));
  const nflLeg = { playerTd: true, tdGameKey: 'LAA|SEA|2026-09-26', game: 'x @ y' };
  assert.ok(!td.promoLegsCorrelate(leg, nflLeg));
}

(async () => {
  // ── attachNoLadders drops an empty Kalshi book (scratched / pulled market)
  {
    const quotes = [
      hrQuote('kalshi', 'A One', -500, { ticker: 'K-A-1', noSize: 5, noLevels: [{ american: -500, size: 5 }] }),
      hrQuote('kalshi', 'B Two', -400, { ticker: 'K-B-1' }),
    ];
    const fetchFn = async (url) => ({
      status: 200,
      json: async () => ({ orderbooks: [
        { ticker: 'K-A-1', orderbook_fp: { yes_dollars: [['0.1000', '100'], ['0.0900', '50']] } },
        { ticker: 'K-B-1', orderbook_fp: { yes_dollars: [] } },
      ] }),
    });
    const stats = await attachNoLadders(quotes, { fetchFn, sleepFn: async () => {}, dropEmptyKalshi: true });
    assert.equal(stats.kalshiEmpty, 1);
    assert.equal(quotes[0].noLevels.length, 2);
    assert.equal(quotes[1].noAmerican, null, 'empty book → no fair price');
  }

  // ── Shared Polymarket limiter: a 429 in one caller stops the other.
  {
    const limiter = createPolyBookLimiter({ gapMs: 0, maxBooks: 16 });
    let calls = 0;
    const throttle = async () => { calls += 1; return { status: 429, headers: { get: () => '1' } }; };
    await loadPolymarketNoLadders(['a', 'b', 'c'], { fetchFn: throttle, sleepFn: async () => {}, polyLimiter: limiter });
    await loadPolymarketNoLadders(['d', 'e'], { fetchFn: throttle, sleepFn: async () => {}, polyLimiter: limiter });
    assert.equal(calls, 1, 'one 429 stops every caller on the limiter');
    const capped = createPolyBookLimiter({ gapMs: 0, maxBooks: 3 });
    let ok = 0;
    const good = async () => { ok += 1; return { status: 200, json: async () => ({ marketData: { bids: [{ px: { value: '0.1' }, qty: '10' }] } }) }; };
    await loadPolymarketNoLadders(['a', 'b'], { fetchFn: good, sleepFn: async () => {}, polyLimiter: capped });
    await loadPolymarketNoLadders(['c', 'd'], { fetchFn: good, sleepFn: async () => {}, polyLimiter: capped });
    assert.equal(ok, 3, 'book cap is shared');
  }

  // ── runPlayerHrJob: today's games only, gated on exchange quotes, credits summed
  {
    const logs = [];
    const original = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    const seen = [];
    let listCalls = 0;
    const fetchImpl = async (url) => {
      assert.ok(String(url).includes('secret-key'));
      if (/\/events\?apiKey=/.test(String(url))) {
        // Free slate call fails here; the job falls back to odds_cache.
        listCalls += 1;
        return { ok: false, status: 500, headers: { get: (n) => (n === 'x-requests-last' ? '0' : null) }, json: async () => ({}) };
      }
      seen.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: (n) => ({ 'x-requests-used': '500', 'x-requests-remaining': '999', 'x-requests-last': '2' })[n] || null },
        json: async () => ({ ...LAA_SEA }),
      };
    };
    const cached = [
      { id: 'ev-laa-sea', away_team: LAA_SEA.away_team, home_team: LAA_SEA.home_team, commence_time: LAA_SEA.commence_time },
      { id: 'ev-nym-wsh', away_team: 'New York Mets', home_team: 'Washington Nationals', commence_time: '2026-09-26T16:35:00Z' },
      { id: 'ev-started', away_team: 'Pittsburgh Pirates', home_team: 'Detroit Tigers', commence_time: '2026-09-26T14:10:00Z' },
      { id: 'ev-tomorrow', away_team: 'Los Angeles Angels', home_team: 'Seattle Mariners', commence_time: '2026-09-27T20:10:00Z' },
    ];
    const upserts = [];
    const deletes = [];
    const supabaseClient = {
      from(table) {
        return {
          select() { return { eq: () => ({ maybeSingle: async () => ({ data: { data: cached }, error: null }) }) }; },
          upsert: async (row, opts) => { upserts.push({ table, row, opts }); return { error: null }; },
          delete() { return { eq: (c, v) => ({ lt: async (c2, v2) => { deletes.push([table, c, v, c2, v2]); return { error: null }; } }) }; },
        };
      },
    };
    let gamesSeen = null;
    const loadExchanges = async (games) => {
      gamesSeen = games.map((g) => g.id);
      return {
        quotes: [hrQuote('kalshi', 'Julio Rodríguez', -788, { team: 'SEA', ticker: 'KXMLBHR-26SEP262140LAASEA-SEAJRODRGUEZ44-1' })],
        counts: { kalshi: 1, polymarket: 0, underdog: 0 },
      };
    };
    let attachArgs = null;
    const attachLadders = async (needed, deps) => { attachArgs = { needed, deps }; return { attached: 0 }; };
    const result = await job.runPlayerHrJob({ apiKey: 'secret-key', fetchImpl, supabaseClient, now: NOW, loadExchanges, attachLadders, ladderDeps: { polyLimiter: 'shared' } });
    console.log = original;
    assert.equal(result.ok, true);
    assert.deepEqual(gamesSeen, ['ev-nym-wsh', 'ev-laa-sea'], 'later-today games only');
    assert.equal(result.gamesToday, 2);
    assert.equal(result.events, 1, 'NYM @ WSH has no exchange HR market → no credit spent');
    assert.equal(seen.length, 1);
    assert.match(seen[0], /sports\/baseball_mlb\/events\/ev-laa-sea\/odds\/.*regions=us,us2&markets=batter_home_runs&/);
    assert.equal(listCalls, 1);
    assert.equal(result.creditsUsed, 2, 'free /events adds 0');
    assert.equal(result.oddsApiCalls, 2);
    assert.equal(result.oddsCallsBilled, 1);
    assert.equal(result.usage.requestsUsed, '500');
    assert.equal(result.players, 1);
    assert.equal(upserts.length, 1);
    const row = upserts[0].row;
    assert.equal(upserts[0].table, 'player_prop_cache');
    assert.equal(row.sport, 'baseball_mlb');
    assert.deepEqual(row.markets, ['batter_home_runs']);
    assert.equal(row.data.players[0].markets.hr.opp.price, -788);
    assert.ok(!row.data.players[0].markets.anytime, 'MLB rows never carry TD slots');
    assert.deepEqual(deletes, [['player_prop_cache', 'sport', 'baseball_mlb', 'commence_time', new Date(NOW).toISOString()]], 'cleanup is MLB-only');
    assert.equal(attachArgs.deps.dropEmptyKalshi, true);
    assert.equal(attachArgs.deps.polyLimiter, 'shared');
    assert.ok(!JSON.stringify(result).includes('secret-key'));
    assert.ok(logs.some((l) => l.includes('"requestsLast":"2"')), 'usage headers are logged');
  }

  // ── /events (free) is the slate when it answers
  {
    const original = console.log;
    console.log = () => {};
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(String(url));
      const list = /\/events\?apiKey=/.test(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: (n) => (n === 'x-requests-last' ? (list ? '0' : '2') : null) },
        json: async () => (list ? [{ id: 'ev-laa-sea', away_team: LAA_SEA.away_team, home_team: LAA_SEA.home_team, commence_time: LAA_SEA.commence_time }] : { ...LAA_SEA }),
      };
    };
    const result = await job.runPlayerHrJob({
      apiKey: 'k', fetchImpl, supabaseClient: null, now: NOW, attachLadders: null,
      loadExchanges: async () => ({ quotes: [hrQuote('kalshi', 'Cal Raleigh', -367, { team: 'SEA' })], counts: null }),
    });
    console.log = original;
    assert.equal(result.gamesToday, 1);
    assert.equal(result.events, 1);
    assert.equal(result.creditsUsed, 2);
    assert.equal(result.games[0].players[0].name, 'Cal Raleigh');
    assert.equal(urls.length, 2);
  }

  // ── Missing key
  assert.equal((await job.runPlayerHrJob({})).ok, false);

  // ── /api/fetch-player-props runs both jobs and reports MLB under `mlb`
  {
    // odds-shared builds a Supabase client at require time; stub the module.
    const sharedPath = require.resolve('./odds-shared');
    require.cache[sharedPath] = { id: sharedPath, filename: sharedPath, loaded: true, exports: { supabase: null, applyBookAdjustments: (x) => x } };
    const handler = require('../api/fetch-player-props');
    const res = () => {
      const out = { code: null, body: null };
      return { out, status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
    };
    const calls = [];
    const runNfl = async (a) => { calls.push(['nfl', a.ladderDeps && a.ladderDeps.polyLimiter]); return { ok: true, sport: 'americanfootball_nfl', events: 3, upserts: 3, errors: [], usage: null }; };
    const runMlb = async (a) => { calls.push(['mlb', a.ladderDeps && a.ladderDeps.polyLimiter]); return { ok: true, sport: 'baseball_mlb', gamesToday: 5, events: 4, upserts: 4, players: 22, creditsUsed: 8, oddsApiCalls: 4, errors: [] }; };
    const r1 = res();
    await handler({}, r1, { apiKey: 'k', supabaseClient: null, runNfl, runMlb });
    assert.equal(r1.out.code, 200);
    assert.equal(r1.out.body.events, 3);
    assert.equal(r1.out.body.mlb.players, 22);
    assert.equal(r1.out.body.mlb.creditsUsed, 8);
    assert.ok(calls[0][1] && calls[0][1] === calls[1][1], 'both jobs share one Polymarket limiter');
    // MLB throwing does not fail the NFL cron.
    const r2 = res();
    await handler({}, r2, { apiKey: 'k', supabaseClient: null, runNfl, runMlb: async () => { throw new Error('boom apiKey=abc'); } });
    assert.equal(r2.out.code, 200);
    assert.equal(r2.out.body.mlb.ok, false);
    assert.ok(!r2.out.body.mlb.error.includes('abc'));
  }

  console.log('player-hr.test.js ok');
})().catch((err) => { console.error(err); process.exit(1); });
