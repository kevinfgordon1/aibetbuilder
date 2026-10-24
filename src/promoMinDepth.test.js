import assert from "node:assert/strict";
import { parseMinLegDepth, profitAtAmerican, topBandDepthUsd, legMeetsMinDepth, filterLegsByMinDepth, filterPicksByMinDepth, loadMinLegDepth, saveMinLegDepth, blendLegToMinDepth, applyMinDepthToLeg, repriceLegsForMinDepth, applyMinDepthToPick, minDepthAltVenueLegs, venueDepthLeg } from "./promoMinDepth.js";
import { depthCacheKey } from "./promoBookDepth.js";
import { applyPmBlendToLegs } from "./blendAskLadder.js";
import { pickBestAmericanQuote, resolveOppWithSideGuard } from "./promoOppGuard.js";
import { rankPromoPicks, collectPromoDepthLegs } from "./promoListRank.js";

assert.equal(parseMinLegDepth("$2,000"), 2000);
assert.equal(parseMinLegDepth(""), 0);
assert.equal(parseMinLegDepth("-5"), 0);

const deep = { bestOppBook: "novig", bestOpp: -150, bestOppSize: 2500, game: "A", name: "X", market: "h2h", sport: "nfl" };
const thin = { bestOppBook: "kalshi", bestOpp: 120, bestOppSize: 300, game: "B", name: "Y", market: "h2h", sport: "nfl" };
const book = { bestOppBook: "fanduel", bestOpp: -110, game: "C", name: "Z", market: "h2h", sport: "nfl" };
// depth = potential PROFIT, not stake (Kevin: $3,000 bettable at −200 = $1,500 depth)
assert.equal(profitAtAmerican(3000, -200), 1500);
assert.equal(profitAtAmerican(1000, 150), 1500);
assert.ok(Math.abs(topBandDepthUsd(deep) - 1666.67) < 0.01, "$2,500 at −150 = $1,666.67 profit");
assert.equal(topBandDepthUsd(book), null);
assert.equal(topBandDepthUsd(thin, [{ american: 120, size: 300 }, { american: 110, size: 5000 }]), 360);

// off = unchanged (identity, no repricing)
assert.deepEqual(filterLegsByMinDepth([deep, thin, book], 0), [deep, thin, book]);
assert.equal(repriceLegsForMinDepth([deep], 0)[0], deep);
assert.equal(applyMinDepthToPick({ legs: [thin] }, 0, {}).legs[0], thin);
// single venue, no other venues: same as before
assert.deepEqual(filterLegsByMinDepth([deep, thin, book], 1500), [deep]);
assert.deepEqual(filterLegsByMinDepth([deep, thin, book], 2000), [], "$2,500 stake at −150 is only $1,667 of depth");
assert.equal(legMeetsMinDepth(thin, 1500, [{ american: 120, size: 2100 }]), true, "live ladder wins");

// best venue ladder walks deeper levels now (blended within the venue)
assert.equal(legMeetsMinDepth(thin, 1500, [{ american: 120, size: 300 }, { american: 110, size: 5000 }]), true);

// cross-venue blend: Kalshi +120 $300 thin, Novig +115 $3,000, ProphetX +105 $4,000
const multi = { ...thin, dk: -130, bestOppVenues: [
  { book: "kalshi", american: 120, size: 300 },
  { book: "novig", american: 115, size: 3000 },
  { book: "prophetx", american: 105, size: 4000 },
  { book: "polymarket", american: 118, size: null },
] };
const b = blendLegToMinDepth(multi, 5000);
assert.equal(b.complete, true);
assert.deepEqual(b.venues, ["kalshi", "novig", "prophetx"]);
assert.ok(b.american < 120 && b.american > 105, `blended ${b.american}`);
// profit walk: $360 (300@+120) + $3,450 (3000@+115) + $1,190 from +105 (stake 1,133.33)
const stake = 300 + 3000 + 1190 / 1.05;
const vw = stake / (stake + 5000);
assert.equal(b.american, Math.round((100 * (1 - vw)) / vw));
assert.equal(b.profitFilled, 5000);
assert.equal(blendLegToMinDepth(multi, 9000).complete, false, "$8,010 total profit < $9,000");
assert.equal(legMeetsMinDepth(multi, 9000), false);
const re = applyMinDepthToLeg(multi, 5000);
assert.equal(re.bestOpp, b.american);
assert.equal(re.bestOppQuoted, 120);
assert.equal(applyMinDepthToLeg(multi, 9000), null);
// sportsbook-best still drops
assert.equal(applyMinDepthToLeg({ ...book, bestOppVenues: multi.bestOppVenues }, 100), null);
// wrong-side junk quote ignored
const junk = { ...multi, bestOppVenues: [...multi.bestOppVenues, { book: "polymarket", american: -900, size: 99999 }] };
assert.equal(blendLegToMinDepth(junk, 9000).complete, false);

