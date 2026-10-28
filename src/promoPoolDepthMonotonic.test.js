// Regression (Kevin, 2026-10-28): DraftKings 50% Profit Boost, $100, 3 legs,
// NBA Today, Hide low liquidity, Min depth per leg $2,000. Moneylines alone
// showed +$36.35; Main + Moneylines showed +$34.02. A superset of legs must
// never show a worse Best Pick.
//
// Cause: the scan ranked combos on stored / feed top-of-book ladders, kept
// the top 1,000, trimmed to 150, and only those 150 got the live depth walk.
// Live depth moves leg prices both ways (NBA Oct 28: Raptors -4.5 scanned at
// Kalshi -103 because Novig +106 had only ~$1,076 of profit on the feed; the
// live Novig ladder covers $2,000), so the live-best combo could sit outside
// the cut, and Main's extra spreads/totals pushed it out. Fix: price the pool
// legs with live ladders first (depthPricePoolLegs), so scan EV = card EV.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { depthCacheKey } from "./promoBookDepth.js";
import { overlayBlendedParlay, rankPromoPicks, depthPricePoolLegs, poolDepthPicks, collectPromoDepthLegs, PROMO_DEPTH_WINDOW_MAX } from "./promoListRank.js";
import { findTopParlaysExact, linearEvForm } from "./promoExactScan.js";
import { diversifyTopParlays, SCAN_DEEP_RESULTS } from "./promoParlayScan.js";
import { filterLowLiquidityLegs } from "./promoLiquidityFilter.js";
import { filterLegsByMinDepth, repriceLegsForMinDepth } from "./promoMinDepth.js";
import { preBlendStoredLadderLegs } from "./blendAskLadder.js";
import { scopePromoLegs } from "./promoMarketScope.js";

const require = createRequire(import.meta.url);
const { calcParlayEV } = require("../lib/promo-ev.js");
const calcs = { calcParlayEV, calcNoSweatFromLegs: null, calcFreeBetParlayEV: null };
const overlay = (p, legs, ctx) => overlayBlendedParlay(p, legs, ctx, calcs);
const STAKE = 100, BOOST = 50, MIN = 2000, N = 3;
const ctx = { promoType: "boost", numLegs: N, stake: STAKE, boostPct: BOOST, hideLowLiquidity: true, minLegDepth: MIN, includeTeamTokens: [], excludeTeamTokens: [] };
const T = "2026-10-28T23:10:00Z";

// 12 games. Moneyline: best opp on Kalshi but the feed shows only a small top
// size, so the stored walk falls to a worse Novig quote; the LIVE Kalshi
// ladder is deep (card price is better than the scan thought). Spread: the
// feed shows a deep Kalshi top, but the LIVE ladder is thin, so the card
// falls to a worse Novig quote (card price is worse than the scan thought).
const legs = [];
const live = {};
for (let g = 0; g < 12; g++) {
  const game = `Away${g} @ Home${g}`;
  const base = { sport: "basketball_nba", game, commence_time: T, bookKey: "draftkings" };
  const mlOpp = -160 - g;
  legs.push({ ...base, name: `Home${g} ML`, bestOppName: `Away${g} ML`, market: "ML", dk: 150, bestOpp: mlOpp, bestOppBook: "kalshi", bestOppSize: 200,
    bestOppVenues: [{ book: "kalshi", american: mlOpp, size: 200 }, { book: "novig", american: mlOpp - 20, size: 20000 }] });
  live[depthCacheKey({ ...base, bestOppBook: "kalshi", bestOppName: `Away${g} ML`, market: "ML" })] = [{ american: mlOpp, size: 20000 }];
  live[depthCacheKey({ ...base, bestOppBook: "novig", bestOppName: `Away${g} ML`, market: "ML" })] = [{ american: mlOpp - 20, size: 20000 }];
  const spOpp = 105 - (g % 3);
  legs.push({ ...base, name: `Home${g} -4.5`, bestOppName: `Away${g} +4.5`, market: "SPR", dk: -110, bestOpp: spOpp, bestOppBook: "kalshi", bestOppSize: 20000,
    bestOppVenues: [{ book: "kalshi", american: spOpp, size: 20000 }, { book: "novig", american: -110, size: 20000 }] });
  live[depthCacheKey({ ...base, bestOppBook: "kalshi", bestOppName: `Away${g} +4.5`, market: "SPR" })] = [{ american: spOpp, size: 50 }];
  live[depthCacheKey({ ...base, bestOppBook: "novig", bestOppName: `Away${g} +4.5`, market: "SPR" })] = [{ american: -110, size: 20000 }];
}

