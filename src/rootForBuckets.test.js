import assert from "node:assert/strict";
import { expandAllowed } from "./rootForBuckets.js";
import { expectedProfit, dayValue, lockDecided } from "./rootForSweat.js";
import { rootFor } from "./rootForEngine.js";

const split = { GB: 0.364, "DET<4": 0.378, "DET>=4": 0.258 };
assert.deepEqual(expandAllowed(["DET"], split), ["DET>=4", "DET<4"].filter((k) => k in split).sort((a, b) => Object.keys(split).indexOf(a) - Object.keys(split).indexOf(b)));
assert.deepEqual(expandAllowed(["GB"], split), ["GB"]);
assert.deepEqual(expandAllowed(["DET>=4"], split), ["DET>=4"]);
assert.deepEqual(expandAllowed(["DET"], { GB: 0.4, DET: 0.6 }), ["DET"]);

// Moneyline leg stored before the game became a spread game (allowed "DET", outcomes GB/DET),
// priced with spread-split chances: must count Detroit's full win chance, not 0.
const mlFirst = { id: "a", legs: [{ event: "G", kind: "game", outcomes: ["GB", "DET"], allowed: ["DET"] }], hit: 100, miss: -10 };
const spreadLater = { id: "b", legs: [{ event: "G", kind: "game", outcomes: ["DET>=4", "DET<4", "GB"], allowed: ["DET>=4"] }], hit: 200, miss: -20 };
const probs = { G: split };
const ev = expectedProfit([mlFirst, spreadLater], probs);
const want = (0.636 * 100 - 0.364 * 10) + (0.258 * 200 - 0.742 * 20);
assert.ok(Math.abs(ev - want) < 1e-9, `ev ${ev} vs ${want}`);
assert.ok(Math.abs(dayValue([mlFirst], probs, {}) - (0.636 * 100 - 0.364 * 10)) < 1e-9);
assert.equal(lockDecided(mlFirst, { G: { GB: 0, "DET<4": 1, "DET>=4": 0 } }), true);
assert.equal(dayValue([mlFirst], probs, { G: { GB: 0, "DET<4": 1, "DET>=4": 0 } }), 100);
const r = rootFor([mlFirst, spreadLater], probs, { fast: true });
assert.ok(Math.abs(r.ev - want) < 1e-6, `engine ev ${r.ev}`);
console.log("rootFor buckets ok");
