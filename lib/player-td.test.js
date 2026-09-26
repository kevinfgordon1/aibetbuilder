'use strict';

const assert = require('node:assert/strict');
const {
  normalizePlayerName,
  samePlayer,
  samePlayerInGame,
  parseKalshiTdTicker,
  pairKeyFromSlug,
  slugFromGameKey,
  teamsFromKalshiGameToken,
  gameKeyFromTeams,
  noAskAmericanFromYesBid,
  fairYesAmericanFromNo,
  devigTwoWay,
  bestAmericanQuote,
  boardYesAmerican,
  promoLegsCorrelate,
  boardFromQuotes,
  playerTdLegsForBook,
  kickoffInPlayerTdWindow,
  selectPlayerTdQuotes,
  ENABLED_TD_MARKETS,
  PLAYER_TD_LOOKAHEAD_MS,
  TAKER_FEE_RATE,
} = require('./player-td');
const { quotesFromKalshiMarkets, quotesFromPolymarketEvent, quotesFromUnderdogTd } = require('./player-td-feeds');
const { assemblePropGame, propEventUrl, selectPropEvents, redactSecrets, PROP_REGIONS } = require('./player-props-job');

assert.equal(normalizePlayerName('Kenneth Walker III'), 'kenneth walker');
assert.equal(normalizePlayerName('Kevin Coleman Jr.'), 'kevin coleman');
assert.equal(normalizePlayerName('Ollie Gordon II'), 'ollie gordon');
assert.equal(normalizePlayerName("D'Andre Swift"), 'dandre swift');
assert.equal(samePlayer('Kenneth Walker', 'Kenneth Walker III'), true);
assert.equal(samePlayer('Kevin Coleman', 'Kevin Coleman Jr.'), true);
assert.equal(samePlayer('Ollie Gordon', 'Ollie Gordon II'), true);
assert.equal(samePlayer('T. Kelce', 'Travis Kelce'), true);
assert.equal(samePlayer('Travis Kelce', 'Tyler Kelce'), false);
assert.equal(samePlayer('Kenneth Walker', 'Ken Walker'), false);

const kcMia = 'KC|MIA|2026-09-27';
const phiChi = 'PHI|CHI|2026-09-28';
assert.equal(samePlayerInGame('Kenneth Walker', kcMia, 'Kenneth Walker III', kcMia), true);
assert.equal(samePlayerInGame('Kenneth Walker', kcMia, 'Kenneth Walker III', phiChi), false);

const anytime = parseKalshiTdTicker('KXNFLTD-26SEP27KCMIA-KCTKELCE87-1');
assert.equal(anytime.market, 'anytime');
assert.equal(anytime.away, 'KC');
assert.equal(anytime.home, 'MIA');
assert.equal(anytime.date, '2026-09-27');
assert.equal(anytime.gameKey, kcMia);
assert.equal(parseKalshiTdTicker('KXNFLTD-26SEP28PHICHI-CHIDSWIFT4-2').market, 'two');
assert.equal(parseKalshiTdTicker('KXNFLTD-26SEP28PHICHI-CHIDSWIFT4-3').market, 'three');
assert.equal(parseKalshiTdTicker('KXNFLFIRSTTD-26SEP28PHICHI-CHICKEENUM11').market, 'first');
assert.equal(parseKalshiTdTicker('KXNFLFIRSTTD-26SEP28PHICHI-CHICKEENUM11').gameKey, phiChi);
assert.equal(parseKalshiTdTicker('KXNFLTEAMFIRSTTD-26SEP28PHICHI-CHI'), null);
assert.deepEqual(teamsFromKalshiGameToken('26SEP27MINTB'), {
  away: 'MIN', home: 'TB', date: '2026-09-27', gameToken: '26SEP27MINTB', gameKey: 'MIN|TB|2026-09-27',
});

const slug = pairKeyFromSlug('nfl-kc-mia-2026-09-27');
assert.equal(slug.gameKey, kcMia);
assert.equal(slugFromGameKey(kcMia), 'nfl-kc-mia-2026-09-27');
assert.equal(pairKeyFromSlug('not-a-slug'), null);
assert.equal(gameKeyFromTeams('Kansas City Chiefs', 'Miami Dolphins', '2026-09-27T17:00:00Z'), kcMia);

