'use strict';
// Novig catalog is paged (100 events + `next`). Oct 17 2026: Wisconsin @ UCLA
// sat on page 2, so its legs had no ladder and Hide low liquidity hid them.
const assert = require('node:assert/strict');
const bd = require('./book-depth.js')._helpers || require('./book-depth.js');

async function run() {
  const MONEY = (id, a, b) => ({ marketId: id, marketType: 'MONEY', status: 'OPEN', outcomes: [{ outcomeId: id + 'h', name: a }, { outcomeId: id + 'a', name: b }] });
  const filler = Array.from({ length: 100 }, (_, i) => ({ eventId: `F${i}`, description: `Team ${i} @ Other ${i}`, status: 'OPEN_PREGAME', startsTs: Date.parse('2026-10-24T17:00:00Z') }));
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    const u = String(url); calls.push(u);
    let json;
    if (u.includes('/catalog/events') && !u.includes('after=')) json = { items: filler, next: 'cur2' };
    else if (u.includes('/catalog/events') && u.includes('after=cur2')) json = { items: [
      { eventId: 'E9', description: 'Wisconsin @ UCLA', status: 'OPEN_PREGAME', startsTs: Date.parse('2026-10-17T23:30:00Z') },
    ] };
    else if (u.includes('markets?event=E9')) json = { items: [MONEY('M9', 'UCLA', 'WIS')] };
    else if (u.includes('/markets/M9/book')) json = { orders: { M9h: [{ price: '0.55', qty: 5000000 }] } };
    else json = {};
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
  };
  try {
    if (bd._resetCatalogCache) bd._resetCatalogCache();
    const legs = [
      { bestOppBook: 'novig', sport: 'americanfootball_ncaaf', market: 'ML', game: 'Wisconsin Badgers @ UCLA Bruins', bestOppName: 'Wisconsin Badgers', name: 'UCLA Bruins', commence_time: '2026-10-17T23:30:00Z' },
      { bestOppBook: 'novig', sport: 'americanfootball_ncaaf', market: 'ML', game: 'Wisconsin Badgers @ UCLA Bruins', bestOppName: 'UCLA Bruins', name: 'Wisconsin Badgers', commence_time: '2026-10-17T23:30:00Z' },
    ];
    const [r] = await bd.resolveLegsDepth(legs);
    assert.equal(r.reason, 'ok', JSON.stringify(r));
    assert.ok(r.levels.length > 0);
    assert.ok(calls.some((c) => c.includes('after=cur2')), 'follows the catalog cursor');
    const catalogCalls = calls.filter((c) => c.includes('/catalog/events'));
    assert.equal(catalogCalls.length, 2, 'two legs share one paged catalog read');
  } finally { global.fetch = realFetch; }
  console.log('book-depth novig catalog paging tests passed');
}
run().catch((e) => { console.error(e); process.exit(1); });
