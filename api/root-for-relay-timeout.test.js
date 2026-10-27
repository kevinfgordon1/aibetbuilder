'use strict';
// Oct 27 2026: a slow odds relay (≈10 s per call) made every Kalshi book older than STALE_MS by pricing time, and
// What to root for showed "1 of 20 open locks". These tests hang / slow the relay and check all 20 locks still price.
const assert = require('node:assert/strict');
const handler = require('./root-for.js');
const H = handler._helpers;

const TEAMS = ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK'];
const games = Array.from({ length: 10 }, (_, i) => `KXNBAGAME-26OCT27${TEAMS[2 * i]}${TEAMS[2 * i + 1]}`);
const locks = Array.from({ length: 20 }, (_, i) => ({
  id: `L${i}`, label: `lock ${i}`, parlay_stake: 50, parlay_american: 900, is_free_bet: false,
  legs: [0, 1, 2].map((k) => { const g = games[(i + k * 3) % 10]; const tm = g.slice(-6, -3); return { ticker: `${g}-${tm}`, side: 'yes', label: tm }; }),
}));
const book = (t) => ({ ticker: t, orderbook_fp: { yes_dollars: [['0.4400', '500000']], no_dollars: [['0.5400', '500000']] } });

function world({ relay = 'hang', relayCostMs = 0, missingBooks = [] } = {}) {
  let clock = Date.parse('2026-10-27T20:45:00Z'); const calls = [];
  const now = () => clock;
  const fetch = (u, opts = {}) => {
    calls.push(u.replace(/\?.*/, ''));
    if (/odds-relay|relay\.test/.test(u)) {
      clock += relayCostMs; // a slow relay: pricing happens this much later
      if (relay === 'hang') return new Promise((_, rej) => { if (opts.signal) opts.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
      return Promise.resolve({ ok: true, json: async () => (/health/.test(u) ? { status: {} } : { quotes: [] }) });
    }
    if (/orderbooks/.test(u)) {
      const ts = [...new URL(u).searchParams.getAll('tickers')];
      return Promise.resolve({ ok: true, json: async () => ({ orderbooks: ts.filter((t) => !missingBooks.some((m) => t.startsWith(m))).map(book) }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ events: [], markets: [] }) });
  };
  return { fetch, now, calls, tick: (ms) => { clock += ms; } };
}
const env = { ODDS_RELAY_URL: 'http://relay.test', ROOTFOR_RELAY_TIMEOUT_MS: '200' };

(async () => {
  const M = await H.loadMods();
  assert.equal(H.RELAY_TIMEOUT_MS, 2500);

  // 1. Relay hangs forever: each call times out at its own limit (in parallel), all 20 locks price.
  {
    const w = world({ relay: 'hang' }); const t0 = Date.now();
    const mk = await H.loadMarkets(M, locks, env, w.fetch, w.now);
    const ms = Date.now() - t0;
    assert.ok(ms < 1500, `hung relay cost ${ms} ms (parallel, 200 ms timeout each)`);
    assert.ok(mk.relayNote.some((n) => /timeout/.test(n)));
    const out = await H.priceWithRetry(M, mk, { parlays: locks, fills: [], singles: [], submissions: [], now: w.now(), finals: {} }, w.fetch, w.now);
    assert.equal(out.locksPriced, 20); assert.equal(out.locksTotal, 20); assert.equal(out.unpricedCount, 0);
    console.log('hung relay:', `${out.locksPriced}/${out.locksTotal} priced in ${ms} ms`);
  }

  // 2. Relay answers but takes 10 s per call (simulated clock): books are fetched AFTER the relay, so still fresh.
  {
    const w = world({ relay: 'slow', relayCostMs: 10000 });
    const mk = await H.loadMarkets(M, locks, env, w.fetch, w.now);
    const lastRelay = w.calls.map((c, i) => [c, i]).filter(([c]) => /relay\.test/.test(c)).pop()[1];
    const firstBook = w.calls.findIndex((c) => /orderbooks/.test(c));
    assert.ok(firstBook > lastRelay, 'Kalshi orderbooks are fetched after every relay call');
    const out = await H.priceWithRetry(M, mk, { parlays: locks, fills: [], singles: [], submissions: [], now: w.now(), finals: {} }, w.fetch, w.now);
    assert.equal(out.locksPriced, 20);
    console.log('slow relay (70 s simulated):', `${out.locksPriced}/${out.locksTotal} priced`);
  }

  // 3. Books went stale before pricing (e.g. slow Supabase reads): refetched once, all price.
  {
    const w = world({ relay: 'slow' });
    const mk = await H.loadMarkets(M, locks, env, w.fetch, w.now);
    w.tick(30000);
    const n0 = w.calls.filter((c) => /orderbooks/.test(c)).length;
    const out = await H.priceWithRetry(M, mk, { parlays: locks, fills: [], singles: [], submissions: [], now: w.now(), finals: {} }, w.fetch, w.now);
    assert.equal(w.calls.filter((c) => /orderbooks/.test(c)).length, n0 + 1, 'one refetch');
    assert.equal(out.locksPriced, 20); assert.ok(out.bookAgeMs < 15000);
  }

  // 4. Stale and the refetch fails: locks are reported unpriced with the reason (never silently dropped).
  {
    const w = world({ relay: 'slow' });
    const mk = await H.loadMarkets(M, locks, env, w.fetch, w.now);
    w.tick(30000);
    const dead = (u, o) => (/orderbooks/.test(u) ? Promise.resolve({ ok: false, status: 503, json: async () => ({}) }) : w.fetch(u, o));
    const out = await H.priceWithRetry(M, mk, { parlays: locks, fills: [], singles: [], submissions: [], now: w.now(), finals: {} }, dead, w.now);
    assert.equal(out.locksPriced, 0); assert.equal(out.unpricedCount, 20); assert.deepEqual(out.unpricedReasons, { stale: 20 });
    assert.ok(out.unpriced.every((u) => u.reason === 'stale'));
  }

  // 5. A game with no Kalshi market: only its locks are unpriced, reason no_book.
  {
    const w = world({ relay: 'slow', missingBooks: [games[0]] });
    const mk = await H.loadMarkets(M, locks, env, w.fetch, w.now);
    const out = await H.priceWithRetry(M, mk, { parlays: locks, fills: [], singles: [], submissions: [], now: w.now(), finals: {} }, w.fetch, w.now);
    const hit = locks.filter((l) => l.legs.some((x) => x.ticker.startsWith(games[0]))).length;
    assert.equal(out.unpricedCount, hit); assert.deepEqual(out.unpricedReasons, { no_book: hit }); assert.equal(out.locksPriced, 20 - hit);
  }

  // 6. Page text
  const { unpricedText } = await import('../src/rootForToday.js');
  {
    assert.equal(unpricedText(19, { stale: 19 }), '19 unpriced (prices stale), not counted');
    assert.equal(unpricedText(0, {}), '');
  }
  console.log('root-for relay timeout tests ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
