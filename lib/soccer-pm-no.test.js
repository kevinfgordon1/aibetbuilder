'use strict';

const assert = require('node:assert/strict');
const {
  applyVenueFee,
  fetchKalshiSeriesEvents,
  kalshiCatalogTop,
  matchKalshiMarket,
  parseKalshiProb,
} = require('./book-depth');
const {
  overlaySoccerPmNos,
  soccerPmGameKey,
  preferSoccerBinaryNo,
} = require('./soccer-pairing');
const {
  resolveKalshiSoccerNos,
  resolveSoccerPmNos,
  mergePmNoMaps,
  SOCCER_PM_NO_VENUES,
} = require('./soccer-pm-no');
const { transformOddsData, buildAllLegsForBook } = require('./promo-ev');

const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

const villaCatalog = [{
  title: 'Aston Villa vs Nottingham Forest',
  sub_title: 'AVL vs NFO (Sep 12)',
  event_ticker: 'KXEPLGAME-26SEP12AVLNFO',
  markets: [
    {
      ticker: 'KXEPLGAME-26SEP12AVLNFO-AVL',
      yes_sub_title: 'Aston Villa',
      title: 'Aston Villa wins',
      yes_ask_dollars: '0.4300',
      no_ask_dollars: '0.5800',
      yes_bid_size_fp: '2053.00',
    },
    {
      ticker: 'KXEPLGAME-26SEP12AVLNFO-NFO',
      yes_sub_title: 'Nottingham Forest',
      title: 'Nottingham Forest wins',
      yes_ask_dollars: '0.3000',
      no_ask_dollars: '0.7100',
      yes_bid_size_fp: '29856.42',
    },
    {
      ticker: 'KXEPLGAME-26SEP12AVLNFO-TIE',
      yes_sub_title: 'Tie',
      title: 'Tie is the result',
      yes_ask_dollars: '0.2900',
      no_ask_dollars: '0.7200',
      yes_bid_size_fp: '18001.90',
    },
  ],
}];

