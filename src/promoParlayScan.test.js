import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { rescaleParlaysForStake, rescaleFreeBetConversions, findTopParlaysChunked, promoScanEmptyState, promoScanInputKey } from "./promoParlayScan.js";
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
  assert.match(app, /const PROMO_SCAN_DEBOUNCE_MS = 150/);
  assert.match(app, /useDebouncedValue\(boostPct/);
  assert.match(app, /useDebouncedValue\(stake/);
  assert.match(app, /scanBoostPct/);
  assert.match(app, /rescaleParlaysForStake/);
  assert.match(app, /const promoLegs = useMemo\(/);
  assert.match(app, /const parlayLegPool = useMemo\(/);
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

// ── Heavy scan is async + chunked, never inside useMemo / render
{
  assert.match(app, /findTopParlaysChunked/);
  assert.match(app, /scanning…/);
  assert.match(app, /setPromoScanBusy\(true\)/);
  assert.doesNotMatch(app, /const scannedBoostParlays = useMemo/);
  assert.doesNotMatch(app, /const scannedNoSweats = useMemo/);
  const memoBlocks = [...app.matchAll(/useMemo\(\(\) => \{([\s\S]*?)\}, \[/g)].map((m) => m[1]);
  for (const block of memoBlocks) {
    assert.doesNotMatch(block, /findTopParlays\(/, "findTopParlays must not run inside useMemo");
    assert.doesNotMatch(block, /findTopParlaysChunked\(/, "chunked scan must not run inside useMemo");
  }
}

// ── App does not render No Results when busy is false and no scan has
//    completed yet for boost mode (first-paint / post-odds race).
{
  assert.match(app, /promoScanEmptyState/);
  assert.match(app, /promoScanInputKey/);
  assert.match(app, /lastCompletedScanKey/);
  assert.match(app, /scanCompletedForCurrent/);
  assert.match(app, /boostEmptyState === "no-results"/);
  assert.match(app, /boostEmptyState === "scanning"/);
  assert.doesNotMatch(
    app,
    /topParlaysWithHedge\.length === 0 && !promoScanBusy/,
    "No Results must not key off busy=false + empty parlays",
  );
  assert.doesNotMatch(
    app,
    /topNoSweatsWithLock\.length === 0 && !promoScanBusy/,
    "No Results must not key off busy=false + empty nosweats",
  );
  assert.match(app, /if \(!promoLoaded\) \{\s*setPromoScanBusy\(false\);\s*return;/);
  assert.match(app, /\[promoType, parlayLegPool, numLegs, scanBoostPct, parsedMinFinal, refundPct, creditConversionPct, promoLoaded, currentPromoScanKey\]/);
  assert.match(app, /if \(gen !== promoScanGen\.current\) return;/);
  assert.match(app, /if \(err\?\.name === "AbortError"\) \{/);
  assert.equal(
    promoScanEmptyState({
      promoLoaded: true,
      promoLoading: false,
      scanBusy: false,
      scanCompletedForCurrent: false,
      resultCount: 0,
    }),
    "scanning",
    "first paint: busy false + empty + no completed scan → scanning, not No Results",
  );
}

// ── Empty-state machine: loading / running / done-empty / keep prior results
{
  assert.equal(promoScanEmptyState({
    promoLoaded: false, promoLoading: true, scanBusy: false,
    scanCompletedForCurrent: false, resultCount: 0,
  }), "scanning");
  assert.equal(promoScanEmptyState({
    promoLoaded: true, promoLoading: false, scanBusy: true,
    scanCompletedForCurrent: false, resultCount: 0,
  }), "scanning");
  assert.equal(promoScanEmptyState({
    promoLoaded: true, promoLoading: false, scanBusy: false,
    scanCompletedForCurrent: true, resultCount: 0,
  }), "no-results");
  assert.equal(promoScanEmptyState({
    promoLoaded: true, promoLoading: false, scanBusy: false,
    scanCompletedForCurrent: true, resultCount: 3,
  }), "results");
  assert.equal(promoScanEmptyState({
    promoLoaded: true, promoLoading: false, scanBusy: true,
    scanCompletedForCurrent: false, resultCount: 4,
  }), "results", "keep prior cards while a newer pool is scanning");
  assert.equal(promoScanEmptyState({
    promoLoaded: true, promoLoading: true, scanBusy: false,
    scanCompletedForCurrent: true, resultCount: 0,
  }), "scanning", "promoLoading with empty results is not No Results");
}

// ── Pool fill must change the scan key so a completed [] is not reused
{
  const base = {
    promoType: "boost", numLegs: 3, scanBoostPct: 30,
    parsedMinFinal: null, refundPct: 100, creditConversionPct: 70,
  };
  const emptyKey = promoScanInputKey({ ...base, pool: [] });
  const filledKey = promoScanInputKey({
    ...base,
    pool: [
      { game: "A @ B", name: "A ML" },
      { game: "C @ D", name: "C ML" },
      { game: "E @ F", name: "E ML" },
    ],
  });
  assert.notEqual(emptyKey, filledKey);
  assert.equal(
    promoScanEmptyState({
      promoLoaded: true, promoLoading: false, scanBusy: false,
      scanCompletedForCurrent: emptyKey === filledKey, resultCount: 0,
    }),
    "scanning",
  );
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

function mkLeg(name, game, dk, bestOpp) {
  return {
    name, dk, bestOpp, game,
    commence_time: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    sport: "baseball_mlb",
  };
}

function namesOf(parlays) {
  return parlays.map((p) => p.legs.map((l) => l.name).sort());
}

// ── Chunked scan matches sync findTopParlays ranking (3-leg + 4-leg grow)
{
  const legs = [
    mkLeg("A ML", "A @ B", 150, 100),
    mkLeg("C ML", "C @ D", 140, 105),
    mkLeg("E ML", "E @ F", 120, 110),
    mkLeg("G ML", "G @ H", 110, 120),
    mkLeg("I ML", "I @ J", 105, 115),
    mkLeg("K ML", "K @ L", -105, 125),
  ];
  const calc = (ls) => calcParlayEV(ls, 30, 100);
  const sync3 = findTopParlays(legs, 3, 30, 100, 10);
  const async3 = await findTopParlaysChunked(legs, 3, calc, { maxResults: 10, yieldMs: 0 });
  assert.deepEqual(namesOf(async3), namesOf(sync3));
  for (let i = 0; i < sync3.length; i++) {
    assert.ok(Math.abs(async3[i].ev - sync3[i].ev) < 1e-9);
  }
  const sync4 = findTopParlays(legs, 4, 30, 100, 5);
  const async4 = await findTopParlaysChunked(legs, 4, calc, { maxResults: 5, yieldMs: 0 });
  assert.deepEqual(namesOf(async4), namesOf(sync4));
}

// ── Yields during a 3-leg scan; abort stops work
{
  const legs = Array.from({ length: 16 }, (_, i) => mkLeg(`L${i}`, `G${i} @ X`, 100 + i, -110));
  let yields = 0;
  const calc = (ls) => calcParlayEV(ls, 0, 100);
  const out = await findTopParlaysChunked(legs, 3, calc, {
    maxResults: 8,
    yieldMs: 0,
    yieldFn: async () => { yields++; },
  });
  assert.ok(out.length >= 1);
  assert.ok(yields >= 1, "chunked scan must yield to the event loop");

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => findTopParlaysChunked(legs, 3, calc, { signal: ac.signal, yieldMs: 0 }),
    (err) => err.name === "AbortError",
  );
}

// ── Chunked 3-leg scan keeps the event loop moving (no multi-second stall)
{
  const legs = Array.from({ length: 36 }, (_, i) => mkLeg(`L${i}`, `G${i} @ X`, 110 + i, -110));
  const calc = (ls) => calcParlayEV(ls, 30, 100);
  let maxGap = 0;
  let last = Date.now();
  const ping = setInterval(() => {
    const now = Date.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 5);
  const ranked = await findTopParlaysChunked(legs, 3, calc, { maxResults: 10, yieldMs: 8 });
  clearInterval(ping);
  assert.equal(ranked.length, 10);
  assert.ok(maxGap < 120, `event-loop stall was ${maxGap}ms`);
}

console.log("promoParlayScan.test.js: ok");
