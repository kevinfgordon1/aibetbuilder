import assert from "node:assert/strict";
import {
  depthCacheKey,
  fetchPromoBookDepth,
  legsNeedingDepth,
  venueHasDepthApi,
  applyBlendToLegs,
  _resetPromoBookDepthCache,
} from "./promoBookDepth.js";
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
  assert.equal(blended.odds, 150);
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
  assert.equal(over.displayLegs[0].bestOpp, 150);
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
  assert.match(oneLeg.displayLegs[0].pmBlend.flag, /\$333\.33 hedge/);

  const multi = applyBlendToLegs([kevin], {}, { promoType: "boost", numLegs: 2, stake: 100, boostPct: 100 });
  assert.equal(multi.displayLegs[0].pmBlend.mode, "payout");
  assert.equal(multi.displayLegs[0].lowLiquidity, true);
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

console.log("promoBookDepth.test.js ok");
