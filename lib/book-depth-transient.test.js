'use strict';
// Intermittent "N picks hidden by Hide low liquidity" (Oct 24 2026): a
// rate-limited/timed-out venue read was cached as an empty catalog for 60s,
// so every leg on that venue came back with no ladder and looked thin.
// Failed reads must be flagged transient, retried once, and never cached.
const assert = require('node:assert/strict');
const bd = require('./book-depth.js');

const resp = (status, json) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(json) });

async function run() {
  const realFetch = global.fetch;
  const MONEY = { marketId: 'M9', marketType: 'MONEY', status: 'OPEN', outcomes: [{ outcomeId: 'M9h', name: 'UCLA' }, { outcomeId: 'M9a', name: 'WIS' }] };
  const leg = { bestOppBook: 'novig', sport: 'americanfootball_ncaaf', market: 'ML', game: 'Wisconsin Badgers @ UCLA Bruins', bestOppName: 'Wisconsin Badgers', name: 'UCLA Bruins', commence_time: '2026-10-24T23:30:00Z' };
  let catalogFails = 2; // first call + its one retry
  let catalogCalls = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/catalog/events')) {
      catalogCalls++;
      if (catalogFails-- > 0) return resp(429, { error: 'rate limited' });
      return resp(200, { items: [{ eventId: 'E9', description: 'Wisconsin @ UCLA', status: 'OPEN_PREGAME', startsTs: Date.parse('2026-10-24T23:30:00Z') }] });
    }
    if (u.includes('markets?event=E9')) return resp(200, { items: [MONEY] });
    if (u.includes('/markets/M9/book')) return resp(200, { orders: { M9h: [{ price: '0.55', qty: 5000000 }] } });
    return resp(200, {});
  };
  try {
    bd._resetCatalogCache();
    const [a] = await bd.resolveLegsDepth([leg]);
    assert.equal(a.levels.length, 0);
    assert.equal(a.transient, true, 'rate-limited read is flagged transient: ' + JSON.stringify(a));
    assert.equal(catalogCalls, 2, 'one retry on 429');
    const [b] = await bd.resolveLegsDepth([leg]);
    assert.equal(b.reason, 'ok', 'failed catalog was not cached: ' + JSON.stringify(b));
    assert.ok(b.levels.length > 0);
    assert.ok(!b.transient);

    // 429 then success inside one request: the retry recovers it.
    bd._resetCatalogCache();
    catalogFails = 1;
    const [c] = await bd.resolveLegsDepth([leg]);
    assert.equal(c.reason, 'ok', JSON.stringify(c));

    // A real "not listed" answer stays non-transient (truly no depth).
    bd._resetCatalogCache();
    global.fetch = async () => resp(200, { items: [] });
    const [d] = await bd.resolveLegsDepth([leg]);
    assert.equal(d.reason, 'novig_unmatched_event');
    assert.ok(!d.transient);

    assert.equal(bd.isTransientStatus(429), true);
    assert.equal(bd.isTransientStatus(0), true);
    assert.equal(bd.isTransientStatus(503), true);
    assert.equal(bd.isTransientStatus(404), false);
  } finally { global.fetch = realFetch; }
  console.log('book-depth transient tests passed');
}
run().catch((e) => { console.error(e); process.exit(1); });
