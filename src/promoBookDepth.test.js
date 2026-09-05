import assert from "node:assert/strict";
import {
  depthCacheKey,
  fetchPromoBookDepth,
  legsNeedingDepth,
  venueHasDepthApi,
  _resetPromoBookDepthCache,
} from "./promoBookDepth.js";
import { formatTrueOddsBookLine, formatDepthTrail } from "./trueOddsLine.js";

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
