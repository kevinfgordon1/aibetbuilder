'use strict';
// NCAAM national champion futures: Polymarket US + Kalshi, ESPN-id crosswalk, depth as potential profit.
const assert = require('node:assert/strict');
const c = require('./ncaam-champ');
const fx = require('./fixtures-ncaam-champ.json');

assert.ok(c.XWALK_TEAM_COUNT >= 70, `crosswalk teams ${c.XWALK_TEAM_COUNT}`);
assert.equal(c.POLY_FEE, 0.0695);
assert.equal(c.espnIdForKalshi('KXMARMAD-27-DUKE', 'Duke'), '150');
assert.equal(c.espnIdForPoly('tec-cbb-champ-2027-04-05-w-duke', 'Duke'), '150');
assert.notEqual(c.espnIdForKalshi('x', 'Michigan'), c.espnIdForKalshi('y', 'Michigan St.'), 'Michigan is not Michigan St.');
assert.equal(c.espnIdForKalshi('x', 'Fisk'), null);

// Potential profit = contracts x (1 - p) - theta x contracts x p x (1 - p).
assert.equal(c.potentialProfit(100, 0.15, 0.0695), Math.round((100 * 0.85 - 100 * 0.0695 * 0.15 * 0.85) * 100) / 100);
assert.equal(c.potentialProfit(null, 0.15, 0.07), null);
assert.equal(c.potentialProfit(10, 1, 0.07), null);

// Kalshi: every listed team maps, both sides priced, sizes -> profit.
const k = c.kalshiChampFromEvents(fx.kalshi);
assert.equal(k.length, 4);
const kDuke = k.find((r) => r.espnId === '150');
assert.ok(kDuke.yes > 0 && kDuke.no < 0);
assert.ok(kDuke.yesProfit > 0);

(async () => {
  // Polymarket US: list -> cbb-champ-* event (not cbb-conf-*) -> markets; books for the likeliest teams.
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (/\/v2\/leagues\/cbb\/events\?type=futures/.test(url)) return ok(fx.polyList);
    if (/\/v1\/events\/slug\/cbb-champ-2027-04-05-w$/.test(url)) return ok(fx.polyEvent);
    if (/\/book$/.test(url)) {
      if (/-duke\/book$/.test(url)) return ok({ marketData: { bids: [{ px: { value: '0.1400' }, qty: '326.21' }], offers: [{ px: { value: '0.1500' }, qty: '5641.95' }, { px: { value: '0.1600' }, qty: '9' }] } });
      return { ok: false, status: 429, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const p = await c.fetchPolymarketUsChamp({ fetchFn, sleepFn: async () => {} });
  assert.equal(p.length, 3);
  assert.ok(!calls.some((u) => /cbb-conf/.test(u)));
  const duke = p.find((r) => r.espnId === '150');
  assert.equal(duke.yesP, 0.15);
  assert.equal(duke.noP, 0.86);
  assert.equal(duke.yes, 567);
  assert.equal(duke.no, -614);
  assert.equal(duke.yesSize, 5641.95);
  assert.equal(duke.noSize, 326.21);
  assert.equal(duke.yesProfit, c.potentialProfit(5641.95, 0.15, 0.0695));
  assert.equal(calls.filter((u) => /\/book$/.test(u)).length, 2, 'stops at the first 429');

  // Bookmakers: book names win when a sportsbook lists the team; ESPN display otherwise; No only on exchanges.
  const raw = [{ bookmakers: [{ key: 'fanduel', markets: [{ key: 'outrights', outcomes: [{ name: 'Duke Blue Devils', price: 450 }, { name: 'Michigan State Spartans', price: 2500 }, { name: 'Nowhere Tech', price: 99999 }] }] }] }];
  const { bookmakers, diag } = c.buildNcaamChampBookmakers(raw, { polymarket: p, kalshi: k }, '2026-10-31T02:00:00Z');
  assert.deepEqual(bookmakers.map((b) => b.key), ['polymarket', 'kalshi']);
  const kYes = bookmakers[1].markets.find((m) => m.key === 'outrights').outcomes;
  const kNo = bookmakers[1].markets.find((m) => m.key === 'outrights_lay').outcomes;
  assert.ok(kYes.some((o) => o.name === 'Duke Blue Devils' && o.profit > 0));
  assert.ok(kYes.some((o) => o.name === 'Michigan State Spartans'), 'joined to the book name by ESPN id');
  assert.ok(kYes.some((o) => o.name === 'Michigan Wolverines'), 'ESPN display when no book lists it');
  assert.ok(kNo.length >= 1);
  assert.deepEqual(diag.unmatchedBooks, ['Nowhere Tech']);

  // No sportsbook event yet: exchanges still get a row.
  assert.equal(c.ensureOutrightsEvent([], 'basketball_ncaab_championship_winner').length, 1);

  // fetch-futures routes NCAAM to this path (never the international gamma search).
  // Stub the Supabase-backed module so loading the cron handler needs no database or env.
  const stub = (id, exports) => { const f = require.resolve(id); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub('./odds-shared', { supabase: {}, applyBookAdjustments: (x) => x });
  const ff = require('../api/fetch-futures.js')._helpers;
  assert.equal(ff.EXCHANGE_FUTURES.basketball_ncaab_championship_winner.ncaam, true);
  assert.equal(ff.EXCHANGE_FUTURES.basketball_ncaab_championship_winner.pmQuery, undefined);
  const viaFF = await ff.buildNcaamExchangeBookmakers('basketball_ncaab_championship_winner', raw, { fetchFn, sleepFn: async () => {}, kalshiBody: fx.kalshi });
  assert.deepEqual(viaFF.bookmakers.map((b) => b.key), ['polymarket', 'kalshi']);
  console.log('ncaam-champ.test.js: ok');
})().catch((e) => { console.error(e); process.exit(1); });
