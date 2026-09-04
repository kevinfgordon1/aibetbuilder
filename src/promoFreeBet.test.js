import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { calcFreeBetParlayEV, calcFreeBetConversion, attachFreeBetLock } from "./promoFreeBet.js";
import { findTopParlaysChunked, rescaleParlaysForStake } from "./promoParlayScan.js";

const require = createRequire(import.meta.url);
const { calcParlayEV, ourTrueProb, dkDecimal } = require("../lib/promo-ev.js");
const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");

function mkLeg(name, game, dk, bestOpp, extra = {}) {
  return {
    name, dk, bestOpp, game,
    commence_time: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    sport: "baseball_mlb",
    bestOppBook: extra.bestOppBook || "fanduel",
    bestOppName: extra.bestOppName || `${name} opp`,
    market: extra.market || "ML",
  };
}

// ── Free-bet EV math vs boost math
{
  const legs = [
    { dk: 150, bestOpp: -130 },
    { dk: -110, bestOpp: 120 },
    { dk: 100, bestOpp: -110 },
  ];
  const fb = calcFreeBetParlayEV(legs, 50);
  const boost0 = calcParlayEV(legs, 0, 50);
  let parlayDec = 1;
  let combinedProb = 1;
  for (const l of legs) {
    parlayDec *= dkDecimal(l.dk);
    combinedProb *= ourTrueProb(l.bestOpp);
  }
  const winProfit = (parlayDec - 1) * 50;
  assert.ok(Math.abs(fb.parlayDec - parlayDec) < 1e-12);
  assert.ok(Math.abs(fb.combinedProb - combinedProb) < 1e-12);
  assert.ok(Math.abs(fb.winProfit - winProfit) < 1e-12);
  assert.ok(Math.abs(fb.ev - combinedProb * winProfit) < 1e-12);
  assert.equal(fb.parlayOdds, boost0.parlayOdds);
  // Same win profit at 0% boost, but boost EV subtracts cash loss.
  assert.ok(Math.abs(fb.winProfit - boost0.boostedProfit) < 1e-12);
  assert.ok(Math.abs(fb.ev - (boost0.ev + (1 - combinedProb) * 50)) < 1e-12);
  // Ranking by EV equals ranking by p×(D−1) for a fixed FB $.
  const fb100 = calcFreeBetParlayEV(legs, 100);
  assert.ok(Math.abs(fb100.ev / 100 - fb.ev / 50) < 1e-12);
}

// ── lib/promo-ev.js stays in lockstep with src/promoFreeBet.js
{
  const libFb = require("../lib/promo-ev.js").calcFreeBetParlayEV;
  const legs = [{ dk: 200, bestOpp: 100 }, { dk: -105, bestOpp: 115 }];
  const a = calcFreeBetParlayEV(legs, 75);
  const b = libFb(legs, 75);
  assert.equal(a.ev, b.ev);
  assert.equal(a.winProfit, b.winProfit);
  assert.equal(a.parlayDec, b.parlayDec);
  assert.equal(a.combinedProb, b.combinedProb);
  assert.equal(a.parlayOdds, b.parlayOdds);
}

// ── 1-leg lock still works (conversion overlay)
{
  const leg = mkLeg("A ML", "A @ B", 100, -110);
  const ev = calcFreeBetParlayEV([leg], 100);
  const locked = attachFreeBetLock({ legs: [leg], ...ev }, 100);
  const conv = calcFreeBetConversion(100, -110, 100);
  assert.equal(locked.isGuaranteed, true);
  assert.ok(locked.lock);
  assert.equal(locked.lock.valid, true);
  assert.ok(Math.abs(locked.lock.hedgeStake - conv.hedgeStake) < 1e-12);
  assert.ok(Math.abs(locked.lock.guaranteedCash - conv.guaranteedCash) < 1e-12);
  assert.ok(locked.lock.conversionRate > 0);
  // Classic +100 vs -110: hedge = 1×100 / (1+100/110) wait d_h = 1 + 100/110
  const d_h = dkDecimal(-110);
  assert.ok(Math.abs(locked.lock.hedgeStake - (2 - 1) * 100 / d_h) < 1e-12);
}

