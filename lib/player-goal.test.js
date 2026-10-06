'use strict';

// NHL 1+ goal (anytime goal scorer): ticker/slug/Underdog parsing, team
// names, sportsbook offers, game assembly, Promo legs and the cron job.
const assert = require('node:assert/strict');
const td = require('./player-td.cjs');
const feeds = require('./player-goal-feeds');
const job = require('./player-goal-job');

const NOW = Date.parse('2026-10-06T16:00:00Z'); // 12:00 PM ET

// ── Kalshi ticker parsing (real tickers from the 2026-10-06 slate)
{
  const p = td.parseKalshiNhlGoalTicker('KXNHLGOAL-26OCT06FLALA-LATMOORE12-1');
  assert.deepEqual([p.market, p.away, p.home, p.team, p.date], ['goal', 'FLA', 'LA', 'LA', '2026-10-06']);
  assert.equal(p.gameKey, 'NHL|FLA|LA|2026-10-06');
  assert.equal(p.commence, null, 'Kalshi NHL tickers carry no clock');
  assert.equal(td.parseKalshiNhlGoalTicker('KXNHLGOAL-26OCT06FLALA-LATMOORE12-2'), null, '2+ is ignored');
  assert.equal(td.parseKalshiNhlGoalTicker('KXMLBHR-26SEP262140LAASEA-SEAJRODRGUEZ44-1'), null);
  const nj = td.parseKalshiNhlGoalTicker('KXNHLGOAL-26OCT06UTANJ-NJJHUGHES86-1');
  assert.deepEqual([nj.away, nj.home, nj.team], ['UTA', 'NJ', 'NJ']);
  const fla = td.parseKalshiNhlGoalTicker('KXNHLGOAL-26OCT06FLALA-FLAMTKACHUK19-1');
  assert.equal(fla.team, 'FLA', 'longest club code wins the player prefix');
  assert.deepEqual(td.splitNhlTeamCode('VGKSEA'), ['VGK', 'SEA']);
  assert.deepEqual(td.splitNhlTeamCode('SJSTL'), ['SJ', 'STL']);
  assert.deepEqual(td.splitNhlTeamCode('NYINYR'), ['NYI', 'NYR']);
}

// ── Team names and Polymarket US slugs
{
  assert.equal(td.nhlAbbrFromName('Montréal Canadiens'), 'MTL');
  assert.equal(td.nhlAbbrFromName('St Louis Blues'), 'STL');
  assert.equal(td.nhlAbbrFromName('St. Louis Blues'), 'STL');
  assert.equal(td.nhlAbbrFromName('Utah Mammoth'), 'UTA');
  assert.equal(td.nhlAbbrFromName('Utah Hockey Club'), 'UTA');
  assert.equal(td.nhlAbbrFromName('Los Angeles Kings'), 'LA');
  assert.equal(td.nhlAbbrFromName('LAK'), 'LA');
  assert.equal(td.nhlAbbrFromName('Vegas Golden Knights'), 'VGK');
  assert.equal(td.nhlAbbrFromName('Los Angeles Rams'), '', 'NFL club is not an NHL club');
  assert.equal(td.nhlGameKeyFromTeams('Florida Panthers', 'Los Angeles Kings', '2026-10-07T02:00:00Z'), 'NHL|FLA|LA|2026-10-06', '10 PM ET is the ET date');
  assert.equal(td.pairKeyFromNhlSlug('nhl-car-mon-2026-10-06').gameKey, 'NHL|CAR|MTL|2026-10-06');
  assert.equal(td.pairKeyFromNhlSlug('nhl-veg-sea-2026-10-06').gameKey, 'NHL|VGK|SEA|2026-10-06');
  assert.deepEqual(feeds.polymarketGoalSlugs([
    { away_team: 'Carolina Hurricanes', home_team: 'Montréal Canadiens', commence_time: '2026-10-06T23:00:00Z' },
    { away_team: 'Nashville Predators', home_team: 'Toronto Maple Leafs', commence_time: '2026-10-06T23:00:00Z' },
    { away_team: 'Pittsburgh Penguins', home_team: 'Washington Capitals', commence_time: '2026-10-07T23:30:00Z' },
    { away_team: 'Florida Panthers', home_team: 'Los Angeles Kings', commence_time: '2026-10-07T02:00:00Z' },
  ]), ['nhl-car-mon-2026-10-06', 'nhl-nas-tor-2026-10-06', 'nhl-pit-was-2026-10-07', 'nhl-fla-la-2026-10-06']);
}