// Yes bid 0.40 → No ask 0.60. Fee 0.07 on the No ask, then fair Yes is
// 1 − implied(that No American). Result is American, not 0.60 or 60%.
const noAmerican = noAskAmericanFromYesBid(0.40, TAKER_FEE_RATE.kalshi);
assert.equal(typeof noAmerican, 'number');
assert.ok(noAmerican <= -100 || noAmerican >= 100);
const fairYes = fairYesAmericanFromNo(noAmerican);
assert.equal(typeof fairYes, 'number');
assert.notEqual(fairYes, noAmerican);
assert.ok(Math.abs(fairYes) >= 100);

const devig = devigTwoWay(-110, -110);
assert.equal(devig.fairYesAmerican, -100);
assert.equal(devig.oppAmerican, -100);
const skewed = devigTwoWay(-150, 130);
assert.equal(typeof skewed.fairYesAmerican, 'number');
assert.ok(skewed.fairYesAmerican < 0);

const bestNo = bestAmericanQuote([
  { book: 'kalshi', price: -140 },
  { book: 'polymarket', price: -120 },
  { book: 'underdog_predict', price: 105 },
]);
assert.equal(bestNo.book, 'underdog_predict');
assert.equal(bestNo.price, 105);

const yesCell = boardYesAmerican(0.64, 0.07);
assert.equal(typeof yesCell, 'number');
assert.ok(yesCell < 0);

const board = boardFromQuotes([
  {
    book: 'kalshi', market: 'anytime', player: 'Travis Kelce', team: 'KC',
    away: 'KC', home: 'MIA', gameKey: kcMia, yesAmerican: -178,
  },
  {
    book: 'polymarket', market: 'anytime', player: 'Travis Kelce', team: 'KC',
    away: 'KC', home: 'MIA', awayName: 'Kansas City Chiefs', homeName: 'Miami Dolphins',
    gameKey: kcMia, yesAmerican: -170,
  },
  {
    book: 'underdog_predict', market: 'anytime', player: 'Travis Kelce', team: 'KC',
    away: 'KC', home: 'MIA', gameKey: kcMia, yesAmerican: -165,
  },
  {
    book: 'kalshi', market: 'anytime', player: 'Travis Kelce', team: 'PHI',
    away: 'PHI', home: 'CHI', gameKey: phiChi, yesAmerican: 140,
  },
]);
assert.equal(board.length, 2);
const kelce = board[0].players.find((p) => p.name === 'Travis Kelce');
assert.equal(kelce.anytime.kalshi, -178);
assert.equal(kelce.anytime.polymarket, -170);
assert.equal(kelce.anytime.underdog_predict, -165);
assert.equal(kelce.anytime.best, -165);
assert.equal(kelce.anytime.bestBook, 'underdog_predict');
assert.equal(board[1].players[0].anytime.kalshi, 140);

const suffixBoard = boardFromQuotes([
  {
    book: 'kalshi', market: 'anytime', player: 'Kenneth Walker III', team: '',
    away: 'KC', home: 'MIA', gameKey: kcMia, yesAmerican: -191,
  },
  {
    book: 'polymarket', market: 'anytime', player: 'Kenneth Walker', team: 'KC',
    away: 'KC', home: 'MIA', gameKey: kcMia, yesAmerican: -191,
  },
  {
    book: 'underdog_predict', market: 'anytime', player: 'Kenneth Walker III', team: 'KC',
    away: 'KC', home: 'MIA', gameKey: kcMia, yesAmerican: -197,
  },
  {
    book: 'kalshi', market: 'anytime', player: 'Kenneth Walker III', team: 'SEA',
    away: 'SEA', home: 'WAS', gameKey: 'SEA|WAS|2026-09-27', yesAmerican: 400,
  },
]);
const walkerRows = suffixBoard.flatMap((game) => game.players.filter((p) => /walker/i.test(p.name)));
assert.equal(walkerRows.length, 2);
const walkerMia = suffixBoard.find((game) => game.gameKey === kcMia).players.find((p) => /walker/i.test(p.name));
assert.equal(walkerMia.anytime.kalshi, -191);
assert.equal(walkerMia.anytime.polymarket, -191);
assert.equal(walkerMia.anytime.underdog_predict, -197);
assert.equal(walkerMia.anytime.best, -191);

