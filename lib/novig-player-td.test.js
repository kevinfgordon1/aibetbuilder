'use strict';
// Novig player TDs: league + marketType query (eventId is ignored by Novig),
// follow the `next` cursor, keep "Jr." names, retry 429 book reads.
const assert = require('node:assert/strict');
const { loadNovigTdQuotes } = require('./player-td-feeds');

const START = Date.parse('2026-10-11T17:00:00Z'); // 1 PM ET
const ev = { eventId: 'e1', description: 'Baltimore Ravens @ Atlanta Falcons', startsTs: START };
const td = (id, name, strike) => ({ marketId: id, eventId: 'e1', marketType: 'TOUCHDOWNS', strike: String(strike), status: 'OPEN', description: `${name} ${strike} TOUCHDOWNS`, fee: { coefficient: '0.03', charged: 'WHEN_LIVE' }, outcomes: [{ outcomeId: `${id}-o`, name: `Over ${strike}` }, { outcomeId: `${id}-u`, name: `Under ${strike}` }] });

(async () => {
  const calls = [];
  const hits = {};
  const fetchFn = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    const json = (body, status = 200) => ({ status, text: async () => JSON.stringify(body), headers: { get: () => null } });
    if (u.pathname.endsWith('/events')) return json({ items: [ev] });
    if (u.pathname.endsWith('/markets')) {
      assert.equal(u.searchParams.get('league'), 'NFL');
      assert.ok(!u.searchParams.has('eventId'));
      if (u.searchParams.get('after') === 'c1') return json({ items: [td('m2', 'Michael Penix Jr.', 0.5)] });
      return json({ items: [td('m1', 'Bijan Robinson', 0.5), td('m9', 'Bijan Robinson', 2.5)], next: 'c1' });
    }
    const id = u.pathname.split('/')[5];
    hits[id] = (hits[id] || 0) + 1;
    if (id === 'm2' && hits[id] === 1) return json({}, 429);
    // Yes bid 0.06 (No ask 0.94 = -1567), No bid 0.93 (Yes ask 0.07).
    return json({ orders: { [`${id}-o`]: [{ price: '0.06', qty: 4000000 }], [`${id}-u`]: [{ price: '0.93', qty: 100 }] } });
  };
  const quotes = await loadNovigTdQuotes(['BAL|ATL|2026-10-11'], { fetchFn, sleepFn: async () => {}, now: START - 3600e3 });
  assert.ok(calls.some((c) => c.includes('after=c1')), 'follows the markets cursor');
  assert.ok(!calls.some((c) => c.includes('/m9/')), '2.5 TD lines are skipped');
  const penix = quotes.find((q) => q.player === 'Michael Penix Jr.');
  assert.ok(penix, 'Penix on page 2 found after a 429 retry');
  assert.equal(penix.book, 'novig');
  assert.equal(penix.market, 'anytime');
  assert.equal(penix.gameKey, 'BAL|ATL|2026-10-11');
  assert.equal(penix.noAmerican, -1567);
  assert.equal(penix.yesAmerican, 1329);
  assert.equal(penix.noSize, 37600.48);
  assert.equal(quotes.length, 2);
  console.log('novig-player-td.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