// ── Kalshi market → quote
{
  const quotes = feeds.quotesFromKalshiGoalMarkets({ markets: [
    { ticker: 'KXNHLGOAL-26OCT06FLALA-LATMOORE12-1', title: 'Trevor Moore: 1+ goals', status: 'active', yes_bid_dollars: '0.1700', yes_ask_dollars: '0.2000', yes_bid_size_fp: '82.00', updated_time: '2026-10-06T14:05:00Z' },
    { ticker: 'KXNHLGOAL-26OCT06FLALA-LATMOORE12-2', title: 'Trevor Moore: 2+ goals', status: 'active', yes_bid_dollars: '0.0100', yes_ask_dollars: '0.0300' },
    { ticker: 'KXNHLGOAL-26OCT06FLALA-LAQBYFIELD55-1', title: 'Quinton Byfield: 1+ goals', status: 'active', yes_bid_dollars: null, yes_ask_dollars: '0.2500' },
  ] }, NOW);
  assert.equal(quotes.length, 2);
  const moore = quotes[0];
  assert.deepEqual([moore.book, moore.market, moore.player, moore.team, moore.gameKey], ['kalshi', 'goal', 'Trevor Moore', 'LA', 'NHL|FLA|LA|2026-10-06']);
  assert.equal(moore.noAmerican, -525, 'No ask 0.83 + 7% fee');
  assert.ok(moore.yesAmerican > 300);
  assert.equal(quotes[1].noAmerican, null, 'no Yes bid → no No');
}

// ── Polymarket US event → quotes (hockey_player_goals line 1 only)
{
  const quotes = feeds.quotesFromPolymarketGoalEvent({ event: {
    slug: 'nhl-fla-la-2026-10-06',
    startTime: '2026-10-07T02:00:00Z',
    teams: [{ id: 1491, abbreviation: 'fla', displayAbbreviation: 'FLA', name: 'Panthers' }, { id: 1509, abbreviation: 'la', displayAbbreviation: 'LAK', name: 'Kings' }],
    markets: [
      { sportsMarketType: 'hockey_player_goals', line: 1, metadata: { playerName: 'Sam Reinhart', teamId: 1491 }, bestAskQuote: { value: '0.3600' }, bestBidQuote: { value: '0.3300' }, slug: 'astatc-samrei-gte1', active: true, closed: false },
      { sportsMarketType: 'hockey_player_goals', line: 2, metadata: { playerName: 'Sam Reinhart', teamId: 1491 }, bestAskQuote: { value: '0.0600' }, bestBidQuote: { value: '0.0400' } },
      { sportsMarketType: 'hockey_player_points', line: 1, metadata: { playerName: 'Adrian Kempe', teamId: 1509 }, bestAskQuote: { value: '0.6' }, bestBidQuote: { value: '0.58' } },
      { sportsMarketType: 'hockey_player_goals', line: 1, metadata: { playerName: 'Adrian Kempe', teamId: 1509 }, bestAskQuote: { value: '0.3400' }, bestBidQuote: { value: '0.3300' }, slug: 'astatc-adrkem-gte1', closed: true },
    ],
  } });
  assert.equal(quotes.length, 1);
  assert.deepEqual([quotes[0].player, quotes[0].team, quotes[0].gameKey, quotes[0].slug], ['Sam Reinhart', 'FLA', 'NHL|FLA|LA|2026-10-06', 'astatc-samrei-gte1']);
  assert.equal(quotes[0].commence, '2026-10-07T02:00:00Z');
  assert.ok(quotes[0].noAmerican < 0);
}

