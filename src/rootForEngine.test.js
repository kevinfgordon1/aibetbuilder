import { rootFor } from "./rootForEngine.js";
import assert from "assert/strict";
// one lock A wins (p .6): hit +100, miss -50
const g = "KXNFLGAME-26OCT18LACKC";
let r = rootFor([{ id: 1, legs: [{ ticker: g + "-LAC" }], hit: 100, miss: -50 }], { [g]: { LAC: 0.6, KC: 0.4 } });
assert.ok(Math.abs(r.ev - (0.6 * 100 - 0.4 * 50)) < 1e-9); assert.equal(r.best.pnl, 100); assert.ok(Math.abs(r.worst.p - 0.4) < 1e-12);
assert.equal(r.top[0].outcome, "LAC"); assert.ok(Math.abs(r.top[0].swing - 150) < 1e-9);
// opposite sides can't both hit
r = rootFor([{ id: 1, legs: [{ ticker: g + "-LAC" }], hit: 100, miss: 0 }, { id: 2, legs: [{ ticker: g + "-KC" }], hit: 100, miss: 0 }], { [g]: { LAC: 0.5, KC: 0.5 } });
assert.equal(r.best.pnl, 100); assert.equal(r.worst.pnl, 100); assert.ok(r.sd < 1e-9);
// exact vs MC agree
const h = "KXNFLGAME-26OCT18BUFLV";
const locks = [{ id: 1, legs: [{ ticker: g + "-LAC" }, { ticker: h + "-LV" }], hit: 900, miss: -100 }, { id: 2, legs: [{ ticker: h + "-LV" }], hit: -300, miss: 100 }];
const pr = { [g]: { LAC: 0.4, KC: 0.6 }, [h]: { LV: 0.3, BUF: 0.7 } };
const ex = rootFor(locks, pr); const mc = rootFor(locks, pr, { nodeBudget: 1 });
assert.equal(ex.method, "exact"); assert.equal(mc.method, "monte_carlo");
assert.ok(Math.abs(ex.ev - mc.ev) < 3, ex.ev + " " + mc.ev);
assert.ok(Math.abs(ex.ev - (0.12 * 900 - 0.88 * 100 + 0.3 * -300 + 0.7 * 100)) < 1e-9);
console.log("engine ok", ex.ev, ex.sd, ex.worst, ex.top.map((t) => t.outcome + " " + t.swing.toFixed(1)));
// raw inverse, both sides held: no scaling, residual "neither" keeps A/B exclusive
import { eventProbs } from "./rootForEngine.js";
{
  const ev = "KXNFLGAME-26OCT18LACKC";
  const { probs } = eventProbs([{ event: ev, kind: "game", outcomes: ["LAC", "KC"] }], { [ev + "-LAC:yes"]: 0.45, [ev + "-KC:yes"]: 0.5 });
  assert.equal(probs[ev].LAC, 0.45); assert.equal(probs[ev].KC, 0.5);
  const r = rootFor([{ id: 1, legs: [{ ticker: ev + "-LAC" }], hit: 100, miss: 0 }, { id: 2, legs: [{ ticker: ev + "-KC" }], hit: 100, miss: 0 }], probs);
  assert.ok(Math.abs(r.ev - 95) < 1e-9); assert.equal(r.best.pnl, 100); assert.equal(r.worst.pnl, 0); assert.ok(Math.abs(r.worst.p - 0.05) < 1e-9);
  const lac = r.perEvent[0].outcomes.find((o) => o.outcome === "LAC"); assert.equal(lac.p, 0.45);
  console.log("raw inverse ok");
}