// live alt-venue ladder replaces the feed top-of-book quote
const novigKey = depthCacheKey(venueDepthLeg(multi, "novig"));
assert.equal(blendLegToMinDepth(multi, 9000, null, { [novigKey]: [{ american: 115, size: 3000 }, { american: 112, size: 2000 }] }).complete, true);
assert.equal(minDepthAltVenueLegs([multi], 5000).length, 3, "novig + prophetx + polymarket ladders fetched");
assert.equal(minDepthAltVenueLegs([multi], 0).length, 0);
assert.ok(collectPromoDepthLegs([{ legs: [multi] }], 5000).length > collectPromoDepthLegs([{ legs: [multi] }]).length);

// card blend cannot undo the min-depth price
const shown = applyPmBlendToLegs([{ ...re, bestOppSize: 300 }], {}, {}).displayLegs[0];
assert.ok(shown.bestOpp <= b.american);
// no minDepthBlend → applyPmBlendToLegs unchanged
const plain = applyPmBlendToLegs([deep], {}, {}).displayLegs[0];
assert.equal(plain.minDepthBlend, undefined);

const picks = [{ legs: [deep] }, { legs: [deep, thin] }];
assert.equal(filterPicksByMinDepth(picks, 1500, {}).length, 1);
assert.equal(filterPicksByMinDepth(picks, 1500, { [depthCacheKey(thin)]: [{ american: 120, size: 2000 }] }).length, 2);

// rankPromoPicks reprices and recomputes EV via overlay
let overlaid = 0;
const ranked = rankPromoPicks([{ legs: [multi], ev: 10 }], { minLegDepth: 5000, numLegs: 1 }, (x) => x, (pk, legs) => { overlaid++; return { ...pk, ev: 1, legs }; }, {});
assert.equal(ranked.length, 1);
assert.equal(ranked[0].legs[0].minDepthBlend.target, 5000);
assert.ok(overlaid >= 1);
assert.equal(rankPromoPicks([{ legs: [multi] }], { minLegDepth: 9000, numLegs: 1 }, (x) => x, (pk) => pk, {}).length, 0);

// venues plumbing from the odds feed
const q = pickBestAmericanQuote([{ price: 120, book: "kalshi", size: 300 }, { price: 115, book: "novig", size: 3000 }, { price: 110, book: "fanduel" }]);
assert.equal(q.bestBook, "kalshi");
assert.deepEqual(q.venues.map((v) => v.book), ["kalshi", "novig"]);
assert.deepEqual(resolveOppWithSideGuard({ trustedOpp: 120, trustedBook: "kalshi", trustedVenues: q.venues, bookOdds: -130 }).bestOppVenues, q.venues);
assert.equal("bestOppVenues" in resolveOppWithSideGuard({ trustedOpp: 120, trustedBook: "kalshi", bookOdds: -130 }), false);

const mem = new Map();
const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
const u = { email: "Kev@x.com" };
saveMinLegDepth(u, "2000", store);
assert.equal(loadMinLegDepth(u, store), 2000);
saveMinLegDepth(u, "", store);
assert.equal(loadMinLegDepth(u, store), 0);
console.log("promoMinDepth ok", { single: 120, blended: b.american });