async function bestPick(scope, fixed) {
  const raw = filterLegsByMinDepth(filterLowLiquidityLegs(scopePromoLegs(legs, scope), true, { promoType: "boost", numLegs: N }), MIN);
  let pool = repriceLegsForMinDepth(preBlendStoredLadderLegs(raw, { promoType: "boost", numLegs: N }), MIN);
  if (fixed) pool = depthPricePoolLegs(pool, ctx, live);
  const calc = (ls) => calcParlayEV(ls, BOOST, STAKE);
  const deep = await findTopParlaysExact(pool, N, calc, linearEvForm("boost", STAKE, BOOST), { maxResults: SCAN_DEEP_RESULTS, yieldFn: () => Promise.resolve() });
  const kept = diversifyTopParlays(deep);
  const base = rankPromoPicks(kept, ctx, (p) => p, overlay);
  const window = base.slice(0, Math.min(base.length, PROMO_DEPTH_WINDOW_MAX));
  const ranked = rankPromoPicks(window, ctx, (p) => p, overlay, live);
  const scanEv = new Map(deep.map((p) => [p.legs.map((l) => l.name).sort().join("+"), p.ev]));
  return { best: ranked[0], ranked, scanEv };
}

// Old pipeline reproduces the bug: Moneylines-only beats Main + Moneylines.
{
  const ml = await bestPick(["ml"], false);
  const sup = await bestPick(["main", "ml"], false);
  assert.ok(ml.best && sup.best);
  assert.ok(ml.best.ev > sup.best.ev + 1, `old pipeline should show the bug: ML ${ml.best.ev} vs Main+ML ${sup.best.ev}`);
}

// Fixed: superset >= subset, and every card EV equals its scan EV.
{
  const ml = await bestPick(["ml"], true);
  const sup = await bestPick(["main", "ml"], true);
  const all = await bestPick(["all"], true);
  assert.ok(sup.best.ev >= ml.best.ev - 1e-9, `Main+ML ${sup.best.ev} < ML ${ml.best.ev}`);
  assert.ok(all.best.ev >= sup.best.ev - 1e-9);
  assert.equal(sup.best.legs.every((l) => l.market === "ML"), true, "the all-moneyline combo is the real best here");
  for (const p of sup.ranked) {
    const s = sup.scanEv.get(p.legs.map((l) => l.name).sort().join("+"));
    assert.ok(Math.abs(s - p.ev) < 1e-6, `scan EV ${s} != card EV ${p.ev}`);
  }
}

// Ladders still loading: pool unchanged. A key that was not fetched or whose
// venue read failed keeps the stored price (never dropped as thin).
{
  assert.equal(depthPricePoolLegs(legs, ctx, null), legs);
  const partial = { ...live };
  delete partial[depthCacheKey({ ...legs[0], bestOppBook: "novig" })];
  const priced = depthPricePoolLegs(legs.slice(0, 1), ctx, partial);
  assert.equal(priced[0], legs[0]);
}

// Budget: poolDepthPicks stops adding legs past maxKeys venue ladders and
// takes the best single-leg edge first.
{
  const keysPerLeg = collectPromoDepthLegs([{ legs: [legs[0]] }], MIN, true).length;
  const picks = poolDepthPicks(legs, MIN, true, (l) => (l.market === "ML" ? 2 : 1), keysPerLeg * 3);
  assert.equal(picks.length, 3);
  assert.ok(picks.every((p) => p.legs[0].market === "ML"));
}

// App wiring: the scan pool is live-depth priced and the scan waits for it.
{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /const poolLadders = usePromoPageLadders\(poolDepthList, poolDepthList\.length, minLegDepth, dropThinPoolLegs\)/);
  assert.match(app, /depthPricePoolLegs\(parlayLegPoolStored, \{[^}]*minLegDepth \}, poolLadders\)/);
  assert.match(app, /if \(!slateReady \|\| poolDepthPending\)/);
}

console.log("promoPoolDepthMonotonic.test.js ok");
