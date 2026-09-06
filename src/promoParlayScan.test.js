import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { rescaleParlaysForStake, rescaleFreeBetConversions, findTopParlaysChunked, promoScanEmptyState, promoScanInputKey, considerTopByEv, finalizeTopByEv, preferTimerYield, shouldTake, passesOddsBounds } from "./promoParlayScan.js";
import { calcNoSweatEV } from "./promoNoSweat.js";

const require = createRequire(import.meta.url);
const { calcParlayEV, findTopParlays } = require("../lib/promo-ev.js");
const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
const scanSrc = fs.readFileSync(path.join(dir, "promoParlayScan.js"), "utf8");

// ── App.jsx keeps enumerate-then-sort findTopParlays (heap declined)
{
  assert.match(app, /function findTopParlays\(/);
  assert.match(app, /function growParlaysFromTop3\(/);
  assert.match(app, /results\.push\(\{ legs: \[l\], \.\.\.r \}\)/);
  assert.match(app, /results\.sort\(\(a, b\) => b\.ev - a\.ev\)/);
  assert.match(app, /return results\.slice\(0, maxResults\)/);
  assert.doesNotMatch(app, /EvMinHeap|scanParlayCombos/);
  assert.match(app, /const PARLAY_LEG_CAP = 200/);
  // Chunked React path streams top-k so Safari does not allocate C(n,3).
  assert.match(scanSrc, /considerTopByEv/);
  assert.match(scanSrc, /finalizeTopByEv/);
  assert.match(scanSrc, /shouldTake/);
  assert.match(scanSrc, /preferTimerYield/);
  assert.doesNotMatch(scanSrc, /results\.push\(\{ legs: \[list\[i\], list\[j\], list\[k\]\]/);
}

// ── Debounce + memo + page-reset deps (no boost/stake churn)
{
  assert.match(app, /const PROMO_SCAN_DEBOUNCE_MS = 150/);
  assert.match(app, /useDebouncedValue\(boostPct/);
  assert.match(app, /useDebouncedValue\(stake/);
  assert.match(app, /useDebouncedValue\(minFinalOdds/);
  assert.match(app, /useDebouncedValue\(maxFinalOdds/);
  assert.match(app, /useDebouncedValue\(minLegOdds/);
  assert.match(app, /useDebouncedValue\(maxLegOdds/);
  assert.match(app, /scanBoostPct/);
  assert.match(app, /scanMinFinalOdds/);
  assert.match(app, /scanMaxFinalOdds/);
  assert.match(app, /scanMinLegOdds/);
  assert.match(app, /scanMaxLegOdds/);
  assert.match(app, /rescaleParlaysForStake/);
  assert.match(app, /const promoLegs = useMemo\(/);
  assert.match(app, /const parlayLegPool = useMemo\(/);
  assert.match(app, /const topParlays = useMemo\(/);
  assert.match(app, /const topNoSweats = useMemo\(/);
  assert.match(app, /calcFreeBetParlayEV/);
  assert.doesNotMatch(app, /const scannedFreeBetConversions = useMemo/);
  assert.match(app, /const topFreeBets = useMemo\(/);
  assert.match(app, /const topFreeBetsWithLock = useMemo\(/);
  assert.match(app, /promoScanInputKey/);
  assert.match(app, /promoType === "freebet"/);
  const resetDeps = app.match(/setExpandedFreeBet\(null\);\s*\}, \[([^\]]+)\]/);
  assert.ok(resetDeps, "promo page reset effect");
  assert.doesNotMatch(resetDeps[1], /\bboostPct\b/);
  assert.doesNotMatch(resetDeps[1], /\bstake\b/);
  assert.match(resetDeps[1], /promoBook/);
  assert.match(resetDeps[1], /numLegs/);
  assert.match(resetDeps[1], /maxFinalOdds/);
  assert.match(resetDeps[1], /maxLegOdds/);
  assert.match(resetDeps[1], /minFinalOdds/);
  assert.match(resetDeps[1], /minLegOdds/);
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
  assert.match(app, /freeBetEmptyState === "no-results"/);
  assert.match(app, /freeBetEmptyState === "scanning"/);
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
  assert.doesNotMatch(
    app,
    /topFreeBetsWithLock\.length === 0 && !promoScanBusy/,
    "No Results must not key off busy=false + empty freebets",
  );
  assert.match(app, /if \(!promoLoaded\) \{\s*setPromoScanBusy\(false\);\s*return;/);
  assert.match(app, /\[promoType, parlayLegPool, numLegs, scanBoostPct, parsedMinFinal, parsedMaxFinal, refundPct, creditConversionPct, promoLoaded, currentPromoScanKey\]/);
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
    parsedMinFinal: null, parsedMaxFinal: null, refundPct: 100, creditConversionPct: 70,
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

// ── Streaming top-k stays bounded and matches full-sort top-k
{
  const heap = [];
  assert.equal(shouldTake(heap, 1, 3), true);
  considerTopByEv(heap, { ev: 1 }, 3);
  considerTopByEv(heap, { ev: 5 }, 3);
  considerTopByEv(heap, { ev: 3 }, 3);
  assert.equal(shouldTake(heap, heap[0].ev, 3), false);
  assert.equal(shouldTake(heap, heap[0].ev + 0.01, 3), true);
}

{
  const heap = [];
  for (let i = 0; i < 5000; i++) {
    considerTopByEv(heap, { ev: i, id: i }, 8);
    assert.ok(heap.length <= 8, "top-k heap must never grow past maxResults");
  }
  const top = finalizeTopByEv(heap);
  assert.equal(top.length, 8);
  assert.deepEqual(top.map((x) => x.id), [4999, 4998, 4997, 4996, 4995, 4994, 4993, 4992]);
}

{
  const legs = Array.from({ length: 28 }, (_, i) => mkLeg(`L${i}`, `G${i} @ X`, 100 + i * 3, -110 + (i % 7)));
  const calc = (ls) => calcParlayEV(ls, 30, 100);
  const sync = findTopParlays(legs, 3, 30, 100, 12);
  const streamed = await findTopParlaysChunked(legs, 3, calc, { maxResults: 12, yieldMs: 0 });
  assert.deepEqual(namesOf(streamed), namesOf(sync));
  for (let i = 0; i < sync.length; i++) {
    assert.ok(Math.abs(streamed[i].ev - sync[i].ev) < 1e-9);
  }
}

{
  assert.equal(preferTimerYield(), false, "Node / no UA → timer yield off");
  assert.equal(preferTimerYield({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  }), true, "iPhone Safari uses timer yield");
  assert.equal(preferTimerYield({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  }), true, "desktop Safari uses timer yield");
  assert.equal(preferTimerYield({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  }), false, "Chrome stays on MessageChannel");
}

// ── Max final odds: American-numeric (same convention as min)
{
  assert.equal(passesOddsBounds(150, null, 200), true);
  assert.equal(passesOddsBounds(300, null, 200), false, "longer than +200 is over max");
  assert.equal(passesOddsBounds(-150, null, 200), true, "favorite is under a +200 max");
  assert.equal(passesOddsBounds(-200, null, -110), true, "shorter favorite passes max -110");
  assert.equal(passesOddsBounds(100, null, -110), false, "+100 is over a -110 max");
  assert.equal(passesOddsBounds(-150, -200, 200), true);
  assert.equal(passesOddsBounds(300, -200, 200), false);
}

{
  const base = {
    promoType: "boost", numLegs: 3, scanBoostPct: 30,
    parsedMinFinal: null, parsedMaxFinal: null, refundPct: 100, creditConversionPct: 70,
    pool: [{ game: "A @ B", name: "A ML" }],
  };
  const noMax = promoScanInputKey(base);
  const withMax = promoScanInputKey({ ...base, parsedMaxFinal: 400 });
  assert.notEqual(noMax, withMax, "changing max final odds must change the scan key");
}

{
  const legs = [
    mkLeg("Dog ML", "A @ B", 300, -110),
    mkLeg("Mid ML", "C @ D", 150, -120),
    mkLeg("Fav ML", "E @ F", -150, 130),
  ];
  const calc = (ls) => calcParlayEV(ls, 0, 100);
  const all = await findTopParlaysChunked(legs, 1, calc, { maxResults: 10, yieldMs: 0 });
  assert.equal(all.length, 3);
  const capped = await findTopParlaysChunked(legs, 1, calc, {
    maxResults: 10, maxFinalOdds: 200, yieldMs: 0,
  });
  assert.deepEqual(capped.map((p) => p.legs[0].name).sort(), ["Fav ML", "Mid ML"]);
  assert.ok(capped.every((p) => p.parlayOdds <= 200));
  const syncCapped = findTopParlays(legs, 1, 0, 100, 10, null, 200);
  assert.deepEqual(namesOf(capped), namesOf(syncCapped));
}

{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const mk = (name, game) => ({
    name, dk: -110, bestOpp: 120, game, commence_time: future, sport: "baseball_mlb",
  });
  const legs = [
    mk("A ML", "A @ B"),
    mk("C ML", "C @ D"),
    mk("E ML", "E @ F"),
    mk("G ML", "G @ H"),
  ];
  const calc = (ls) => calcParlayEV(ls, 0, 100);
  const three = await findTopParlaysChunked(legs, 3, calc, { maxResults: 10, yieldMs: 0 });
  const threeOdds = three[0].parlayOdds;
  const fourOpen = await findTopParlaysChunked(legs, 4, calc, { maxResults: 10, yieldMs: 0 });
  assert.ok(fourOpen.length >= 1);
  const fourCapped = await findTopParlaysChunked(legs, 4, calc, {
    maxResults: 10, maxFinalOdds: threeOdds, yieldMs: 0,
  });
  assert.equal(fourCapped.length, 0, "4-leg longer than the 3-leg seed is over maxFinalOdds");
  const threeCapped = await findTopParlaysChunked(legs, 3, calc, {
    maxResults: 10, maxFinalOdds: threeOdds, yieldMs: 0,
  });
  assert.ok(threeCapped.length >= 1, "3-leg at the max bound is kept");
}

{
  assert.match(app, /<label style=\{labelStyle\}>Max Final Odds<\/label>/);
  assert.match(app, /<label style=\{labelStyle\}>Max Leg Odds<\/label>/);
  assert.match(app, /const \[maxFinalOdds, setMaxFinalOdds\] = useState\(""\)/);
  assert.match(app, /const \[maxLegOdds, setMaxLegOdds\] = useState\(""\)/);
  assert.match(app, /parsedMaxFinal/);
  assert.match(app, /parsedMaxLeg/);
  assert.match(app, /buildAllLegsForBook\(promoOddsData, promoBook, promoSportFilter, parsedMinLeg, promoDateRange, parsedMaxLeg\)/);
  assert.match(app, /maxFinalOdds: parsedMaxFinal/);
  assert.match(app, /parts\.push\(`max \$\{maxFinalOdds\}`\)/);
  assert.match(app, /parts\.push\(`legs max \$\{maxLegOdds\}`\)/);
  assert.doesNotMatch(app, /function StatCard/);
}

console.log("promoParlayScan.test.js: ok");