// ── Underdog phone lines (player_goals 0.5, Kalshi event ticker)
{
  const body = {
    games: [{ id: 201184, full_team_names_title: 'Ottawa Senators @ Detroit Red Wings', scheduled_at: '2026-10-06T23:00:00Z' }],
    appearances: [{ id: 'app-1', match_id: 201184, team_id: 'det' }],
    teams: [{ id: 'det', abbr: 'DET' }],
    over_under_lines: [
      { stat_value: '0.5', over_under: { appearance_stat: { stat: 'player_goals', appearance_id: 'app-1' } }, options: [
        { choice: 'higher', selection_header: 'Alex DeBrincat', event_ticker: 'KXNHLGOAL-26OCT06OTTDET', odds: { prediction: { american: '+133' } }, updated_at: '2026-10-06T14:12:18Z' },
        { choice: 'lower', selection_header: 'Alex DeBrincat', event_ticker: 'KXNHLGOAL-26OCT06OTTDET', odds: { prediction: { american: '-170' } }, updated_at: '2026-10-06T12:23:34Z' },
      ] },
      { stat_value: '1.5', over_under: { appearance_stat: { stat: 'player_goals', appearance_id: 'app-1' } }, options: [
        { choice: 'higher', selection_header: 'Alex DeBrincat', event_ticker: 'KXNHLGOAL-26OCT06OTTDET', odds: { prediction: { american: '+900' } } },
      ] },
    ],
  };
  const quotes = feeds.quotesFromUnderdogGoals(body, { now: NOW });
  assert.equal(quotes.length, 1);
  assert.deepEqual([quotes[0].book, quotes[0].player, quotes[0].team, quotes[0].gameKey, quotes[0].yesAmerican, quotes[0].noAmerican],
    ['underdog_predict', 'Alex DeBrincat', 'DET', 'NHL|OTT|DET|2026-10-06', 133, -170]);
  assert.match(feeds.underdogGoalLinesUrl({ base: 'https://u', product: 'fantasy', productExperienceId: 'pe', stateConfigId: 'sc' }), /filter_id=dce304af-88e9-4ce0-b8ab-235a9d3d86fa.*sport_id=NHL/);
}

