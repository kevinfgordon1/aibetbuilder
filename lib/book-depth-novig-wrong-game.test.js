'use strict';
// Kevin Nov 2 2026 3:36 PM ET: Promo Best Pick Texas State ML showed "Best opp +9900 on Novig,
// $10,701 depth, Texas A&M-CC Islanders ML" (true −9908 vs DK −535). Novig's real AMCC price was
// +426 (TXST bid 81c). The depth lookup matched Novig's "Texas A&M Commerce @ Oklahoma" (same tip
// time) because the title's single "texas" counted for both Texas A&M-CC and Texas State, then read
// Texas A&M-Commerce's ask off Oklahoma's 99c bid.
const assert = require('node:assert/strict');
const bd = require('./book-depth.js')._helpers || require('./book-depth.js');

assert.equal(bd.eventMatchesTeams('Texas A&M Commerce @ Oklahoma', 'Texas A&M-CC Islanders', 'Texas State Bobcats'), false);
assert.equal(bd.eventMatchesTeams('Texas A&M-Corpus Christi @ Texas State', 'Texas A&M-CC Islanders', 'Texas State Bobcats'), true);
assert.equal(bd.eventMatchesTeams('Texas @ Texas Tech', 'Texas Longhorns', 'Texas Tech Red Raiders'), true);
assert.equal(bd.eventMatchesTeams('Manchester United vs Manchester City', 'Manchester City', 'Manchester United'), true);
assert.equal(bd.eventMatchesTeams('Chicago State @ Texas', 'Texas Southern Tigers', 'Grand Canyon Antelopes'), false);

async function run() {
  const tip = Date.parse('2026-11-03T01:00:00Z');
  const MONEY = (id, h, a) => ({ marketId: id, marketType: 'MONEY', status: 'OPEN', outcomes: [{ outcomeId: id + 'h', name: h }, { outcomeId: id + 'a', name: a }] });
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    let json = {};
    // Wrong game listed FIRST, same start time.
    if (u.includes('/catalog/events')) json = { items: [
      { eventId: 'ETAM', description: 'Texas A&M Commerce @ Oklahoma', status: 'OPEN_PREGAME', startsTs: tip },
      { eventId: 'AMCC', description: 'Texas A&M-Corpus Christi @ Texas State', status: 'OPEN_PREGAME', startsTs: tip },
    ] };
    else if (u.includes('markets?event=ETAM')) json = { items: [MONEY('M1', 'OKLA', 'ETAM')] };
    else if (u.includes('markets?event=AMCC')) json = { items: [MONEY('M2', 'TXST', 'AMCC')] };
    else if (u.includes('/markets/M1/book')) json = { orders: { M1h: [{ price: '0.99', qty: 1383941 }] } };
    else if (u.includes('/markets/M2/book')) json = { orders: { M2h: [{ price: '0.81', qty: 49635 }, { price: '0.01', qty: 246600 }], M2a: [{ price: '0.14', qty: 60000 }] } };
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
  };
  try {
    if (bd._resetCatalogCache) bd._resetCatalogCache();
    const [r] = await bd.resolveLegsDepth([{ bestOppBook: 'novig', sport: 'basketball_ncaab', market: 'ML', game: 'Texas A&M-CC Islanders @ Texas State Bobcats', bestOppName: 'Texas A&M-CC Islanders', name: 'Texas State Bobcats', commence_time: '2026-11-03T01:00:00Z' }]);
    assert.equal(r.reason, 'ok', JSON.stringify(r));
    assert.equal(r.levels[0].american, 426, JSON.stringify(r.levels));
    assert.ok(!r.levels.some((l) => l.american === 9900), 'never the Commerce/Oklahoma book');
  } finally { global.fetch = realFetch; }
  console.log('book-depth novig wrong-game tests passed');
}
run().catch((e) => { console.error(e); process.exit(1); });
