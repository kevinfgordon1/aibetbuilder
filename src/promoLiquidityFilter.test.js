import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { applyPmBlendToLeg } from "./blendAskLadder.js";
import {
  HIDE_LOW_LIQUIDITY_LABEL,
  LIQUIDITY_FILTER_ALL_LABEL,
  liquidityFilterSummary,
  filterLowLiquidityLegs,
  filterLowLiquidityPicks,
} from "./promoLiquidityFilter.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");

assert.equal(HIDE_LOW_LIQUIDITY_LABEL, "Hide low liquidity");
assert.equal(LIQUIDITY_FILTER_ALL_LABEL, "All");
assert.equal(liquidityFilterSummary(false), "");
assert.equal(liquidityFilterSummary(true), "hide low liquidity");
assert.equal(liquidityFilterSummary(null), "");

function blend(leg, ctx) {
  return applyPmBlendToLeg(leg, null, ctx);
}

// Nationals-style thin Novig: ~$73 of $500 profit (multi-leg payout walk).
const nationalsNovig = {
  dk: -110,
  bestOpp: 223,
  bestOppBook: "novig",
  bestOppSize: 33,
  sport: "baseball_mlb",
  game: "Nationals @ Rival",
  name: "Nationals ML",
  bestOppName: "Rival ML",
  market: "ML",
};

// Deep enough PM book for $500 profit at −200: size 1000 → profit 500.
const deepKalshi = {
  dk: 200,
  bestOpp: -200,
  bestOppBook: "kalshi",
  bestOppSize: 1000,
  sport: "mlb",
  game: "A @ B",
  name: "A ML",
  bestOppName: "B ML",
  market: "ML",
};

// 1-leg +200 / −200 / $100 / 100% boost needs $333.33 hedge.
const hedgeShortNovig = {
  dk: 200,
  bestOpp: -200,
  bestOppBook: "novig",
  bestOppSize: 100,
  sport: "mlb",
  game: "C @ D",
  name: "C ML",
  bestOppName: "D ML",
  market: "ML",
};
const hedgeFullKalshi = {
  ...hedgeShortNovig,
  bestOppBook: "kalshi",
  bestOppSize: 400,
  game: "E @ F",
  name: "E ML",
  bestOppName: "F ML",
};

const sportsbookFd = {
  dk: 200,
  bestOpp: -200,
  bestOppBook: "fanduel",
  bestOppSize: 50,
  sport: "mlb",
  game: "G @ H",
  name: "G ML",
  bestOppName: "H ML",
  market: "ML",
};

const multiCtx = { promoType: "boost", numLegs: 3, stake: 100, boostPct: 30 };
const singleCtx = { promoType: "boost", numLegs: 1, stake: 100, boostPct: 100 };

{
  const thin = blend(nationalsNovig, multiCtx);
  assert.equal(thin.lowLiquidity, true, "thin Novig fails $500 profit walk");
  assert.ok(thin.pmBlend && thin.pmBlend.payoutFilled < 500);
  assert.ok(Math.abs(thin.pmBlend.payoutFilled - 73.59) < 1, `expected ~$73 profit, got ${thin.pmBlend.payoutFilled}`);

  const deep = blend(deepKalshi, multiCtx);
  assert.equal(deep.lowLiquidity, false);

  const fd = blend(sportsbookFd, multiCtx);
  assert.equal(fd.lowLiquidity, false);
  assert.equal(fd.pmBlend, null);
}

{
  const short = blend(hedgeShortNovig, singleCtx);
  assert.equal(short.lowLiquidity, true, "1-leg $100 book cannot fund $333.33 hedge");
  const full = blend(hedgeFullKalshi, singleCtx);
  assert.equal(full.lowLiquidity, false);
}

// ── filter off: keep multi-leg shortfall and 1-leg incomplete hedge
{
  const legs = [nationalsNovig, deepKalshi, hedgeShortNovig, sportsbookFd];
  assert.equal(filterLowLiquidityLegs(legs, false, multiCtx), legs);
  assert.deepEqual(filterLowLiquidityLegs(legs, false, multiCtx), legs);

  const thinPick = { ev: 40, legs: [blend(nationalsNovig, multiCtx)] };
  const deepPick = { ev: 10, legs: [blend(deepKalshi, multiCtx)] };
  const shortHedgePick = { ev: 20, legs: [blend(hedgeShortNovig, singleCtx)] };
  const picks = [thinPick, deepPick, shortHedgePick];
  assert.equal(filterLowLiquidityPicks(picks, false), picks);
  assert.deepEqual(filterLowLiquidityPicks(picks, false).map((p) => p.ev), [40, 10, 20]);
}

