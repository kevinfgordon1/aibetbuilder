'use strict';
// Promo Best Pick (Oct 28 2026): Red Wings ML at Underdog -182 showed "Best
// opp Blackhawks +457 on Polymarket" (top +530, then +2244...). The
// Polymarket search phrase "chicago detroit" returned a closed MLB event
// (mlb-det-chc-2026-07-20, Tigers vs Cubs), "Chicago Blackhawks" matched
// "Chicago Cubs" on the city word, and the resolved market's leftover asks
// became the ladder. Real Blackhawks ML was 38c (about +152 after fee).
const assert = require('node:assert/strict');
const bd = require('./book-depth.js');

const resp = (status, json) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(json) });

const MLB_OLD = {
  slug: 'mlb-det-chc-2026-07-20', title: 'Detroit Tigers vs. Chicago Cubs', closed: true,
  startTime: '2026-07-20T18:20:00Z', endDate: '2026-07-28T00:05:00Z',
  markets: [{ question: 'Detroit Tigers vs. Chicago Cubs', outcomes: '["Detroit Tigers","Chicago Cubs"]', clobTokenIds: '["TIG","CUBS"]', closed: true }],
};
const NHL_OLD = {
  slug: 'nhl-det-chi-2025-12-14', title: 'Red Wings vs. Blackhawks', closed: true,
  startTime: '2025-12-14T01:00:00Z',
  markets: [{ question: 'Red Wings vs. Blackhawks', outcomes: '["Red Wings","Blackhawks"]', clobTokenIds: '["OLD_DET","OLD_CHI"]', closed: true }],
};
const NHL_LIVE = {
  slug: 'nhl-chi-det-2026-10-29', title: 'Blackhawks vs. Red Wings', closed: false,
  startTime: '2026-10-29T23:30:00Z', endDate: '2026-10-29T23:30:00Z',
  markets: [
    { question: 'Spread: Blackhawks (-1.5)', outcomes: '["Blackhawks","Red Wings"]', clobTokenIds: '["SPR_CHI","SPR_DET"]', closed: false },
    { question: 'Blackhawks vs. Red Wings', outcomes: '["Blackhawks","Red Wings"]', clobTokenIds: '["CHI","DET"]', closed: false, acceptingOrders: true },
  ],
};
const leg = { bestOppBook: 'polymarket', sport: 'icehockey_nhl', market: 'ML', game: 'Chicago Blackhawks @ Detroit Red Wings', bestOppName: 'Chicago Blackhawks ML', commence_time: '2026-10-29T23:40:00Z' };

async function run() {
  const sel = bd.parseOppSelection(leg);
  // Pure picker: closed, other-league and stale-date events are rejected.
  assert.equal(bd.pickPolymarketEvent([MLB_OLD, NHL_OLD], sel), null);
  assert.equal(bd.pickPolymarketEvent([MLB_OLD, NHL_OLD, NHL_LIVE], sel), NHL_LIVE);
  assert.equal(bd.pickPolymarketEvent([{ ...MLB_OLD, closed: false, startTime: '2026-10-29T23:30:00Z' }], sel), null, 'MLB event never serves an NHL leg');
  assert.equal(bd.pickPolymarketEvent([{ ...NHL_LIVE, startTime: '2026-11-12T23:30:00Z', endDate: null }], sel), null, 'rematch two weeks later is not this game');
  assert.equal(bd.teamSearchPhrases('Chicago Blackhawks', 'Detroit Red Wings')[0], 'Chicago Blackhawks Detroit Red Wings');

  const realFetch = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('/public-search')) {
      const q = decodeURIComponent(/q=([^&]*)/.exec(u)[1]).toLowerCase();
      // City-only query: other sports first (the prod bug). Full names: real game.
      if (q === 'chicago detroit') return resp(200, { events: [MLB_OLD] });
      if (q.includes('blackhawks')) return resp(200, { events: [NHL_OLD, NHL_LIVE] });
      return resp(200, { events: [MLB_OLD] });
    }
    if (u.includes('/book?token_id=CHI')) return resp(200, { asks: [{ price: '0.39', size: '13756' }, { price: '0.38', size: '15140' }] });
    if (u.includes('/book?token_id=CUBS')) return resp(200, { asks: [{ price: '0.15', size: '300' }, { price: '0.04', size: '2680' }] });
    return resp(404, {});
  };
  try {
    bd._resetCatalogCache();
    const [r] = await bd.resolveLegsDepth([leg]);
    assert.equal(r.reason, 'ok', JSON.stringify(r));
    assert.ok(!seen.some((u) => u.includes('token_id=CUBS')), 'never reads the closed MLB book');
    assert.ok(seen.some((u) => u.includes('token_id=CHI')), 'reads the live Blackhawks ML book');
    assert.ok(r.levels.length >= 1);
    assert.ok(r.levels[0].american < 200 && r.levels[0].american > 100, 'top is about +152 after fee: ' + JSON.stringify(r.levels));

    // Only stale/closed or other-league events found: no ladder, not a fake one.
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/public-search')) return resp(200, { events: [MLB_OLD, NHL_OLD] });
      if (u.includes('/book?token_id=')) return resp(200, { asks: [{ price: '0.15', size: '300' }] });
      return resp(404, {});
    };
    bd._resetCatalogCache();
    const [none] = await bd.resolveLegsDepth([leg]);
    assert.equal(none.levels.length, 0);
    assert.equal(none.reason, 'polymarket_unmatched_event');
  } finally {
    global.fetch = realFetch;
  }
  console.log('book-depth-poly-wrong-game: ok');
}

run().catch((e) => { console.error(e); process.exit(1); });
