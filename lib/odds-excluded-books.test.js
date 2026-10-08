'use strict';

const assert = require('node:assert/strict');
const { EXCLUDED_BOOKS, isExcludedBook, dropExcludedBooks } = require('./odds-excluded-books');
const { runFetchOddsJob } = require('./odds-fetch-job');

assert.deepEqual([...EXCLUDED_BOOKS], ['courtside', 'fliff']);
assert.ok(isExcludedBook('Courtside') && isExcludedBook('fliff') && !isExcludedBook('draftkings'));

const game = () => ({
  id: 'g', home_team: 'H', away_team: 'A', commence_time: '2099-01-01T00:00:00Z',
  bookmakers: [{ key: 'draftkings', markets: [] }, { key: 'courtside', markets: [] }, { key: 'fliff', markets: [] }],
});
assert.deepEqual(dropExcludedBooks([game()])[0].bookmakers.map((b) => b.key), ['draftkings']);
assert.deepEqual(dropExcludedBooks(game()).bookmakers.map((b) => b.key), ['draftkings'], 'single event object');
const clean = { id: 'c', bookmakers: [{ key: 'fanduel' }] };
assert.equal(dropExcludedBooks(clean), clean, 'untouched games keep identity');
assert.equal(dropExcludedBooks(null), null);

// fetch-odds job: neither featured nor event rows ever carry the excluded books,
// even without applyBookAdjustments.
(async () => {
  const upserts = [];
  const supabase = { from(table) { const c = {
    abortSignal() { return c; }, delete() { return c; }, eq() { return c; }, lt() { return Promise.resolve({ error: null }); },
    upsert(row) { upserts.push({ table, row }); return Promise.resolve({ error: null }); },
  }; return c; } };
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => (url.includes('/events/') ? game() : [game()]) });
  await runFetchOddsJob({ sports: ['americanfootball_nfl'], apiKey: 'k', fetchImpl, supabaseClient: supabase,
    nowMs: Date.parse('2098-12-31T12:00:00Z'), startedAt: Date.now() });
  const featured = upserts.find((u) => u.table === 'odds_cache');
  const event = upserts.find((u) => u.table === 'event_odds_cache');
  assert.deepEqual(featured.row.data[0].bookmakers.map((b) => b.key), ['draftkings']);
  assert.deepEqual(event.row.data.bookmakers.map((b) => b.key), ['draftkings']);
  console.log('odds-excluded-books tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