// ── Sportsbook offers and game assembly
const FLA_LA = {
  id: 'ev-fla-la',
  away_team: 'Florida Panthers',
  home_team: 'Los Angeles Kings',
  commence_time: '2026-10-07T02:00:00Z',
  bookmakers: [
    { key: 'draftkings', markets: [{ key: 'player_goal_scorer_anytime', last_update: '2026-10-06T15:58:00Z', outcomes: [
      { name: 'Yes', description: 'Sam Reinhart', price: 175 },
      { name: 'Yes', description: 'Trevor Moore', price: 300 },
    ] }] },
    { key: 'fanduel', markets: [
      { key: 'player_goal_scorer_anytime', outcomes: [{ name: 'Yes', description: 'Sam Reinhart', price: 170 }] },
      { key: 'player_goals', outcomes: [
        { name: 'Over', description: 'Sam Reinhart', price: 190, point: 0.5 },
        { name: 'Over', description: 'Trevor Moore', price: 310, point: 0.5 },
        { name: 'Under', description: 'Trevor Moore', price: -450, point: 0.5 },
        { name: 'Over', description: 'Trevor Moore', price: 1500, point: 1.5 },
      ] },
    ] },
    { key: 'fliff', markets: [{ key: 'player_goal_scorer_anytime', outcomes: [{ name: 'Yes', description: 'Sam Reinhart', price: 400 }] }] },
    { key: 'courtside', markets: [{ key: 'player_goal_scorer_anytime', outcomes: [{ name: 'Yes', description: 'Trevor Moore', price: 600 }] }] },
  ],
};
function goalQuote(book, player, no, extra) {
  return {
    book, market: 'goal', player, team: '', away: 'FLA', home: 'LA', gameKey: 'NHL|FLA|LA|2026-10-06',
    commence: null, yesAmerican: 200, noAmerican: no, updatedAt: '2026-10-06T15:59:00Z', ...extra,
  };
}
{
  const offers = job.sportsbookGoalOffers(FLA_LA).map((o) => [o.book, o.player, o.price]);
  assert.deepEqual(offers, [
    ['draftkings', 'Sam Reinhart', 175],
    ['draftkings', 'Trevor Moore', 300],
    ['fanduel', 'Sam Reinhart', 170],
    ['fanduel', 'Trevor Moore', 310],
  ], 'anytime Yes wins per book; Over 0.5 fills in; Under / 2+ / Fliff / Courtside never offers');

  const quotes = [
    goalQuote('kalshi', 'Sam Reinhart', -260, { team: 'FLA', ticker: 'KXNHLGOAL-26OCT06FLALA-FLASREINHART13-1', noSize: 500, noLevels: [{ american: -260, size: 500 }, { american: -280, size: 900 }] }),
    goalQuote('polymarket', 'Sam Reinhart', -240, { team: 'FLA', slug: 'pm-reinhart', commence: '2026-10-07T02:00:00Z', noSize: 40, noLevels: [{ american: -240, size: 40 }] }),
    goalQuote('underdog_predict', 'Sam Reinhart', -230, { team: 'FLA', yesAmerican: 160, commence: '2026-10-07T02:00:00Z' }),
    goalQuote('kalshi', 'Trevor Moore', -525, { team: 'LA', ticker: 'KXNHLGOAL-26OCT06FLALA-LATMOORE12-1' }),
    goalQuote('kalshi', 'Anze Kopitar', null, { team: 'LA', ticker: 't-kopitar' }),
    // Same name on another game is never this game's fair price.
    goalQuote('kalshi', 'Sam Reinhart', -100, { gameKey: 'NHL|CAR|MTL|2026-10-06' }),
  ];
  const game = job.assembleGoalGame(FLA_LA, quotes, NOW);
  assert.equal(game.sport, 'icehockey_nhl');
  assert.equal(game.gameKey, 'NHL|FLA|LA|2026-10-06');
  assert.deepEqual(game.players.map((p) => p.name), ['Sam Reinhart', 'Trevor Moore']);
  const sam = game.players[0].markets.goal;
  assert.deepEqual(sam.offers.map((o) => [o.book, o.price]).sort(), [['draftkings', 175], ['fanduel', 170], ['underdog_predict', 160]]);
  assert.equal(sam.opp.book, 'underdog_predict', 'best No is the highest American');
  assert.equal(sam.opp.price, -230);
  assert.equal(sam.opp.count, 3);
  assert.ok(sam.opps.every((o) => o.source === 'exchange'), 'NHL goal fair prices are exchange-only');
  assert.equal(game.players[0].team, 'FLA');

  // Only events with an exchange 1+ goal No are worth an Odds API call.
  const other = { id: 'ev-car-mtl', away_team: 'Carolina Hurricanes', home_team: 'Montréal Canadiens', commence_time: '2026-10-06T23:00:00Z' };
  const third = { id: 'ev-nsh-tor', away_team: 'Nashville Predators', home_team: 'Toronto Maple Leafs', commence_time: '2026-10-06T23:00:00Z' };
  assert.deepEqual(job.eventsWithExchangeGoal([FLA_LA, other, third], quotes).map((g) => g.id), ['ev-fla-la', 'ev-car-mtl']);
  const needed = job.neededGoalLadderQuotes([FLA_LA], quotes, NOW);
  assert.deepEqual(needed.map((q) => q.ticker || q.slug).sort(), ['KXNHLGOAL-26OCT06FLALA-FLASREINHART13-1', 'KXNHLGOAL-26OCT06FLALA-LATMOORE12-1', 'pm-reinhart']);

  // ── Promo legs from the cached NHL row
  const rows = [{ event_id: game.eventId, sport: 'icehockey_nhl', away_team: game.away, home_team: game.home, commence_time: game.commence_time, data: game }];
  const props = td.playerTdsFromCacheRows(rows);
  const legs = td.playerTdLegsForBook(props, 'draftkings', { now: NOW });
  assert.deepEqual(legs.map((l) => [l.name, l.dk, l.market, l.playerProp, l.bestOpp]).sort(), [
    ['Sam Reinhart 1+ Goal', 175, 'GOAL', 'goal', -230],
    ['Trevor Moore 1+ Goal', 300, 'GOAL', 'goal', -525],
  ]);
  const samLeg = legs.find((l) => l.name === 'Sam Reinhart 1+ Goal');
  assert.equal(samLeg.playerTd, true);
  assert.equal(samLeg.sport, 'icehockey_nhl');
  assert.equal(samLeg.game, 'Florida Panthers @ Los Angeles Kings');
  assert.equal(samLeg.bestOppName, 'Sam Reinhart No 1+ Goal');
  assert.equal(samLeg.tdGameKey, 'NHL|FLA|LA|2026-10-06');
  // Matching books = Kalshi + Polymarket → merged No ladder for the $500 blend.
  const kp = td.playerTdLegsForBook(props, 'draftkings', { now: NOW, matchingBooks: ['kalshi', 'polymarket', 'draftkings'] });
  const kpSam = kp.find((l) => l.name === 'Sam Reinhart 1+ Goal');
  assert.equal(kpSam.bestOpp, -240);
  assert.deepEqual(kpSam.bestOppLevels.map((l) => l.american), [-240, -260, -280]);
  // Sportsbooks only → no exchange fair price → no leg.
  assert.equal(td.playerTdLegsForBook(props, 'draftkings', { now: NOW, matchingBooks: ['draftkings'] }).length, 0);
  // Sport filter scoping.
  assert.equal(td.playerTdLegsForBook(props, 'draftkings', { now: NOW, sportFilter: ['baseball_mlb'] }).length, 0);
  assert.equal(td.playerTdLegsForBook(props, 'draftkings', { now: NOW, sportFilter: ['icehockey_nhl'] }).length, 2);
  // Fliff never a leg; puck drop passed → no leg.
  assert.equal(td.playerTdLegsForBook(props, 'fliff', { now: NOW }).length, 0);
  assert.equal(td.playerTdLegsForBook(props, 'draftkings', { now: Date.parse('2026-10-07T02:30:00Z') }).length, 0);
  // Underdog is a leg book too (phone Yes price).
  const ud = td.playerTdLegsForBook(props, 'underdog_predict', { now: NOW });
  assert.deepEqual(ud.map((l) => [l.name, l.dk]), [['Sam Reinhart 1+ Goal', 160]]);
  // Correlation: same game conflicts; the game's ML conflicts too.
  assert.ok(td.promoLegsCorrelate(samLeg, legs.find((l) => l.name === 'Trevor Moore 1+ Goal')));
  assert.ok(td.promoLegsCorrelate(samLeg, { name: 'Los Angeles Kings ML', game: 'Florida Panthers @ Los Angeles Kings' }));
  assert.ok(!td.promoLegsCorrelate(samLeg, { playerTd: true, tdGameKey: 'NHL|CAR|MTL|2026-10-06', game: 'Carolina Hurricanes @ Montréal Canadiens' }));
}

