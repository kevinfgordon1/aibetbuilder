'use strict';
// UCL Nov 3 2026: Villarreal vs PSG, Feyenoord vs Inter, Atletico vs Bayern.
// Novig prints the long club name; Kalshi prints PSG / Inter / Bayern Munich.
const assert = require('assert');
const bd = require('./book-depth');

const psgEvent = {
  event_ticker: 'KXUCLGAME-26NOV03VILPSG',
  title: 'Villarreal vs PSG',
  markets: [
    { ticker: 'KXUCLGAME-26NOV03VILPSG-VIL', yes_sub_title: 'Villarreal' },
    { ticker: 'KXUCLGAME-26NOV03VILPSG-PSG', yes_sub_title: 'PSG' },
    { ticker: 'KXUCLGAME-26NOV03VILPSG-TIE', yes_sub_title: 'Tie' },
  ],
};
const sel = {
  market: 'ML', sport: 'soccer_uefa_champs_league', buySide: 'no',
  away: 'Villarreal CF', home: 'Paris Saint-Germain FC', team: 'Paris Saint-Germain FC',
  commence_time: '2026-11-03T20:00:00Z',
};
const hit = bd.matchKalshiMarket(sel, [psgEvent]);
assert.equal(hit.ticker, 'KXUCLGAME-26NOV03VILPSG-PSG');
assert.equal(hit.buySide, 'no');
const draw = bd.matchKalshiMarket({ ...sel, team: 'Draw' }, [psgEvent]);
assert.equal(draw.ticker, 'KXUCLGAME-26NOV03VILPSG-TIE');

assert.ok(bd.eventMatchScore('Paris Saint-Germain FC @ Villarreal CF', 'Villarreal', 'PSG') > 0);
assert.equal(bd.eventMatchScore('Inter Miami CF @ Orlando City SC', 'Feyenoord', 'Inter'), 0);
assert.ok(bd.eventMatchScore('FC Internazionale Milano @ Feyenoord Rotterdam', 'Feyenoord', 'Internazionale') > 0);
assert.ok(bd.eventMatchScore('FC Bayern München @ Club Atlético de Madrid', 'Atletico Madrid', 'Bayern Munich') > 0);
assert.ok(bd.eventMatchScore('Lille OSC @ FK Bodø / Glimt', 'Bodoe/Glimt', 'Lille') > 0);
assert.ok(bd.eventMatchScore('FK Bodø/Glimt vs. Lille OSC', 'Bodoe/Glimt', 'Lille') > 0);
assert.equal(bd.teamMatchScore('PSG', 'Paris Saint-Germain'), 5000);
assert.equal(bd.teamMatchScore('Inter', 'Inter Miami CF'), 0);
assert.equal(bd.teamMatchScore('Manchester United', 'Manchester City'), 0);

const markets = [
  { marketId: 'W1', marketType: 'MONEYLINE_3_WAY_WIN', status: 'OPEN', description: 'Inter MONEYLINE_3_WAY_WIN', outcomes: [{ outcomeId: 'Iy', name: 'Yes' }, { outcomeId: 'In', name: 'No' }] },
  { marketId: 'W2', marketType: 'MONEYLINE_3_WAY_WIN', status: 'OPEN', description: 'Feyenoord MONEYLINE_3_WAY_WIN', outcomes: [{ outcomeId: 'Fy', name: 'Yes' }, { outcomeId: 'Fn', name: 'No' }] },
  { marketId: 'D', marketType: 'MONEYLINE_3_WAY_DRAW', status: 'OPEN', description: 'Inter @ Feyenoord MONEYLINE_3_WAY_DRAW', outcomes: [{ outcomeId: 'Dy', name: 'Yes' }, { outcomeId: 'Dn', name: 'No' }] },
];
const interNo = bd.pickNovigThreeWay({ team: 'FC Internazionale Milano', buySide: 'no' }, markets);
assert.equal(interNo.market.marketId, 'W1');
assert.equal(interNo.outcome.outcomeId, 'In');
const drawYes = bd.pickNovigThreeWay({ team: 'Draw', buySide: 'yes' }, markets);
assert.equal(drawYes.outcome.outcomeId, 'Dy');
assert.equal(bd.polymarketUsWinnerLabel({ question: 'Will Paris Saint-Germain FC win against Villarreal CF in the UEFA Champions League match?' }), 'Paris Saint-Germain FC');
assert.equal(bd.polymarketUsWinnerLabel({ question: 'Will the UEFA Champions League match Villarreal CF vs Paris Saint-Germain FC end in a draw?' }), 'Draw');

const asks = bd.polymarketUsAsks({ marketData: { bids: [{ px: { value: '0.2100', currency: 'USD' }, qty: '100' }] } }, 'no');
assert.equal(asks.length, 1);
assert.ok(asks[0].american < 0, 'No at 0.79 is a favorite');

console.log('book-depth ucl ok');
