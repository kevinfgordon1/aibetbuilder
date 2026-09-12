import assert from "node:assert/strict";
import {
  depthCacheKey,
  fetchPromoBookDepth,
  legsNeedingDepth,
  collectPromoDepthLegs,
  venueHasDepthApi,
  applyBlendToLegs,
  _resetPromoBookDepthCache,
} from "./promoBookDepth.js";
import { sortPromoPicksByEv } from "./promoParlayScan.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { calcParlayEV } = require("../lib/promo-ev.js");
import { formatTrueOddsBookLine, formatTrueOddsWithBlend, formatDepthTrail } from "./trueOddsLine.js";

_resetPromoBookDepthCache();

assert.equal(venueHasDepthApi("prophetx"), true);
assert.equal(venueHasDepthApi("pinnacle"), false);
assert.equal(venueHasDepthApi("draftkings"), false);

const pxLeg = {
  bestOppBook: "prophetx",
  sport: "americanfootball_ncaaf",
  market: "TOT",
  game: "Louisville Cardinals @ Ole Miss Rebels",
  bestOppName: "Louisville Cardinals/Ole Miss Rebels o55",
  name: "Louisville Cardinals/Ole Miss Rebels u55",
  bestOpp: 104,
  bestOppSize: 54,
};
const pinLeg = { ...pxLeg, bestOppBook: "pinnacle", bestOppSize: null };

assert.equal(legsNeedingDepth([pxLeg, pinLeg]).length, 1);
assert.equal(legsNeedingDepth([pinLeg]).length, 0);
assert.equal(collectPromoDepthLegs([
  { legs: [pxLeg, pinLeg] },
  { legs: [pxLeg] },
]).length, 1, "dedupe shared depth legs across visible cards");
assert.equal(collectPromoDepthLegs([{ legs: [pinLeg] }]).length, 0);

{
  const top = formatTrueOddsBookLine({ odds: 104, bookLabel: "ProphetX", size: 54 });
  assert.equal(top, "+104 on ProphetX · $54 currently available");
  assert.equal(formatDepthTrail([], { topAmerican: 104 }), "", "no depth → unchanged (no trail)");
}

{
  const blended = formatTrueOddsWithBlend({
    odds: 104,
    bookLabel: "Kalshi",
    size: 54,
    levels: [
      { american: 200, size: 100 },
      { american: 100, size: 400 },
    ],
  });
  assert.equal(blended.odds, 125);
  assert.match(blended.text, /blended to \$500 payout/);
  assert.notEqual(blended.odds, 104, "true odds ≠ thin top when VWAP differs");
  const none = applyBlendToLegs([pxLeg], {});
  assert.equal(none.displayLegs[0].bestOpp, 104, "no ladder → keep top");
  const over = applyBlendToLegs([pxLeg], {
    [depthCacheKey(pxLeg)]: [
      { american: 200, size: 100 },
      { american: 100, size: 400 },
    ],
  });
  assert.equal(over.displayLegs[0].bestOpp, 125);
  assert.notEqual(over.displayLegs[0].bestOpp, pxLeg.bestOpp);
  assert.equal(over.blends[depthCacheKey(pxLeg)].flag, "blended to $500 payout");

  const kevin = {
    dk: 200,
    bestOpp: -200,
    bestOppBook: "kalshi",
    bestOppSize: 400,
    sport: "mlb",
    game: "A @ B",
    name: "A ML",
    bestOppName: "B ML",
    market: "ML",
  };
  const oneLeg = applyBlendToLegs([kevin], {}, { promoType: "boost", numLegs: 1, stake: 100, boostPct: 100 });
  assert.equal(oneLeg.displayLegs[0].pmBlend.mode, "hedge");
  assert.equal(oneLeg.displayLegs[0].lowLiquidity, false);
  assert.equal(oneLeg.displayLegs[0].pmBlend.flag, "", "top-only hedge fill is not a blend");

  const covers500 = applyBlendToLegs(
    [{ ...kevin, bestOppSize: 1000 }],
    {},
    { promoType: "boost", numLegs: 2, stake: 100, boostPct: 100 },
  );
  assert.equal(covers500.displayLegs[0].pmBlend.mode, "payout");
  assert.equal(covers500.displayLegs[0].lowLiquidity, false, "$500 profit at −200 needs $1,000 stake");

  const multiShort = applyBlendToLegs(
    [{ ...kevin, bestOppSize: 200 }],
    {},
    { promoType: "boost", numLegs: 2, stake: 100, boostPct: 100 },
  );
  assert.equal(multiShort.displayLegs[0].pmBlend.mode, "payout");
  assert.equal(multiShort.displayLegs[0].lowLiquidity, true, "$100 profit at −200 stays short of $500");
}

