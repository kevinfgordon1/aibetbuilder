'use strict';

const assert = require('node:assert/strict');
const G = require('./odds-outlier-guard');
const { runFetchOddsJob } = require('./odds-fetch-job');

const NOW = Date.parse('2026-10-08T04:00:00Z');
const CT = '2026-10-08T23:00:00Z';
const W = 'Western Kentucky Hilltoppers';
const M = 'Missouri State Bears';
const cfg = (over = {}) => ({ ...G.DEFAULT_CONFIG, mode: 'on', ...over });

function spreadBook(key, rows, marketKey = 'alternate_spreads') {
  // rows: [[pointForW, priceW, priceM]] → W at point, M at -point
  const outcomes = [];
  for (const [pt, pw, pm] of rows) {
    if (pw != null) outcomes.push({ name: W, point: pt, price: pw });
    if (pm != null) outcomes.push({ name: M, point: -pt, price: pm });
  }
  return { key, markets: [{ key: marketKey, outcomes }] };
}

function wkuGame() {
  return {
    id: 'wku', sport_key: 'americanfootball_ncaaf', home_team: W, away_team: M, commence_time: CT,
    bookmakers: [
      // DK ladder from the live cache on Oct 7 (WKU side) + its other side where seen.
      spreadBook('draftkings', [[-2.5, -103, null], [-15.5, 720, null], [-17.5, 950, null], [-19.5, 1140, -9600]]),
      spreadBook('courtside', [[-15.5, 720, -1840], [-17.5, 950, -3800], [-19.5, 1222, -6432]]),
      spreadBook('fanduel', [[-2.5, 100, -122], [-15.5, 430, -670], [-17.5, 520, -900], [-19.5, 630, -1200]]),
      spreadBook('fanatics', [[-2.5, -105, -115], [-15.5, 390, -600], [-17.5, 475, -800], [-19.5, 550, -950]]),
      spreadBook('betmgm', [[-2.5, -105, -115]]),
      spreadBook('polymarket', [[-17.5, 698, -2526]]),
    ],
  };
}

function dkSide(res, pt) {
  return res.flags.find((q) => q.book === 'draftkings' && q.point === pt && q.name === W);
}

// 1. WKU: the bad DK rungs are flagged; the in-line -2.5 is not.
{
  const res = G.evaluateGame(wkuGame(), { config: cfg(), nowMs: NOW });
  assert.ok(dkSide(res, -19.5), 'DK -19.5 +1140 flagged');
  assert.ok(dkSide(res, -17.5), 'DK -17.5 +950 flagged');
  assert.ok(dkSide(res, -15.5), 'DK -15.5 +720 flagged');
  assert.equal(dkSide(res, -2.5), undefined, 'DK -2.5 -103 is in line');
  // Courtside (excluded from the site) neither votes nor gets flagged/logged.
  const f = dkSide(res, -19.5);
  assert.ok(!f.consensusGroups.includes('courtside'));
  assert.ok(!res.flags.some((q) => q.book === 'courtside'));
  assert.ok(!res.quotes.some((q) => q.book === 'courtside'));
  // FanDuel / Fanatics prices are fine.
  assert.ok(!res.flags.some((q) => q.book === 'fanduel' || q.book === 'fanatics'));
}

// 2. Near-even main line: normal soft-book value passes, a gross mistake does not.
function mlGame(prices) {
  return {
    id: 'g2', home_team: 'H', away_team: 'A', commence_time: CT,
    bookmakers: Object.entries(prices).map(([key, [h, a]]) => ({
      key, markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: h }, { name: 'A', price: a }] }],
    })),
  };
}
{
  const base = { pinnacle: [-110, -100], fanduel: [-112, -104], betmgm: [-115, -105], caesars: [-110, -110], espnbet: [-108, -112] };
  let res = G.evaluateGame(mlGame({ ...base, draftkings: [105, -125] }), { config: cfg(), nowMs: NOW });
  assert.equal(res.flags.length, 0, '+105 vs ~-105 fair is legit value');
  res = G.evaluateGame(mlGame({ ...base, draftkings: [150, -180] }), { config: cfg(), nowMs: NOW });
  assert.equal(res.flags.length, 1);
  assert.equal(res.flags[0].book, 'draftkings');
  assert.equal(res.flags[0].reason || res.flags[0].flag, 'consensus');
}

// 3. Too few comparison books: no flag unless egregious (2 books); 1 book never.
{
  const g = mlGame({ fanduel: [-110, -110], draftkings: [400, -600] });
  assert.equal(G.evaluateGame(g, { config: cfg(), nowMs: NOW }).flags.length, 0, '1 comparison book never flags');
  const g2 = mlGame({ fanduel: [-110, -110], betmgm: [-112, -108], draftkings: [400, -600] });
  const r2 = G.evaluateGame(g2, { config: cfg(), nowMs: NOW });
  assert.equal(r2.flags.length, 1);
  assert.equal(r2.flags[0].flag, 'consensus_egregious');
}