assert.equal(promoLegsCorrelate(
  { game: 'Kansas City Chiefs @ Miami Dolphins', playerTd: true, tdGameKey: kcMia },
  { game: 'Chiefs @ Dolphins', playerTd: true, tdGameKey: kcMia },
), true);
assert.equal(promoLegsCorrelate(
  { game: 'Kansas City Chiefs @ Miami Dolphins', playerTd: true, tdGameKey: kcMia },
  { game: 'Philadelphia Eagles @ Chicago Bears', playerTd: true, tdGameKey: phiChi },
), false);
assert.equal(promoLegsCorrelate({ game: 'A @ B' }, { game: 'A @ B' }), true);

const legs = playerTdLegsForBook([{
  sport: 'americanfootball_nfl',
  away: 'Kansas City Chiefs',
  home: 'Miami Dolphins',
  commence_time: '2026-09-27T17:00:00Z',
  gameKey: kcMia,
  players: [{
    name: 'Travis Kelce',
    markets: {
      anytime: {
        offers: [{ book: 'draftkings', price: 150 }],
        opp: { price: -130, book: 'kalshi', count: 2, source: 'exchange' },
      },
    },
  }],
}], 'draftkings', {
  now: Date.parse('2026-09-26T00:00:00Z'),
  isWithinDateRange: () => true,
  passesOddsBounds: () => true,
});
assert.equal(legs.length, 1);
assert.equal(legs[0].dk, 150);
assert.equal(legs[0].bestOpp, -130);
assert.equal(legs[0].market, 'TD');
assert.equal(legs[0].name, 'Travis Kelce 1+ TD');
assert.equal(legs[0].playerTd, true);

const kalshiQuotes = quotesFromKalshiMarkets({
  markets: [{
    ticker: 'KXNFLTD-26SEP27KCMIA-KCTKELCE87-1',
    title: 'Travis Kelce: 1+ touchdowns',
    yes_sub_title: 'Travis Kelce: 1+',
    yes_ask_dollars: '0.6400',
    yes_bid_dollars: '0.6200',
    updated_time: '2026-09-26T00:00:00Z',
  }, {
    ticker: 'KXNFLTEAMFIRSTTD-26SEP27KCMIA-KC',
    title: 'Kansas City first team TD',
    yes_ask_dollars: '0.5000',
    yes_bid_dollars: '0.4800',
  }],
});
assert.equal(kalshiQuotes.length, 1);
assert.equal(kalshiQuotes[0].market, 'anytime');
assert.equal(kalshiQuotes[0].player, 'Travis Kelce');
assert.equal(typeof kalshiQuotes[0].yesAmerican, 'number');
assert.ok(kalshiQuotes[0].yesAmerican < 0);

const polyQuotes = quotesFromPolymarketEvent({
  event: {
    slug: 'nfl-kc-mia-2026-09-27',
    startTime: '2026-09-27T17:00:00Z',
    teams: [
      { id: 63, name: 'Kansas City Chiefs', displayAbbreviation: 'KC' },
      { id: 67, name: 'Miami Dolphins', displayAbbreviation: 'MIA' },
    ],
    markets: [
      {
        sportsMarketType: 'football_player_touchdowns',
        line: 1,
        metadata: { playerName: 'Kenneth Walker', lineLabel: '1+', teamId: 63 },
        bestAskQuote: { value: '0.6400' },
        bestBidQuote: { value: '0.6300' },
      },
      {
        sportsMarketType: 'football_player_first_touchdown',
        metadata: { playerName: 'Kenneth Walker', teamId: 63 },
        bestAskQuote: { value: '0.2200' },
        bestBidQuote: { value: '0.2000' },
      },
      {
        sportsMarketType: 'football_player_team_first_touchdown',
        metadata: { playerName: 'Kenneth Walker', teamId: 63 },
        bestAskQuote: { value: '0.3000' },
        bestBidQuote: { value: '0.2900' },
      },
    ],
  },
});
assert.equal(polyQuotes.length, 2);
assert.ok(polyQuotes.some((q) => q.market === 'anytime' && q.player === 'Kenneth Walker'));
assert.ok(polyQuotes.some((q) => q.market === 'first'));
assert.equal(polyQuotes[0].gameKey, kcMia);

