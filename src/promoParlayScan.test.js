import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { rescaleParlaysForStake, rescaleFreeBetConversions } from "./promoParlayScan.js";
import { calcNoSweatEV } from "./promoNoSweat.js";

const require = createRequire(import.meta.url);
const { calcParlayEV, findTopParlays } = require("../lib/promo-ev.js");
const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");

// ── App.jsx keeps enumerate-then-sort findTopParlays (heap declined)
{
  assert.match(app, /function findTopParlays\(/);
  assert.match(app, /function growParlaysFromTop3\(/);
  assert.match(app, /results\.push\(\{ legs: \[l\], \.\.\.r \}\)/);
  assert.match(app, /results\.sort\(\(a, b\) => b\.ev - a\.ev\)/);
  assert.match(app, /return results\.slice\(0, maxResults\)/);
  assert.doesNotMatch(app, /EvMinHeap|scanParlayCombos/);
  assert.match(app, /const PARLAY_LEG_CAP = 200/);
}

// ── Debounce + memo + page-reset deps (no boost/stake churn)
{
  assert.match(app, /useDebouncedValue\(boostPct/);
  assert.match(app, /useDebouncedValue\(stake/);
  assert.match(app, /scanBoostPct/);
  assert.match(app, /rescaleParlaysForStake/);
  assert.match(app, /const promoLegs = useMemo\(/);
  assert.match(app, /const parlayLegPool = useMemo\(/);
  assert.match(app, /const scannedBoostParlays = useMemo\(/);
  assert.match(app, /const topParlays = useMemo\(/);
  assert.match(app, /const topNoSweats = useMemo\(/);
  assert.match(app, /const scannedFreeBetConversions = useMemo\(/);
  const resetDeps = app.match(/setExpandedFreeBet\(null\);\s*\}, \[([^\]]+)\]/);
  assert.ok(resetDeps, "promo page reset effect");
  assert.doesNotMatch(resetDeps[1], /\bboostPct\b/);
  assert.doesNotMatch(resetDeps[1], /\bstake\b/);
  assert.match(resetDeps[1], /promoBook/);
  assert.match(resetDeps[1], /numLegs/);
}

// ── Boost EV / profit scale linearly with stake
{
  const legs = [
    { dk: 100, bestOpp: -122 },
    { dk: 150, bestOpp: -130 },
    { dk: -105, bestOpp: 115 },
  ];
  const at100 = calcParlayEV(legs, 30, 100);
  const at250 = calcParlayEV(legs, 30, 250);
  const scaled = rescaleParlaysForStake([{ legs, ...at100 }], 100, 250)[0];
  assert.ok(Math.abs(scaled.ev - at250.ev) < 1e-9);
  assert.ok(Math.abs(scaled.boostedProfit - at250.boostedProfit) < 1e-9);
  assert.equal(scaled.parlayDec, at250.parlayDec);
  assert.equal(scaled.combinedProb, at250.combinedProb);
  assert.equal(scaled.parlayOdds, at250.parlayOdds);
}

// ── Same ranking after stake rescale (no rescan needed)
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const mk = (name, game, dk, bestOpp) => ({
    name, dk, bestOpp, game, commence_time: future, sport: "baseball_mlb",
  });
  const legs = [
    mk("A ML", "A @ B", 150, 100),
    mk("C ML", "C @ D", 140, 105),
    mk("E ML", "E @ F", 120, 110),
    mk("G ML", "G @ H", 110, 120),
  ];
  const scanned = findTopParlays(legs, 3, 30, 100, 10);
  const scaled = rescaleParlaysForStake(scanned, 100, 40);
  const fresh = findTopParlays(legs, 3, 30, 40, 10);
  assert.ok(scanned.length >= 1);
  assert.deepEqual(
    scaled.map((p) => p.legs.map((l) => l.name).sort()),
    fresh.map((p) => p.legs.map((l) => l.name).sort()),
  );
  for (let i = 0; i < scaled.length; i++) {
    assert.ok(Math.abs(scaled[i].ev - fresh[i].ev) < 1e-9, "rescaled EV matches fresh scan");
    assert.ok(Math.abs(scaled[i].boostedProfit - fresh[i].boostedProfit) < 1e-9);
  }
}

// ── No-sweat cash fields also scale linearly
{
  const ns100 = calcNoSweatEV({ stake: 100, decimal: 4, p: 0.25, refundPct: 100, conversionPct: 70 });
  const ns50 = calcNoSweatEV({ stake: 50, decimal: 4, p: 0.25, refundPct: 100, conversionPct: 70 });
  const scaled = rescaleParlaysForStake([{ ...ns100, parlayDec: 4, combinedProb: 0.25 }], 100, 50)[0];
  assert.ok(Math.abs(scaled.ev - ns50.ev) < 1e-9);
  assert.ok(Math.abs(scaled.winProfit - ns50.winProfit) < 1e-9);
  assert.ok(Math.abs(scaled.creditValue - ns50.creditValue) < 1e-9);
  assert.ok(Math.abs(scaled.refund - ns50.refund) < 1e-9);
  assert.ok(Math.abs(scaled.loseNet - ns50.loseNet) < 1e-9);
}

// ── Free-bet hedge/cash scale; conversion rate unchanged
{
  const list = [{ hedgeStake: 80, guaranteedCash: 56, conversionRate: 0.7, leg: { name: "A ML" } }];
  const scaled = rescaleFreeBetConversions(list, 100, 250);
  assert.ok(Math.abs(scaled[0].hedgeStake - 200) < 1e-9);
  assert.ok(Math.abs(scaled[0].guaranteedCash - 140) < 1e-9);
  assert.equal(scaled[0].conversionRate, 0.7);
}

// ── Same stake / empty / zero-from are no-ops
{
  const parlays = [{ ev: 12, boostedProfit: 40, legs: [] }];
  assert.equal(rescaleParlaysForStake(parlays, 100, 100), parlays);
  assert.deepEqual(rescaleParlaysForStake([], 100, 50), []);
  assert.equal(rescaleParlaysForStake(parlays, 0, 50), parlays);
}

console.log("promoParlayScan.test.js: ok");