(async () => {
  assert.deepEqual(SOCCER_PM_NO_VENUES, ['kalshi', 'polymarket', 'novig', 'prophetx']);
  assert.equal(parseKalshiProb('0.5800', null), 0.58);
  const top = kalshiCatalogTop(villaCatalog[0].markets[0], 'no');
  assert.equal(top.american, applyVenueFee('kalshi', -138));
  assert.equal(top.size, 2053);
  const drawHit = matchKalshiMarket({
    market: 'ML', team: 'Draw', buySide: 'no',
    away: 'Nottingham Forest', home: 'Aston Villa',
  }, villaCatalog);
  assert.equal(drawHit.ticker, 'KXEPLGAME-26SEP12AVLNFO-TIE');
  assert.equal(drawHit.buySide, 'no');
  assert.equal(kalshiCatalogTop(drawHit.market, 'no').american, applyVenueFee('kalshi', -257));

  const games = [{
    sport: 'soccer_epl',
    away: 'Nottingham Forest',
    home: 'Aston Villa',
    commence_time: future,
  }];
  const quotes = await resolveKalshiSoccerNos(games, {
    eventsBySport: { soccer_epl: villaCatalog },
  });
  const rec = quotes[soccerPmGameKey(games[0])];
  assert.ok(rec.home && rec.away && rec.draw);
  assert.equal(rec.home.bestBook, 'kalshi');
  assert.equal(rec.home.best, applyVenueFee('kalshi', -138));
  assert.equal(rec.away.bestBook, 'kalshi');
  assert.equal(rec.draw.bestBook, 'kalshi');
  const awayYes = { best: 217, bestBook: 'kalshi' };
  const picked = preferSoccerBinaryNo(rec.home, awayYes);
  assert.equal(picked.kind, 'same_binary_no');
  assert.notEqual(picked.best, awayYes.best);

  const rawGames = [{
    commence_time: future,
    away_team: 'Nottingham Forest',
    home_team: 'Aston Villa',
    bookmakers: [
      {
        key: 'draftkings',
        markets: [{
          key: 'h2h',
          outcomes: [
            { name: 'Nottingham Forest', price: 210 },
            { name: 'Draw', price: 245 },
            { name: 'Aston Villa', price: 130 },
          ],
        }],
      },
      {
        key: 'kalshi',
        markets: [{
          key: 'h2h',
          outcomes: [
            { name: 'Nottingham Forest', price: 217 },
            { name: 'Draw', price: 229 },
            { name: 'Aston Villa', price: 124 },
          ],
        }],
      },
      {
        key: 'betfair_ex_eu',
        markets: [{
          key: 'h2h_lay',
          outcomes: [
            { name: 'Nottingham Forest', price: 245, bet_limit: 956 },
            { name: 'Draw', price: 250, bet_limit: 4593 },
            { name: 'Aston Villa', price: 138, bet_limit: 14 },
          ],
        }],
      },
    ],
  }];
  const data = transformOddsData(rawGames, 'soccer_epl');
  assert.equal(data.moneylines[0].best_home_no_book, 'betfair_ex_eu', 'Odds API fallback is exchange lay');

  const ml = data.moneylines[0];
  const pm = await resolveSoccerPmNos([{
    sport: 'soccer_epl', away: ml.away, home: ml.home, commence_time: ml.commence_time,
  }], {
    venues: ['kalshi'],
    eventsBySport: { soccer_epl: villaCatalog },
  });
  const overlaid = overlaySoccerPmNos(data, pm);
  assert.equal(overlaid.moneylines[0].best_home_no_book, 'kalshi');
  assert.notEqual(overlaid.moneylines[0].best_home_no, overlaid.moneylines[0].best_away);

  const dkLegs = buildAllLegsForBook(overlaid, 'draftkings');
  const home = dkLegs.find((l) => l.name === 'Aston Villa ML');
  const away = dkLegs.find((l) => l.name === 'Nottingham Forest ML');
  const draw = dkLegs.find((l) => l.name === 'Draw');
  assert.ok(home && away && draw, 'DK soccer ML legs after Kalshi catalog No');
  assert.equal(home.bestOppBook, 'kalshi');
  assert.equal(home.bestOppName, 'Aston Villa ML No');
  assert.equal(away.bestOppBook, 'kalshi');
  assert.equal(draw.bestOppBook, 'kalshi');
  assert.equal(draw.bestOppName, 'Draw No');

  const polyOnly = {
    'k': { home: { best: 160, bestBook: 'polymarket', bestSize: 400, count: 1 } },
  };
  const kalshiOnly = {
    'k': { home: { best: 140, bestBook: 'kalshi', bestSize: 800, count: 1 } },
  };
  const merged = mergePmNoMaps(kalshiOnly, polyOnly);
  assert.equal(merged.k.home.bestBook, 'polymarket');
  assert.equal(merged.k.home.best, 160);

  const fetchVenueDepthFn = async (sel) => {
    if (sel.venue !== 'novig' || sel.team !== 'Arsenal') return { levels: [], reason: 'unmatched' };
    return { levels: [{ american: 175, size: 90 }], reason: 'ok' };
  };
  const novigQuotes = await resolveSoccerPmNos([{
    sport: 'soccer_epl', away: 'Chelsea', home: 'Arsenal', commence_time: future,
  }], {
    venues: ['novig'],
    eventsBySport: { soccer_epl: [] },
    fetchVenueDepthFn,
  });
  const novigRec = novigQuotes[soccerPmGameKey({
    sport: 'soccer_epl', away: 'Chelsea', home: 'Arsenal', commence_time: future,
  })];
  assert.equal(novigRec.home.bestBook, 'novig');
  assert.equal(novigRec.home.best, 175);

  const live = await resolveKalshiSoccerNos([
    { sport: 'soccer_epl', away: 'Nottingham Forest', home: 'Aston Villa', commence_time: future },
  ]);
  const epl = live[soccerPmGameKey({
    sport: 'soccer_epl', away: 'Nottingham Forest', home: 'Aston Villa', commence_time: future,
  })];
  assert.ok(epl && epl.home && epl.away && epl.draw, 'live Kalshi EPL catalog must resolve Home/Away/Draw No');
  assert.equal(epl.home.bestBook, 'kalshi');
  assert.equal(typeof epl.home.best, 'number');

  const mlsEvents = await fetchKalshiSeriesEvents('KXMLSGAME');
  assert.ok(mlsEvents.length, 'live Kalshi MLS catalog');
  const mlsEv = mlsEvents.find((ev) => {
    const markets = ev.markets || [];
    const teams = markets.filter((m) => {
      const lab = m.yes_sub_title || m.subtitle || m.title || '';
      return lab && !/\b(draw|tie)\b/i.test(lab) && (m.no_ask_dollars || m.no_ask);
    });
    return teams.length >= 2 && markets.some((m) => /\b(draw|tie)\b/i.test(m.yes_sub_title || m.subtitle || m.title || ''));
  });
  assert.ok(mlsEv, 'live MLS event with Home/Away/Draw No asks');
  const mlsTeams = (mlsEv.markets || [])
    .map((m) => m.yes_sub_title || '')
    .filter((t) => t && !/\b(draw|tie)\b/i.test(t));
  const mlsGame = {
    sport: 'soccer_usa_mls',
    away: mlsTeams[1],
    home: mlsTeams[0],
    commence_time: future,
  };
  const mlsQuotes = await resolveKalshiSoccerNos([mlsGame], {
    eventsBySport: { soccer_usa_mls: mlsEvents },
  });
  const mls = mlsQuotes[soccerPmGameKey(mlsGame)];
  assert.ok(mls && mls.home && mls.away && mls.draw, 'live Kalshi MLS catalog must resolve Home/Away/Draw No');
  assert.equal(mls.home.bestBook, 'kalshi');
  assert.equal(mls.away.bestBook, 'kalshi');
  assert.equal(mls.draw.bestBook, 'kalshi');

  console.log('soccer-pm-no.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
