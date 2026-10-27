'use strict';
// Perf + equivalence for the canonical schedule on request paths (/api/kalshi-games, /api/root-for).
// #526 built an Intl.DateTimeFormat per game per event (~230k per Combo Locks game-list load): ~5.4 s of CPU, which held
// the Promo Builder -> Combo Locks prefill ("Matching your Promo Builder legs to live games…") for ~7 s.
//  1. Same answers as the #526 resolver for 1,543 live events over 434 official games (golden made from the old code).
//  2. All 1,543 resolve well under budget (old code: ~12 s on this fixture).
//  3. applyCanonicalStarts / loadScheduleWithin: a slow schedule load falls back to Kalshi times within the 1.5 s budget.
const assert = require('assert');
const G = require('./game-schedule');
const { loadScheduleWithin } = require('./game-schedule-store');
const KG = require('../api/kalshi-games.js');
const FX = require('./fixtures-schedule-perf-2026-10-27.json');

const games = FX.rows.map(G.rowToGame);
const answer = (e, list) => { const r = G.resolveStart(e, list); return r.verified ? r.iso : (r.source + (r.warn && /ambiguous/.test(r.warn) ? ':amb' : '')); };

// 1 + 2. Equivalence and speed (fresh array each round => index rebuilt, memo cold).
let diff = 0;
const t0 = process.hrtime.bigint();
for (const e of FX.events) { const v = answer(e, games); if (v !== FX.gold[e]) { diff += 1; if (diff < 5) console.error('diff', e, v, FX.gold[e]); } }
const coldMs = Number(process.hrtime.bigint() - t0) / 1e6;
assert.strictEqual(diff, 0, `${diff} events resolve differently from #526`);
assert.ok(FX.events.length >= 1500 && games.length >= 400);
let worst = 0;
for (let i = 0; i < 5; i += 1) {
  const fresh = FX.rows.map(G.rowToGame); const t = process.hrtime.bigint();
  for (const e of FX.events) G.resolveStart(e, fresh);
  worst = Math.max(worst, Number(process.hrtime.bigint() - t) / 1e6);
}
console.log(`resolve ${FX.events.length} events / ${games.length} games: first ${coldMs.toFixed(1)} ms, worst cold rebuild ${worst.toFixed(1)} ms`);
assert.ok(coldMs < 400 && worst < 400, `resolver too slow: ${coldMs} / ${worst} ms (budget 400 ms; #526 took ~12 s)`);

(async () => {
  // 3a. loadScheduleWithin: hung load => timeout result inside the budget; fast load passes through; errors => empty.
  const hang = () => new Promise(() => {});
  let t = Date.now(); const to = await loadScheduleWithin(['KXNBAGAME-26OCT27DETNYK'], {}, undefined, 100, hang);
  assert.strictEqual(to.from, 'timeout'); assert.ok(Date.now() - t < 1000);
  const ok = await loadScheduleWithin([], {}, undefined, 100, async () => ({ games, from: 'table' }));
  assert.strictEqual(ok.from, 'table');
  const bad = await loadScheduleWithin([], {}, undefined, 100, async () => { throw new Error('down'); });
  assert.deepStrictEqual(bad, { games: [], from: 'error' });

  // 3b. applyCanonicalStarts: timeout => Kalshi times untouched; fast load => official times.
  const { applyCanonicalStarts } = KG._helpers;
  const mk = () => ({ nba: [{ key: '26OCT27DETNYK', title: 'DET @ NYK', date: '2026-10-27', startTime: '2026-10-28T02:00:00.000Z' }] });
  const NOW = Date.parse('2026-10-27T19:00:00Z');
  t = Date.now(); const slow = await applyCanonicalStarts(mk(), {}, NOW, hang, 100);
  assert.ok(Date.now() - t < 1000);
  assert.deepStrictEqual(slow, mk()); // Kalshi time kept, no startVerified flag
  const fast = await applyCanonicalStarts(mk(), {}, NOW, async () => ({ games, from: 'table' }), 1500);
  assert.strictEqual(fast.nba[0].startTime, '2026-10-28T00:00:00.000Z'); assert.strictEqual(fast.nba[0].startVerified, true);
  // Whole live slate (523 games) through applyCanonicalStarts inside the budget.
  const sports = {}; for (const e of FX.events) {
    const m = /^KX(NBA|NHL|NFL|NCAAF)GAME-(.+)$/.exec(e); if (!m) continue;
    const s = m[1].toLowerCase(); (sports[s] = sports[s] || []).push({ key: m[2], title: m[2], date: '2026-10-27', startTime: null });
  }
  t = Date.now(); await applyCanonicalStarts(sports, {}, NOW, async () => ({ games: FX.rows.map(G.rowToGame), from: 'table' }), 1500);
  const ms = Date.now() - t; console.log(`applyCanonicalStarts ${Object.values(sports).flat().length} games: ${ms} ms`);
  assert.ok(ms < 1500);
  console.log('game-schedule perf tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
