import assert from "node:assert/strict";
import { nightmareKeys, summarySentence, chanceWords, typicalRange, outcomeLabel, fmtAmerican, americanFromP } from "./rootForSimple.js";
const model = {
  positions: [
    { id: "a", legs: [{ event: "G1", allowed: ["LAC"] }, { event: "G2", allowed: ["LV"] }], hit: 1000, miss: -50 },
    { id: "b", legs: [{ event: "G1", allowed: ["LAC"] }], hit: 500, miss: -100 },
    { id: "c", legs: [{ event: "G3", allowed: ["TB"] }], hit: 400, miss: -80 },
  ],
  probs: { G1: { LAC: 0.25, KC: 0.75 }, G2: { BUF: 0.6, LV: 0.4 }, G3: { "PIT>=3": 0.5, "PIT<3": 0.1, TB: 0.4 } },
  teamNames: { "G1:KC": "KC Chiefs", "G1:LAC": "LA Chargers", "G3:PIT": "PIT Steelers" },
};
const k = nightmareKeys(model);
assert.equal(k[0].label, "KC Chiefs win");
assert.equal(k[0].kills, 2);
assert.equal(k[1].label, "PIT Steelers win by 3+");
assert.equal(k.length, 2, "stops once every lock is dead");
assert.equal(outcomeLabel(model, "G3", "PIT<3"), "PIT Steelers win by less than 3");
assert.equal(fmtAmerican(americanFromP(0.75)), "-300");
assert.equal(fmtAmerican(americanFromP(0.25)), "+300");
assert.match(summarySentence({ ev: 2600.2, top: [{ game: "LAC vs KC", name: "LA Chargers" }] }), /make about \+\$2,600\. Biggest game: LAC vs KC/);
assert.equal(chanceWords(0.46), "about a coin flip");
const r = typicalRange({ bins: [{ from: 0, to: 10, p: 0.5 }, { from: 10, to: 20, p: 0.5 }] });
assert.equal(Math.round(r.lo), 2); assert.equal(Math.round(r.hi), 18);
console.log("rootForSimple tests ok");