// 4. 3-way regulation h2h (EU NHL) is not compared with the 2-way moneyline.
{
  const g = mlGame({ pinnacle: [-145, 128], fanduel: [-160, 132], betmgm: [-150, 125], draftkings: [-142, 120] });
  for (const k of ['unibet_se', 'tipico_de']) {
    g.bookmakers.push({ key: k, markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: 123 }, { name: 'A', price: 190 }, { name: 'Draw', price: 320 }] }] });
  }
  assert.equal(G.evaluateGame(g, { config: cfg(), nowMs: NOW }).flags.length, 0);
}

// 5. Exchange placeholders (incoherent two sides / -10000 one-sided) do not vote.
{
  const g = mlGame({ fanduel: [600, -1000], fanatics: [550, -900], betmgm: [575, -950], polymarket: [-10421, -851], novig: [-33233, null] });
  g.bookmakers.find((b) => b.key === 'novig').markets[0].outcomes.pop();
  const res = G.evaluateGame(g, { config: cfg(), nowMs: NOW });
  const fd = res.quotes.find((q) => q.book === 'fanduel' && q.name === 'H');
  assert.equal(fd.consensusBooks, 2, 'placeholders excluded from the vote');
  assert.equal(res.flags.length, 0);
}

// 6. Ladder: an easier rung paying more than a harder one at the same book.
{
  const g = {
    id: 'g6', home_team: W, away_team: M, commence_time: CT,
    bookmakers: [spreadBook('novig', [[-3.5, 150, null], [-7.5, 140, null], [-10.5, 300, null]])],
  };
  const res = G.evaluateGame(g, { config: cfg(), nowMs: NOW });
  assert.equal(res.flags.length, 1);
  assert.equal(res.flags[0].flag, 'ladder');
  assert.equal(res.flags[0].point, -3.5);
  // Totals: Over 45.5 paying more than Over 47.5.
  const t = {
    id: 'g6b', home_team: 'H', away_team: 'A', commence_time: CT,
    bookmakers: [{ key: 'kalshi', markets: [{ key: 'alternate_totals', outcomes: [
      { name: 'Over', point: 45.5, price: 130 }, { name: 'Over', point: 47.5, price: 120 }, { name: 'Under', point: 45.5, price: -150 },
    ] }] }],
  };
  const rt = G.evaluateGame(t, { config: cfg(), nowMs: NOW });
  assert.deepEqual(rt.flags.map((q) => [q.name, q.point]), [['Over', 45.5]]);
}

// 7. Started games are skipped by default.
{
  const g = { ...wkuGame(), commence_time: '2026-10-08T03:00:00Z' };
  assert.equal(G.evaluateGame(g, { config: cfg(), nowMs: NOW }).flags.length, 0);
  assert.ok(G.evaluateGame(g, { config: cfg({ skipStarted: false }), nowMs: NOW }).flags.length > 0);
}

// 8. Modes: on strips, dry reports only, off is a no-op.
{
  const on = G.guardSportData('americanfootball_ncaaf', [wkuGame()], { config: cfg({ mode: 'on' }), nowMs: NOW });
  const dk = on.data[0].bookmakers.find((b) => b.key === 'draftkings');
  assert.deepEqual(dk.markets[0].outcomes.map((o) => o.point), [-2.5, 19.5], 'bad DK rungs removed, -2.5 and the stingy other side kept');
  assert.ok(on.flags.length >= 3);
  const rec = on.flags.find((f) => f.book === 'draftkings' && f.point === -19.5);
  assert.equal(rec.price, 1140);
  assert.equal(rec.market, 'alternate_spreads');
  assert.equal(rec.event_id, 'wku');
  assert.ok(rec.consensus_price > 500 && rec.consensus_price < 700, 'consensus shown in American odds');
  const dry = G.guardSportData('americanfootball_ncaaf', [wkuGame()], { config: cfg({ mode: 'dry' }), nowMs: NOW });
  assert.equal(dry.flags.length, on.flags.length);
  assert.deepEqual(dry.data[0], wkuGame(), 'dry run leaves data untouched');
  const off = G.guardSportData('x', [wkuGame()], { config: cfg({ mode: 'off' }), nowMs: NOW });
  assert.equal(off.flags.length, 0);
}