const udQuotes = quotesFromUnderdogTd({
  games: { 178916: { id: 178916, full_team_names_title: 'New York Jets @ Detroit Lions', scheduled_at: '2026-09-27T17:00:00Z' } },
  appearances: { app1: { id: 'app1', match_id: 178916, team_id: 't1' } },
  teams: { t1: { id: 't1', abbr: 'DET' } },
  over_under_lines: {
    line1: {
      stat_value: '0.5',
      over_under: { appearance_stat: { appearance_id: 'app1', display_stat: 'Rush + Rec TDs', stat: 'rush_rec_tds' } },
      options: [
        {
          choice: 'higher',
          selection_header: 'Jahmyr Gibbs',
          event_ticker: 'KXNFLTD-26SEP27NYJDET',
          updated_at: '2026-09-25T21:13:49.678Z',
          odds: { prediction: { american: '-286' } },
        },
        {
          choice: 'lower',
          selection_header: 'Jahmyr Gibbs',
          event_ticker: 'KXNFLTD-26SEP27NYJDET',
          updated_at: '2026-09-25T21:24:21.740Z',
          odds: { prediction: { american: '+214' } },
        },
      ],
    },
  },
}, { now: Date.parse('2026-09-26T00:00:00Z'), omitAfterMs: 24 * 3600 * 1000 });
assert.equal(udQuotes.length, 1);
assert.equal(udQuotes[0].yesAmerican, -286);
assert.equal(udQuotes[0].noAmerican, 214);
assert.equal(udQuotes[0].gameKey, 'NYJ|DET|2026-09-27');
assert.equal(udQuotes[0].market, 'anytime');

const chiefs = assemblePropGame({
  id: 'ev1',
  away_team: 'Kansas City Chiefs',
  home_team: 'Miami Dolphins',
  commence_time: '2026-09-27T17:00:00Z',
  bookmakers: [{
    key: 'draftkings',
    markets: [{
      key: 'player_anytime_td',
      last_update: '2026-09-26T00:00:00Z',
      outcomes: [{ name: 'Over', description: 'Travis Kelce', price: 150 }],
    }, {
      key: 'player_rush_reception_tds',
      outcomes: [
        { name: 'Over', description: 'Tyreek Hill', price: -120, point: 0.5 },
        { name: 'Under', description: 'Tyreek Hill', price: 100, point: 0.5 },
      ],
    }],
  }, {
    key: 'pinnacle',
    markets: [{
      key: 'player_rush_reception_tds',
      outcomes: [
        { name: 'Over', description: 'Tyreek Hill', price: -115, point: 0.5 },
        { name: 'Under', description: 'Tyreek Hill', price: -105, point: 0.5 },
      ],
    }],
  }],
}, [
  {
    book: 'kalshi', market: 'anytime', player: 'Travis Kelce', team: 'KC',
    gameKey: kcMia, yesAmerican: -170, noAmerican: 145,
  },
  {
    book: 'kalshi', market: 'anytime', player: 'Travis Kelce', team: 'PHI',
    gameKey: phiChi, yesAmerican: 400, noAmerican: -600,
  },
], Date.parse('2026-09-26T00:00:00Z'));
const kelceProp = chiefs.players.find((p) => p.name === 'Travis Kelce');
assert.equal(kelceProp.markets.anytime.offers[0].price, 150);
assert.equal(kelceProp.markets.anytime.opp.source, 'exchange');
assert.equal(kelceProp.markets.anytime.opp.price, 145);
assert.notEqual(kelceProp.markets.anytime.opp.price, -600);
const hill = chiefs.players.find((p) => p.name === 'Tyreek Hill');
assert.equal(hill.markets.anytime.opp.source, 'devig');
assert.equal(hill.markets.anytime.opp.book, 'pinnacle');
assert.equal(typeof hill.markets.anytime.opp.price, 'number');