// ── filter on: multi-leg $500-profit shortfall drops; sportsbook + deep stay
{
  const legs = [nationalsNovig, deepKalshi, sportsbookFd];
  const kept = filterLowLiquidityLegs(legs, true, multiCtx);
  assert.deepEqual(kept.map((l) => l.bestOppBook), ["kalshi", "fanduel"]);
  assert.ok(kept.includes(deepKalshi));
  assert.ok(kept.includes(sportsbookFd));
  assert.ok(!kept.includes(nationalsNovig));
  // Original objects, not blended copies
  assert.equal(kept[0], deepKalshi);
  assert.equal(kept[0].bestOpp, -200);

  const mixedPick = {
    ev: 30,
    legs: [blend(deepKalshi, multiCtx), blend(nationalsNovig, multiCtx)],
  };
  const liquidPick = { ev: 8, legs: [blend(deepKalshi, multiCtx), blend(sportsbookFd, multiCtx)] };
  const ranked = filterLowLiquidityPicks([mixedPick, liquidPick], true);
  assert.deepEqual(ranked.map((p) => p.ev), [8]);
}

// ── filter on: 1-leg incomplete hedge drops; full hedge + sportsbook stay
{
  const legs = [hedgeShortNovig, hedgeFullKalshi, sportsbookFd];
  const kept = filterLowLiquidityLegs(legs, true, singleCtx);
  assert.deepEqual(kept.map((l) => l.bestOppBook), ["kalshi", "fanduel"]);
  assert.ok(!kept.includes(hedgeShortNovig));

  const shortPick = { ev: 50, legs: [blend(hedgeShortNovig, singleCtx)] };
  const fullPick = { ev: 12, legs: [blend(hedgeFullKalshi, singleCtx)] };
  const fdPick = { ev: 5, legs: [blend(sportsbookFd, singleCtx)] };
  const ranked = filterLowLiquidityPicks([shortPick, fullPick, fdPick], true);
  assert.deepEqual(ranked.map((p) => p.ev), [12, 5]);
}

{
  assert.deepEqual(filterLowLiquidityLegs(null, true, multiCtx), []);
  assert.deepEqual(filterLowLiquidityLegs(undefined, false, multiCtx), []);
  assert.deepEqual(filterLowLiquidityPicks(null, true), []);
  assert.deepEqual(filterLowLiquidityPicks(undefined, false), []);
}

// ── App.jsx Extra Filters: chip row + pool + ranked list use shared helper
{
  assert.match(app, /import \{\s*HIDE_LOW_LIQUIDITY_LABEL,\s*LIQUIDITY_FILTER_ALL_LABEL,\s*liquidityFilterSummary,\s*filterLowLiquidityLegs,\s*filterLowLiquidityPicks,\s*\} from "\.\/promoLiquidityFilter\.js"/);
  assert.match(app, /const \[hideLowLiquidity, setHideLowLiquidity\] = useState\(true\)/);
  assert.match(app, /filterLowLiquidityLegs\(/);
  assert.match(app, /filterLowLiquidityPicks\(/);
  assert.match(app, /hideLowLiquidity/);
  assert.match(app, /liquidityFilterSummary\(hideLowLiquidity\)/);
  assert.match(app, /<label style=\{labelStyle\}>Liquidity<\/label>/);
  assert.match(app, /HIDE_LOW_LIQUIDITY_LABEL/);
  assert.match(app, /LIQUIDITY_FILTER_ALL_LABEL/);
  const resetDeps = app.match(/setExpandedFreeBet\(null\);\s*\}, \[([^\]]+)\]/);
  assert.ok(resetDeps, "promo page reset effect");
  assert.match(resetDeps[1], /hideLowLiquidity/);
  assert.doesNotMatch(resetDeps[1], /\bstake\b/);
  assert.doesNotMatch(resetDeps[1], /\bboostPct\b/);
}

console.log("promoLiquidityFilter.test.js: ok");
