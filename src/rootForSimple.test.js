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
{
  const { topByGain } = await import("./rootForSimple.js");
  const t = topByGain({ ev: 100, perEvent: [{ outcomes: [{ name: "A", ifHit: 150, p: 0.5 }, { name: "B", ifHit: 50, p: 0.5 }] }, { outcomes: [{ name: "C", ifHit: 400, p: 0.1 }] }] });
  assert.deepEqual(t.map((x) => [x.name, x.gain]), [["C", 300], ["A", 50]]);
  console.log("topByGain ok");
}
{
  const { topByDrop } = await import("./rootForSimple.js");
  const t = topByDrop({ ev: 100, perEvent: [{ outcomes: [{ event: "G", name: "PIT Steelers by 3+", ifHit: 0 }, { event: "G", name: "PIT Steelers by under 3", ifHit: 10 }] }, { outcomes: [{ event: "H", name: "KC Chiefs", ifHit: 50 }, { event: "H", name: "LA Chargers", ifHit: 300 }] }] });
  assert.deepEqual(t.map((x) => [x.label, x.drop]), [["PIT Steelers win by 3+", -100], ["KC Chiefs win", -50]]);
  console.log("topByDrop ok");
}
{
  const S = await import("./rootForSimple.js");
  const h = { bins: [{ from: -100, to: 0, p: 0.5 }, { from: 0, to: 100, p: 0.4 }, { from: 100, to: 1000, p: 0.1 }] };
  assert.equal(S.cdfAt(h, 0), 0.5);
  assert.equal(Math.round(S.quantileOf(h, 0.5)), 0);
  assert.deepEqual(S.niceTicks(-4100, 15000), [0, 5000, 10000, 15000]);
  const m = S.curveModel(h, { worst: { pnl: -100, p: 0.3 } });
  assert.equal(m.spike.p, 0.3); assert.ok(m.ys.every((y) => y >= 0)); assert.ok(m.xMax < 1000);
  assert.equal(S.shortMoney(-4148), "−$4.1k"); assert.equal(S.shortMoney(12000), "+$12k");
  console.log("curve ok");
}
{
  const { curveCaption } = await import("./rootForSimple.js");
  assert.equal(curveCaption(0.54, 2600), "You'll lose a little more often than not, but the big wins more than make up for it.");
  assert.match(curveCaption(0.4, 100), /win more often than not/);
  assert.match(curveCaption(0.6, -100), /^Expect to lose on average/);
  console.log("caption ok");
}
{
  const { lossWinSplit } = await import("./rootForSimple.js");
  const s = lossWinSplit({ bins: [{ from: -100, to: 0, p: 0.5 }, { from: 0, to: 100, p: 0.5 }] }, 10, 0.5);
  assert.equal(s.avgLoss, -50); assert.equal(s.avgWin, 70); assert.ok(Math.abs(s.lossArea + s.winArea - 10) < 1e-9);
  console.log("split ok");
}
