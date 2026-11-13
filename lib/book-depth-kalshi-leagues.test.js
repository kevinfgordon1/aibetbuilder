'use strict';

// NHL / NBA / NCAAB / soccer SPR+TOT had no Kalshi series mapping, so every
// leg came back kalshi_series_unknown (Blackhawks @ Red Wings, Oct 29 2026).
const assert = require('assert');
const bd = require('./book-depth');

for (const [sport, series] of [
  ['icehockey_nhl', { ML: 'KXNHLGAME', SPR: 'KXNHLSPREAD', TOT: 'KXNHLTOTAL' }],
  ['basketball_nba', { ML: 'KXNBAGAME', SPR: 'KXNBASPREAD', TOT: 'KXNBATOTAL' }],
  ['basketball_ncaab', { ML: 'KXNCAAMBGAME', SPR: 'KXNCAAMBSPREAD', TOT: 'KXNCAAMBTOTAL' }],
  ['soccer_epl', { ML: 'KXEPLGAME', SPR: 'KXEPLSPREAD', TOT: 'KXEPLTOTAL' }],
  ['soccer_usa_mls', { ML: 'KXMLSGAME', SPR: 'KXMLSSPREAD', TOT: 'KXMLSTOTAL' }],
]) {
  assert.deepStrictEqual(bd.KALSHI_SERIES[sport], series, sport);
}

const mk = (ticker, label) => ({ ticker, yes_sub_title: label });
const nhlEvents = [
  // Same two cities later in the open window: must not steal tonight's leg.
  { event_ticker: 'KXNHLGAME-26NOV12CHIDET', title: 'Chicago vs Detroit', markets: [mk('KXNHLGAME-26NOV12CHIDET-CHI', 'Chicago'), mk('KXNHLGAME-26NOV12CHIDET-DET', 'Detroit')] },
  { event_ticker: 'KXNHLGAME-26OCT29CHIDET', title: 'Chicago vs Detroit', markets: [mk('KXNHLGAME-26OCT29CHIDET-CHI', 'Chicago'), mk('KXNHLGAME-26OCT29CHIDET-DET', 'Detroit')] },
  { event_ticker: 'KXNHLGAME-26OCT29NYIMIN', title: 'New York I vs Minnesota', markets: [mk('KXNHLGAME-26OCT29NYIMIN-NYI', 'New York I'), mk('KXNHLGAME-26OCT29NYIMIN-MIN', 'Minnesota')] },
  { event_ticker: 'KXNHLGAME-26NOV01EDMNYR', title: 'Edmonton vs New York R', markets: [mk('KXNHLGAME-26NOV01EDMNYR-EDM', 'Edmonton'), mk('KXNHLGAME-26NOV01EDMNYR-NYR', 'New York R')] },
  { event_ticker: 'KXNHLGAME-26OCT29OTTLA', title: 'Ottawa vs Los Angeles', markets: [mk('KXNHLGAME-26OCT29OTTLA-OTT', 'Ottawa'), mk('KXNHLGAME-26OCT29OTTLA-LA', 'Los Angeles')] },
];
const nhl = (game, name, t) => bd.parseOppSelection({ bestOppBook: 'kalshi', sport: 'icehockey_nhl', market: 'ML', game, bestOppName: name, commence_time: t });

let hit = bd.matchKalshiMarket(nhl('Chicago Blackhawks @ Detroit Red Wings', 'Detroit Red Wings ML', '2026-10-29T23:30:00Z'), nhlEvents);
assert.strictEqual(hit.ticker, 'KXNHLGAME-26OCT29CHIDET-DET');
hit = bd.matchKalshiMarket(nhl('Chicago Blackhawks @ Detroit Red Wings', 'Chicago Blackhawks ML', '2026-11-13T00:00:00Z'), nhlEvents);
assert.strictEqual(hit.ticker, 'KXNHLGAME-26NOV12CHIDET-CHI');
hit = bd.matchKalshiMarket(nhl('New York Islanders @ Minnesota Wild', 'New York Islanders ML', '2026-10-30T00:00:00Z'), nhlEvents);
assert.strictEqual(hit.ticker, 'KXNHLGAME-26OCT29NYIMIN-NYI');
// Rangers never match an Islanders event.
assert.strictEqual(bd.matchKalshiMarket(nhl('New York Rangers @ Minnesota Wild', 'New York Rangers ML', '2026-10-30T00:00:00Z'), nhlEvents), null);
hit = bd.matchKalshiMarket(nhl('Ottawa Senators @ Los Angeles Kings', 'Los Angeles Kings ML', '2026-10-30T02:30:00Z'), nhlEvents);
assert.strictEqual(hit.ticker, 'KXNHLGAME-26OCT29OTTLA-LA');
// Off-date: a different Eastern day is unmatched, not the nearest ticker.
assert.strictEqual(bd.matchKalshiMarket(nhl('Chicago Blackhawks @ Detroit Red Wings', 'Detroit Red Wings ML', '2026-11-05T23:30:00Z'), nhlEvents), null);

