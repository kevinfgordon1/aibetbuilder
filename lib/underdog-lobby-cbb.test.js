'use strict';
// Underdog CBB (men's college basketball, app sport NCAAB). Kevin Oct 30 2026.
const assert = require('node:assert/strict');
const lobby = require('./underdog-lobby');
const fx = require('./fixtures-underdog-cbb.json');

assert.ok(lobby.INDEX_SPORTS.has('CBB'));
assert.equal(lobby.SPORT_BY_UNDERDOG_ID.CBB, 'NCAAB');
assert.equal(lobby.MONEYLINE_FILTER_IDS.CBB, '1cf0e3f3-2cb4-4445-968e-b651d4919720');
assert.equal(lobby.SPREAD_FILTER_IDS.CBB, 'ec20a18f-28bc-4232-8561-3ba918668a66');
assert.equal(lobby.TOTAL_FILTER_IDS.CBB, '9483471c-6041-423d-9da6-93a0625cac42');
assert.equal(require('./underdog-kalshi-confirm').KALSHI_GAME_SERIES.CBB, 'KXNCAAMBGAME');

// CBB grouped list uses market_categories[]=core (not the CFB MarketGroup).
const cfg = lobby.readConfig({});
const url = lobby.groupedLinesUrl(cfg, 'CBB', null);
assert.match(url, /sport_id=CBB/);
assert.match(url, /market_categories%5B%5D=core/);

// Real payload parses to an NCAAB game with both moneyline sides.
const now = Date.parse('2026-10-31T02:00:00Z');
const games = lobby.gamesFromContentLines(fx, 'CBB', now);
assert.equal(games.length, 1);
assert.equal(games[0].sport, 'NCAAB');
assert.equal(games[0].matchId, 209889);
const h2h = games[0].lines.filter((l) => l.market === 'h2h');
assert.equal(h2h.length, 2);

// ?sport=NCAAB narrows the poll to CBB only.
(async () => {
  const seen = [];
  const fetchFn = async (u) => { seen.push(u); return { ok: true, status: 200, text: async () => JSON.stringify(/sport_id=CBB/.test(u) ? fx : {}) }; };
  const out = await lobby.fetchUnderdogPhone({ fetchFn, now, sports: 'NCAAB', cache: new Map(), kalshiConfirm: false });
  assert.ok(seen.length > 0 && seen.every((u) => /sport_id=CBB/.test(u)), 'only CBB requested');
  assert.ok(out.games.some((g) => g.sport === 'NCAAB'));
  console.log('underdog-lobby-cbb.test.js: ok');
})().catch((e) => { console.error(e); process.exit(1); });