// ── Multi-leg has no lock (same rule as multi-leg boost)
{
  const legs = [
    mkLeg("A ML", "A @ B", 150, 100),
    mkLeg("C ML", "C @ D", 140, 105),
    mkLeg("E ML", "E @ F", 120, 110),
  ];
  const ev = calcFreeBetParlayEV(legs, 100);
  const multi = attachFreeBetLock({ legs, ...ev }, 100);
  assert.equal(multi.lock, null);
  assert.equal(multi.isGuaranteed, false);
}

// ── 1-leg without an opposite is not a fake lock
{
  const leg = mkLeg("A ML", "A @ B", 100, null);
  const ev = calcFreeBetParlayEV([leg], 100);
  const unlocked = attachFreeBetLock({ legs: [leg], ...ev }, 100);
  assert.equal(unlocked.isGuaranteed, false);
  assert.equal(unlocked.lock.valid, false);
}

// ── Chunked scan ranks by free-bet EV (not boost EV)
{
  const legs = [
    mkLeg("A ML", "A @ B", 400, 100),   // longshot: high conversion, lower p
    mkLeg("C ML", "C @ D", -150, 180),  // favorite
    mkLeg("E ML", "E @ F", 110, -130),
    mkLeg("G ML", "G @ H", 120, -140),
    mkLeg("I ML", "I @ J", 105, -120),
    mkLeg("K ML", "K @ L", 130, -110),
  ];
  const fbCalc = (ls) => calcFreeBetParlayEV(ls, 100);
  const boostCalc = (ls) => calcParlayEV(ls, 0, 100);
  const fbRanked = await findTopParlaysChunked(legs, 3, fbCalc, { maxResults: 10, yieldMs: 0 });
  const boostRanked = await findTopParlaysChunked(legs, 3, boostCalc, { maxResults: 10, yieldMs: 0 });
  assert.ok(fbRanked.length >= 1);
  assert.equal(fbRanked[0].legs.length, 3);
  assert.equal(new Set(fbRanked[0].legs.map((l) => l.game)).size, 3);
  for (let i = 1; i < fbRanked.length; i++) {
    assert.ok(fbRanked[i - 1].ev >= fbRanked[i].ev, "free-bet results ranked by EV");
  }
  // Same combos can rank differently: free-bet does not penalize a loss.
  const fbNames = fbRanked.map((p) => p.legs.map((l) => l.name).sort().join("|"));
  const boostNames = boostRanked.map((p) => p.legs.map((l) => l.name).sort().join("|"));
  assert.ok(fbNames.length > 0 && boostNames.length > 0);
}

// ── 1-leg chunked scan + lock overlay; 3-leg stays unlocked
{
  const legs = [
    mkLeg("A ML", "A @ B", 150, 100),
    mkLeg("C ML", "C @ D", 140, 105),
    mkLeg("E ML", "E @ F", 120, 110),
  ];
  const singles = await findTopParlaysChunked(legs, 1, (ls) => calcFreeBetParlayEV(ls, 100), {
    maxResults: 10, yieldMs: 0,
  });
  assert.ok(singles.length >= 1);
  const withLocks = singles.map((p) => attachFreeBetLock(p, 100));
  assert.ok(withLocks.every((p) => p.legs.length === 1));
  assert.ok(withLocks.some((p) => p.isGuaranteed));

  const triples = await findTopParlaysChunked(legs, 3, (ls) => calcFreeBetParlayEV(ls, 100), {
    maxResults: 5, yieldMs: 0,
  });
  assert.ok(triples.length >= 1);
  for (const p of triples.map((x) => attachFreeBetLock(x, 100))) {
    assert.equal(p.legs.length, 3);
    assert.equal(p.lock, null);
    assert.equal(p.isGuaranteed, false);
  }
}