// 9. Context game adds comparison books but is never flagged itself.
{
  const event = { id: 'e9', home_team: 'H', away_team: 'A', commence_time: CT, bookmakers: [
    { key: 'draftkings', markets: [{ key: 'alternate_totals', outcomes: [{ name: 'Over', point: 50.5, price: 120 }, { name: 'Under', point: 50.5, price: -140 }] }] },
  ] };
  const featured = { id: 'e9', home_team: 'H', away_team: 'A', commence_time: CT, bookmakers: ['fanduel', 'betmgm', 'pinnacle'].map((key) => ({
    key, markets: [{ key: 'totals', outcomes: [{ name: 'Over', point: 50.5, price: -250 }, { name: 'Under', point: 50.5, price: 200 }] }],
  })) };
  const out = G.guardSportData('s', [event], { config: cfg(), contextById: new Map([['e9', featured]]), nowMs: NOW });
  assert.equal(out.flags.length, 1);
  assert.equal(out.flags[0].book, 'draftkings');
  assert.equal(out.flags[0].outcome_name, 'Over');
}

// 10. Config from env.
{
  const c = G.readConfig({ ODDS_OUTLIER_GUARD: 'DRY', ODDS_OUTLIER_LOGIT_MAX: '0.6', ODDS_OUTLIER_MIN_BOOKS: 'x' });
  assert.equal(c.mode, 'dry');
  assert.equal(c.logitMax, 0.6);
  assert.equal(c.minBooks, G.DEFAULT_CONFIG.minBooks);
  assert.equal(G.readConfig({ ODDS_OUTLIER_GUARD: 'bogus' }).mode, 'on');
  assert.equal(G.readConfig({}).skipStarted, true);
}

// 11. Fetch job: featured + event data are guarded before upsert and flags are logged.
(async () => {
  const upserts = [];
  const logged = [];
  const supabase = {
    from(table) {
      const chain = {
        abortSignal() { return chain; },
        upsert(row) { upserts.push({ table, row }); return Promise.resolve({ error: null }); },
        delete() { return chain; }, eq() { return chain; }, lt() { return Promise.resolve({ error: null }); },
      };
      return chain;
    },
  };
  const ev = wkuGame();
  const featuredGame = { ...wkuGame(), bookmakers: [] };
  const fetchImpl = async (url) => ({
    ok: true, status: 200,
    json: async () => (url.includes('/events/') ? ev : [featuredGame]),
  });
  const out = await runFetchOddsJob({
    sports: ['americanfootball_ncaaf'],
    apiKey: 'k',
    fetchImpl,
    supabaseClient: supabase,
    nowMs: NOW,
    startedAt: Date.now(),
    outlierGuard: (sport, data, opts) => G.guardSportData(sport, data, { ...opts, config: cfg(), nowMs: NOW }),
    logOutlierFlags: async (_client, flags) => { logged.push(...flags); return null; },
  });
  const evRow = upserts.find((u) => u.table === 'event_odds_cache');
  assert.ok(evRow, 'event row written');
  const dk = evRow.row.data.bookmakers.find((b) => b.key === 'draftkings');
  assert.ok(!dk.markets[0].outcomes.some((o) => o.point === -19.5), 'cached event data has no DK -19.5');
  assert.ok(logged.some((f) => f.book === 'draftkings' && f.point === -19.5), 'flag logged');
  assert.ok(out.results.some((r) => r.outlier_flags > 0));

  // A throwing guard never blocks ingestion.
  const upserts2 = [];
  const sb2 = { from(table) { const c = { abortSignal() { return c; }, upsert(row) { upserts2.push({ table, row }); return Promise.resolve({ error: null }); }, delete() { return c; }, eq() { return c; }, lt() { return Promise.resolve({ error: null }); } }; return c; } };
  await runFetchOddsJob({
    sports: ['americanfootball_ncaaf'], featuredOnly: true, apiKey: 'k', fetchImpl, supabaseClient: sb2,
    nowMs: NOW, startedAt: Date.now(),
    outlierGuard: () => { throw new Error('boom'); },
  });
  assert.ok(upserts2.some((u) => u.table === 'odds_cache'));

  // logOutlierFlags dedupes by flag_key and upserts on it.
  const calls = [];
  const deletes = [];
  const sb3 = { from(t) { return {
    upsert(rows, opts) { calls.push({ t, rows, opts }); return Promise.resolve({ error: null }); },
    delete() { return { lt(col, iso) { deletes.push({ t, col, iso }); return Promise.resolve({ error: null }); } }; },
  }; } };
  const flags = G.guardSportData('s', [wkuGame()], { config: cfg(), nowMs: NOW }).flags;
  await G.logOutlierFlags(sb3, flags.concat(flags), { mode: 'on' });
  assert.equal(calls[0].t, 'odds_outlier_flags');
  assert.equal(calls[0].opts.onConflict, 'flag_key');
  assert.equal(calls[0].rows.length, flags.length);
  assert.ok(calls[0].rows.every((r) => r.flag_key && r.mode === 'on' && r.last_seen_at));
  // 7-day retention prune on the same table.
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].t, 'odds_outlier_flags');
  assert.equal(deletes[0].col, 'last_seen_at');
  const age = Date.now() - Date.parse(deletes[0].iso);
  assert.ok(Math.abs(age - G.FLAG_RETENTION_MS) < 60000);

  console.log('odds-outlier-guard tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