const url = propEventUrl('abc', 'secret-key');
assert.match(url, /regions=us,us2,us_ex,eu/);
assert.equal(PROP_REGIONS, 'us,us2,us_ex,eu');
assert.match(url, /markets=player_anytime_td(&|$)/);
assert.equal(url.includes('player_1st_td'), false);
assert.equal(url.includes('player_tds_over'), false);
assert.equal(url.includes('player_rush_reception_tds'), false);
assert.equal(redactSecrets(`boom ${url}`).includes('secret-key'), false);
assert.deepEqual(ENABLED_TD_MARKETS, ['anytime']);
assert.equal(PLAYER_TD_LOOKAHEAD_MS, 72 * 60 * 60 * 1000);

const now = Date.parse('2026-09-26T12:00:00Z');
const many = [];
for (let i = 0; i < 20; i += 1) {
  many.push({ id: `e${i}`, commence_time: new Date(now + (i + 1) * 3600 * 1000).toISOString() });
}
assert.equal(selectPropEvents(many, now, 16).length, 16);
assert.equal(selectPropEvents([{ id: 'old', commence_time: '2026-09-20T12:00:00Z' }], now).length, 0);
assert.equal(selectPropEvents([{ id: 'soon', commence_time: new Date(now + 71 * 3600 * 1000).toISOString() }], now).length, 1);
assert.equal(selectPropEvents([{ id: 'far', commence_time: new Date(now + 73 * 3600 * 1000).toISOString() }], now).length, 0);
assert.equal(kickoffInPlayerTdWindow(new Date(now + 71 * 3600 * 1000).toISOString(), now), true);
assert.equal(kickoffInPlayerTdWindow(new Date(now + 73 * 3600 * 1000).toISOString(), now), false);
assert.equal(kickoffInPlayerTdWindow(new Date(now - 60 * 1000).toISOString(), now), false);

const windowed = selectPlayerTdQuotes([
  { book: 'kalshi', market: 'anytime', player: 'Travis Kelce', gameKey: kcMia, commence: '2026-09-27T17:00:00Z', yesAmerican: -170 },
  { book: 'kalshi', market: 'two', player: 'Travis Kelce', gameKey: kcMia, commence: '2026-09-27T17:00:00Z', yesAmerican: 280 },
  { book: 'kalshi', market: 'first', player: 'Travis Kelce', gameKey: kcMia, commence: '2026-09-27T17:00:00Z', yesAmerican: 350 },
  { book: 'kalshi', market: 'anytime', player: 'D\'Andre Swift', gameKey: phiChi, commence: '2026-09-30T00:00:00Z', yesAmerican: 110 },
], now);
assert.equal(windowed.length, 1);
assert.equal(windowed[0].market, 'anytime');
assert.equal(windowed[0].gameKey, kcMia);

const { findTopParlays } = require('./promo-ev');
const tdA = { name: 'Travis Kelce 1+ TD', dk: 150, bestOpp: -130, game: 'Chiefs @ Dolphins', playerTd: true, tdGameKey: kcMia, market: 'TD' };
const tdB = { name: 'Tyreek Hill 1+ TD', dk: 140, bestOpp: -120, game: 'Kansas City Chiefs @ Miami Dolphins', playerTd: true, tdGameKey: kcMia, market: 'TD' };
const other = { name: 'Yankees ML', dk: 120, bestOpp: -130, game: 'Yankees @ Red Sox', market: 'ML' };
const paired = findTopParlays([tdA, tdB, other], 2, 0, 100, 10);
assert.equal(paired.some((p) => p.legs.includes(tdA) && p.legs.includes(tdB)), false);
assert.equal(paired.some((p) => p.legs.includes(tdA) && p.legs.includes(other)), true);

console.log('player-td.test.js ok');
