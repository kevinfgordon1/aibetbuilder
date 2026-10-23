import assert from "node:assert/strict";
import { parseMinLegDepth, topBandDepthUsd, legMeetsMinDepth, filterLegsByMinDepth, filterPicksByMinDepth, loadMinLegDepth, saveMinLegDepth } from "./promoMinDepth.js";
import { depthCacheKey } from "./promoBookDepth.js";

assert.equal(parseMinLegDepth("$2,000"), 2000);
assert.equal(parseMinLegDepth(""), 0);
assert.equal(parseMinLegDepth("-5"), 0);

const deep = { bestOppBook: "novig", bestOpp: -150, bestOppSize: 2500, game: "A", name: "X", market: "h2h", sport: "nfl" };
const thin = { bestOppBook: "kalshi", bestOpp: 120, bestOppSize: 300, game: "B", name: "Y", market: "h2h", sport: "nfl" };
const book = { bestOppBook: "fanduel", bestOpp: -110, game: "C", name: "Z", market: "h2h", sport: "nfl" };
assert.equal(topBandDepthUsd(deep), 2500);
assert.equal(topBandDepthUsd(book), null);
// only the top American band counts, not worse levels behind it
assert.equal(topBandDepthUsd(thin, [{ american: 120, size: 300 }, { american: 110, size: 5000 }]), 300);

assert.deepEqual(filterLegsByMinDepth([deep, thin, book], 0), [deep, thin, book], "off = unchanged");
assert.deepEqual(filterLegsByMinDepth([deep, thin, book], 2000), [deep]);
assert.equal(legMeetsMinDepth(thin, 2000, [{ american: 120, size: 2100 }]), true, "live ladder wins");

const picks = [{ legs: [deep] }, { legs: [deep, thin] }];
assert.equal(filterPicksByMinDepth(picks, 2000, {}).length, 1);
assert.equal(filterPicksByMinDepth(picks, 2000, { [depthCacheKey(thin)]: [{ american: 120, size: 2000 }] }).length, 2);

const mem = new Map();
const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
const u = { email: "Kev@x.com" };
saveMinLegDepth(u, "2000", store);
assert.equal(loadMinLegDepth(u, store), 2000);
saveMinLegDepth(u, "", store);
assert.equal(loadMinLegDepth(u, store), 0);
console.log("promoMinDepth ok");