{
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      async json() {
        return {
          results: [{
            key: depthCacheKey(pxLeg),
            venue: "prophetx",
            levels: [
              { american: 104, size: 54 },
              { american: 100, size: 420 },
              { american: -105, size: 1100 },
            ],
            reason: "ok",
          }],
        };
      },
    };
  };
  const a = await fetchPromoBookDepth([pxLeg], { fetchImpl });
  const b = await fetchPromoBookDepth([pxLeg], { fetchImpl });
  assert.equal(calls, 1, "cache must not refetch");
  assert.equal(a[depthCacheKey(pxLeg)].length, 3);
  assert.equal(b[depthCacheKey(pxLeg)].length, 3);
}

{
  let called = false;
  await fetchPromoBookDepth([pinLeg], { fetchImpl: async () => { called = true; return { ok: true, json: async () => ({ results: [] }) }; } });
  assert.equal(called, false, "sportsbook legs do not hit /api/book-depth");
}

// Live VWAP on a thin #1 can collapse scan EV below a deeper sibling.
// Ranking must use the same ladders so Best Pick is not stuck at −EV.
{
  const ctx = { promoType: "boost", numLegs: 3, stake: 100, boostPct: 50 };
  const mk = (name, game, bestOpp, size) => ({
    dk: -110,
    bestOpp,
    bestOppBook: "kalshi",
    bestOppSize: size,
    sport: "baseball_mlb",
    game,
    name,
    bestOppName: `${name} opp`,
    market: "ML",
  });
  const thin = {
    ev: 90,
    legs: [
      mk("Thin1", "A @ B", 220, 15),
      mk("Thin2", "C @ D", 220, 15),
      mk("Thin3", "E @ F", 220, 15),
    ],
  };
  const deep = {
    ev: 80,
    legs: [
      mk("Deep1", "G @ H", 180, 2000),
      mk("Deep2", "I @ J", 180, 2000),
      mk("Deep3", "K @ L", 180, 2000),
    ],
  };
  const crush = [
    { american: 220, size: 15 },
    { american: -200, size: 2000 },
  ];
  const hold = [{ american: 180, size: 2000 }];
  const ladders = {};
  for (const l of thin.legs) ladders[depthCacheKey(l)] = crush;
  for (const l of deep.legs) ladders[depthCacheKey(l)] = hold;
  const overlay = (p) => {
    const { displayLegs } = applyBlendToLegs(p.legs, ladders, ctx);
    return { ...p, ...calcParlayEV(displayLegs, ctx.boostPct, ctx.stake), legs: displayLegs };
  };
  const liveThin = overlay(thin);
  const liveDeep = overlay(deep);
  assert.ok(liveThin.ev < liveDeep.ev, "thin #1 live VWAP must fall below the deeper sibling");
  assert.ok(liveThin.ev < 0, "collapsed thin book should be able to go negative");
  const ranked = sortPromoPicksByEv([liveThin, liveDeep]);
  assert.equal(ranked[0].legs[0].name, "Deep1", "Best Pick must follow live EV, not scan order");
}

console.log("promoBookDepth.test.js ok");