(async () => {
  // ── runPlayerGoalJob: today's games only, gated on exchange quotes
  {
    const original = console.log;
    console.log = () => {};
    const seen = [];
    const fetchImpl = async (url) => {
      const list = /\/events\?apiKey=/.test(String(url));
      if (!list) seen.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: (n) => (n === 'x-requests-last' ? (list ? '0' : '4') : null) },
        json: async () => (list
          ? [
            { id: 'ev-fla-la', away_team: FLA_LA.away_team, home_team: FLA_LA.home_team, commence_time: FLA_LA.commence_time },
            { id: 'ev-car-mtl', away_team: 'Carolina Hurricanes', home_team: 'Montréal Canadiens', commence_time: '2026-10-06T23:00:00Z' },
            { id: 'ev-started', away_team: 'Ottawa Senators', home_team: 'Detroit Red Wings', commence_time: '2026-10-06T15:00:00Z' },
            { id: 'ev-tomorrow', away_team: 'Pittsburgh Penguins', home_team: 'Washington Capitals', commence_time: '2026-10-07T23:30:00Z' },
          ]
          : { ...FLA_LA }),
      };
    };
    const upserts = [];
    const deletes = [];
    const supabaseClient = {
      from(table) {
        return {
          upsert: async (row, opts) => { upserts.push({ table, row, opts }); return { error: null }; },
          delete() { return { eq: (c, v) => ({ lt: async (c2, v2) => { deletes.push([table, c, v, c2, v2]); return { error: null }; } }) }; },
        };
      },
    };
    let gamesSeen = null;
    const result = await job.runPlayerGoalJob({
      apiKey: 'secret-key', fetchImpl, supabaseClient, now: NOW, attachLadders: null,
      loadExchanges: async (games) => {
        gamesSeen = games.map((g) => g.id);
        return { quotes: [goalQuote('kalshi', 'Sam Reinhart', -260, { team: 'FLA' })], counts: { kalshi: 1, polymarket: 0, underdog: 0 } };
      },
    });
    console.log = original;
    assert.equal(result.ok, true);
    assert.equal(result.sport, 'icehockey_nhl');
    assert.deepEqual(gamesSeen, ['ev-car-mtl', 'ev-fla-la'], 'later-today games only');
    assert.equal(result.events, 1, 'CAR @ MTL has no exchange goal market → no credit spent');
    assert.equal(seen.length, 1);
    assert.match(seen[0], /sports\/icehockey_nhl\/events\/ev-fla-la\/odds\/.*regions=us,us2&markets=player_goal_scorer_anytime,player_goals&/);
    assert.equal(result.creditsUsed, 4);
    assert.equal(upserts.length, 1);
    const row = upserts[0].row;
    assert.equal(row.sport, 'icehockey_nhl');
    assert.deepEqual(row.markets, ['player_goal_scorer_anytime', 'player_goals']);
    assert.equal(row.data.players[0].markets.goal.opp.price, -260);
    assert.deepEqual(deletes, [['player_prop_cache', 'sport', 'icehockey_nhl', 'commence_time', new Date(NOW).toISOString()]], 'cleanup is NHL-only');
    assert.ok(!JSON.stringify(result).includes('secret-key'));
  }
  assert.equal((await job.runPlayerGoalJob({})).ok, false, 'missing key');
  console.log('player-goal.test.js ok');
})().catch((err) => { console.error(err); process.exit(1); });
