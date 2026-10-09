// Promo/+EV Novig from Novig's own feed (odds relay) instead of The Odds API.
const assert = require('assert');
const { enabled, relayBase, overlayNovigDirect, createNovigDirect, nameScore } = require('./novig-direct');

const start = '2026-10-11T17:00:00.000Z';
const q = (side, bet_type, odds, american, extra = {}) => ({
  book: 'novig', league: 'NFL', away: 'Tampa Bay Buccaneers', home: 'Dallas Cowboys', side, bet_type, odds, american,
  size: 100, is_alt: false, start, updated_at: '2026-10-11T12:00:00.123Z', ...extra,
});
const quotes = [
  q('Dallas Cowboys', 'moneyline', 0.5, -100),
  q('Tampa Bay Buccaneers', 'moneyline', 0.52, -108),
  q('Dallas Cowboys', 'spread', 0.5, 100, { line: -3.5 }),
  q('Tampa Bay Buccaneers', 'spread', 0.51, -104, { line: 3.5 }),
  q('Dallas Cowboys', 'spread', 0.3, 233, { line: -10.5, is_alt: true }),
  q('Over', 'total', 0.99, -9900, { line: 47.5 }), // unusable price drops the total
  q('Under', 'total', 0.49, 104, { line: 47.5 }),
];
const game = (extra = {}) => ({
  id: 'g1', home_team: 'Dallas Cowboys', away_team: 'Tampa Bay Buccaneers', commence_time: '2026-10-11T17:00:00Z',
  bookmakers: [
    { key: 'draftkings', markets: [{ key: 'h2h', outcomes: [] }] },
    { key: 'novig', title: 'Novig', markets: [
      { key: 'h2h', outcomes: [{ name: 'Dallas Cowboys', price: 120 }] },
      { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 47.5 }] },
    ] },
  ],
  ...extra,
});

{
  const { data, stats } = overlayNovigDirect('americanfootball_nfl', [game()], quotes);
  const nv = data[0].bookmakers.find((b) => b.key === 'novig');
  assert.strictEqual(nv.source, 'novig-direct');
  assert.strictEqual(data[0].bookmakers[0].key, 'draftkings', 'other books untouched');
  const h2h = nv.markets.find((m) => m.key === 'h2h');
  assert.deepStrictEqual(h2h.outcomes.map((o) => [o.name, o.price]), [['Dallas Cowboys', 100], ['Tampa Bay Buccaneers', -108]], 'even money is +100');
  assert.strictEqual(h2h.outcomes[0].bet_limit, 50, 'bet_limit = floor(size x odds)');
  const sp = nv.markets.find((m) => m.key === 'spreads');
  assert.deepStrictEqual(sp.outcomes.map((o) => o.point), [-3.5, 3.5], 'main spread only');
  const tot = nv.markets.find((m) => m.key === 'totals');
  assert.strictEqual(tot.outcomes[0].price, -110, 'unusable relay total keeps the Odds API total');
  assert.strictEqual(h2h.last_update, '2026-10-11T12:00:00Z');
  assert.strictEqual(stats.matched, 1);
}

{
  // Wrong start time (> 3h) and unknown teams keep the Odds API row as-is.
  const far = game({ commence_time: '2026-10-12T17:00:00Z' });
  assert.strictEqual(overlayNovigDirect('americanfootball_nfl', [far], quotes).data[0], far);
  const other = game({ home_team: 'New York Giants' });
  assert.strictEqual(overlayNovigDirect('americanfootball_nfl', [other], quotes).data[0], other);
  // Ambiguous match (two relay games score the same) is skipped.
  const dup = quotes.concat(quotes.map((x) => ({ ...x, start: '2026-10-11T18:00:00.000Z' })));
  const g = game();
  assert.strictEqual(overlayNovigDirect('americanfootball_nfl', [g], dup).data[0], g);
}

assert.strictEqual(nameScore('Western Kentucky Hilltoppers', 'Western Kentucky'), 1);
assert.strictEqual(enabled({ PROMO_NOVIG_DIRECT: '0' }), false);
assert.strictEqual(enabled({}), true);
assert.strictEqual(relayBase({ ODDS_RELAY_URL: 'http://x' }), '', 'https only');
assert.strictEqual(createNovigDirect({ env: { PROMO_NOVIG_DIRECT: 'off', ODDS_RELAY_URL: 'https://r' } }), null);

(async () => {
  // Relay down: keep The Odds API's Novig.
  const down = createNovigDirect({ env: { ODDS_RELAY_URL: 'https://r' }, fetchImpl: async () => ({ ok: false, status: 503 }), log: () => {} });
  const g = [game()];
  assert.strictEqual(await down('americanfootball_nfl', g), g);
  let calls = 0;
  const up = createNovigDirect({ env: { ODDS_RELAY_URL: 'https://r/' }, log: () => {}, fetchImpl: async (url) => {
    calls += 1;
    assert.strictEqual(url, 'https://r/board?league=NFL&venue=novig');
    return { ok: true, json: async () => ({ quotes }) };
  } });
  const out = await up('americanfootball_nfl', [game()]);
  await up('americanfootball_nfl', [game()]);
  assert.strictEqual(calls, 1, 'one relay pull per league per run');
  assert.strictEqual(out[0].bookmakers[1].source, 'novig-direct');
  assert.strictEqual(await up('soccer_epl', g), g, 'unsupported sports pass through');
  console.log('novig-direct.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