// Nov 12 2026, 7:09 PM ET (00:09Z Nov 13). Tonight's ticker is NOV12. Saturday's
// rematch NOV14 is 23h51m from the UTC start if dates are midnight UTC, closer
// than tonight's 24h09m, and the old 1.5-day closest-wins picker took Saturday.
{
  const caps = [
    { event_ticker: 'KXNHLGAME-26NOV14NJWSH', title: 'New Jersey vs Washington', markets: [mk('KXNHLGAME-26NOV14NJWSH-NJ', 'New Jersey'), mk('KXNHLGAME-26NOV14NJWSH-WSH', 'Washington')] },
    { event_ticker: 'KXNHLGAME-26NOV12WSHNJ', title: 'Washington vs New Jersey', markets: [mk('KXNHLGAME-26NOV12WSHNJ-WSH', 'Washington'), mk('KXNHLGAME-26NOV12WSHNJ-NJ', 'New Jersey')] },
  ];
  const leg = nhl('Washington Capitals @ New Jersey Devils', 'New Jersey Devils ML', '2026-11-13T00:09:00Z');
  assert.strictEqual(bd.matchKalshiMarket(leg, caps).ticker, 'KXNHLGAME-26NOV12WSHNJ-NJ');
  assert.strictEqual(bd.pickKalshiEvent(leg, caps).event_ticker, 'KXNHLGAME-26NOV12WSHNJ');
}

// NCAAF moneyline tickers are often the day before the ET kickoff. Exact date
// still wins when both are listed. Spreads stay on the kickoff date.
{
  const early = { event_ticker: 'KXNCAAFGAME-26OCT16MIZZMISS', title: 'Missouri vs Ole Miss', markets: [mk('KXNCAAFGAME-26OCT16MIZZMISS-MISS', 'Ole Miss'), mk('KXNCAAFGAME-26OCT16MIZZMISS-MIZZ', 'Missouri')] };
  const exact = { event_ticker: 'KXNCAAFGAME-26OCT17MIZZMISS', title: 'Missouri vs Ole Miss', markets: [mk('KXNCAAFGAME-26OCT17MIZZMISS-MISS', 'Ole Miss'), mk('KXNCAAFGAME-26OCT17MIZZMISS-MIZZ', 'Missouri')] };
  const sel = bd.parseOppSelection({ bestOppBook: 'kalshi', sport: 'americanfootball_ncaaf', market: 'ML', game: 'Missouri Tigers @ Ole Miss Rebels', bestOppName: 'Ole Miss Rebels ML', commence_time: '2026-10-17T19:30:00Z' });
  assert.strictEqual(bd.matchKalshiMarket(sel, [early]).ticker, 'KXNCAAFGAME-26OCT16MIZZMISS-MISS');
  assert.strictEqual(bd.matchKalshiMarket(sel, [early, exact]).ticker, 'KXNCAAFGAME-26OCT17MIZZMISS-MISS');
  const spr = bd.parseOppSelection({ bestOppBook: 'kalshi', sport: 'americanfootball_ncaaf', market: 'SPR', game: 'Missouri Tigers @ Ole Miss Rebels', bestOppName: 'Ole Miss Rebels -3.5', commence_time: '2026-10-17T19:30:00Z' });
  assert.strictEqual(bd.matchKalshiMarket(spr, [{ event_ticker: 'KXNCAAFSPREAD-26OCT16MIZZMISS', title: 'Missouri vs Ole Miss', markets: [mk('S', 'Ole Miss wins by over 3.5 points')] }]), null);
}