// ── Free-bet $ rescale is linear (no rescan)
{
  const legs = [mkLeg("A ML", "A @ B", 150, 100), mkLeg("C ML", "C @ D", 140, 105)];
  const at100 = calcFreeBetParlayEV(legs, 100);
  const at40 = calcFreeBetParlayEV(legs, 40);
  const scaled = rescaleParlaysForStake([{ legs, ...at100 }], 100, 40)[0];
  assert.ok(Math.abs(scaled.ev - at40.ev) < 1e-9);
  assert.ok(Math.abs(scaled.winProfit - at40.winProfit) < 1e-9);
  assert.equal(scaled.parlayDec, at40.parlayDec);
  assert.equal(scaled.combinedProb, at40.combinedProb);
}

// ── Legs UI + scan wiring shown for freebet (App.jsx)
{
  assert.match(app, /promoType === "boost" \|\| promoType === "nosweat" \|\| promoType === "freebet"/);
  assert.match(app, /<label style=\{labelStyle\}>Legs<\/label>/);
  const legsControl = app.match(/\{(\(promoType === "boost" \|\| promoType === "nosweat" \|\| promoType === "freebet"\)) && controlBox\(<>\s*<label style=\{labelStyle\}>Legs<\/label>/);
  assert.ok(legsControl, "Legs control must render for freebet, not only boost/nosweat");
  assert.match(app, /calcFreeBetParlayEV\(ls, atStake\)/);
  assert.match(app, /findTopParlaysChunked/);
  assert.match(app, /attachFreeBetLock\(p, stake\)/);
  assert.match(app, /promoScanInputKey/);
  assert.match(app, /promoScanEmptyState/);
  assert.match(app, /const isParlayPromo = promoType === "boost" \|\| promoType === "nosweat" \|\| promoType === "freebet"/);
  assert.doesNotMatch(app, /const scannedFreeBetConversions = useMemo/);
  assert.doesNotMatch(app, /findTopFreeBetConversions/);
  // Empty state waits for first scan — same machine as boost/nosweat.
  assert.match(app, /freeBetEmptyState === "no-results"/);
  assert.match(app, /freeBetEmptyState === "scanning"/);
  assert.doesNotMatch(app, /topFreeBetsWithLock\.length === 0 && !promoScanBusy/);
  // 1-leg lock UI still present; multi-leg copy forbids a fake 2-way lock.
  assert.match(app, /showLock = isSingle && p\.isGuaranteed && p\.lock/);
  assert.match(app, /guaranteed cash · \{\(p\.lock\.conversionRate \* 100\)\.toFixed\(1\)\}%/);
  assert.match(app, /Multi-leg free bets cannot be locked on both sides at once/);
  assert.match(app, /free bet can be a parlay|Use a free bet on a single or a parlay|Use a free bet on a parlay ranked by free-bet EV/);
  assert.match(app, /1-leg still converts to locked cash/);
  // Debounce FB $ the same way as stake (PROMO_SCAN_DEBOUNCE_MS).
  assert.match(app, /useDebouncedValue\(stake,\s*PROMO_SCAN_DEBOUNCE_MS\)/);
  assert.match(app, /const PROMO_SCAN_DEBOUNCE_MS = 150/);
  // Min final / min leg filters apply to freebet.
  assert.match(app, /promoType === "freebet"\) && numLegs >= 2 && controlBox\(<>\s*<label style=\{labelStyle\}>Min Leg Odds<\/label>/);
}

// ── No sync free-bet scan in render
{
  const memoBlocks = [...app.matchAll(/useMemo\(\(\) => \{([\s\S]*?)\}, \[/g)].map((m) => m[1]);
  for (const block of memoBlocks) {
    assert.doesNotMatch(block, /findTopParlaysChunked\(/);
    assert.doesNotMatch(block, /findTopParlays\(/);
    assert.doesNotMatch(block, /findTopFreeBetConversions\(/);
  }
}

console.log("promoFreeBet.test.js: ok");