// Polymarket slug dates and Novig start times: Saturday's midnight UTC is
// closer to a 7:09 PM ET start than tonight's midnight UTC, and must not win.
{
  const commence = '2026-11-13T00:09:00Z';
  const sel = bd.parseOppSelection({ bestOppBook: 'polymarket', sport: 'icehockey_nhl', market: 'ML', game: 'Washington Capitals @ New Jersey Devils', bestOppName: 'New Jersey Devils ML', commence_time: commence });
  const tonightEv = { slug: 'nhl-wsh-nj-2026-11-12', title: 'Capitals vs. Devils', closed: false, startTime: '2026-11-12T00:00:00Z' };
  const saturdayEv = { slug: 'nhl-nj-wsh-2026-11-14', title: 'Devils vs. Capitals', closed: false, startTime: '2026-11-14T00:00:00Z' };
  assert.equal(bd.pickPolymarketEvent([saturdayEv, tonightEv], sel), tonightEv);
  const novig = [
    { description: 'New Jersey Devils @ Washington Capitals', startsTs: Date.parse('2026-11-14T00:00:00Z') },
    { description: 'Washington Capitals @ New Jersey Devils', startsTs: Date.parse('2026-11-13T00:09:00Z') },
  ];
  assert.equal(bd.pickEventByStart(novig, commence, (e) => e.startsTs).description, 'Washington Capitals @ New Jersey Devils');
  assert.equal(bd.pickEventByStart([novig[0]], commence, (e) => e.startsTs), null);
}

// NBA shared-city labels.
const nbaEvents = [
  { event_ticker: 'KXNBAGAME-26OCT30LACMIN', title: 'Los Angeles C vs Minnesota', markets: [mk('A-LAC', 'Los Angeles C'), mk('A-MIN', 'Minnesota')] },
  { event_ticker: 'KXNBAGAME-26OCT30LALGSW', title: 'Los Angeles L vs Golden State', markets: [mk('B-LAL', 'Los Angeles L'), mk('B-GSW', 'Golden State')] },
];
const nba = (game, name) => bd.parseOppSelection({ bestOppBook: 'kalshi', sport: 'basketball_nba', market: 'ML', game, bestOppName: name, commence_time: '2026-10-31T02:00:00Z' });
assert.strictEqual(bd.matchKalshiMarket(nba('Los Angeles Lakers @ Golden State Warriors', 'Los Angeles Lakers ML'), nbaEvents).ticker, 'B-LAL');
assert.strictEqual(bd.matchKalshiMarket(nba('Los Angeles Clippers @ Minnesota Timberwolves', 'Los Angeles Clippers ML'), nbaEvents).ticker, 'A-LAC');
assert.strictEqual(bd.matchKalshiMarket(nba('Los Angeles Lakers @ Minnesota Timberwolves', 'Los Angeles Lakers ML'), nbaEvents), null);

// NHL puck line + soccer spread wording ("wins by more than").
const sprEv = [{ event_ticker: 'KXNHLSPREAD-26OCT29CBJCAR', title: 'Columbus vs Carolina: Spread', markets: [mk('S-CAR2', 'Carolina wins by over 1.5 goals'), mk('S-CBJ2', 'Columbus wins by over 1.5 goals')] }];
const spr = (name) => bd.parseOppSelection({ bestOppBook: 'kalshi', sport: 'icehockey_nhl', market: 'SPR', game: 'Columbus Blue Jackets @ Carolina Hurricanes', bestOppName: name, commence_time: '2026-10-29T23:00:00Z' });
assert.deepStrictEqual(bd.matchKalshiMarket(spr('Carolina Hurricanes -1.5'), sprEv), { ticker: 'S-CAR2', buySide: 'yes' });
assert.deepStrictEqual(bd.matchKalshiMarket(spr('Columbus Blue Jackets +1.5'), sprEv), { ticker: 'S-CAR2', buySide: 'no' });
const eplEv = [{ event_ticker: 'KXEPLSPREAD-26OCT31CFCMUN', title: 'Chelsea vs Manchester United: Spread', markets: [mk('E-CFC2', 'Chelsea wins by more than 1.5 goals')] }];
const eplSel = bd.parseOppSelection({ bestOppBook: 'kalshi', sport: 'soccer_epl', market: 'SPR', game: 'Manchester United @ Chelsea', bestOppName: 'Chelsea -1.5', commence_time: '2026-10-31T14:00:00Z' });
assert.deepStrictEqual(bd.matchKalshiMarket(eplSel, eplEv), { ticker: 'E-CFC2', buySide: 'yes' });

// Accents: Odds API "Montréal Canadiens" vs Kalshi "Montreal".
assert.ok(bd.teamMatchScore('Montreal', 'Montréal Canadiens') > 0);

console.log('book-depth-kalshi-leagues ok');
