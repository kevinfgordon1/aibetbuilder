import test from "node:test";
import assert from "node:assert/strict";
import { fmtAmerican, fmtMoney, selectionLabel, hedgeLabel, picksQuery, triggerProgress } from "./love23View.js";

test("American odds and money formatting", () => {
  assert.equal(fmtAmerican(161), "+161");
  assert.equal(fmtAmerican(-187.4), "-187");
  assert.equal(fmtAmerican(0), "—");
  assert.equal(fmtMoney(-12.5), "−$12.50");
  assert.equal(fmtMoney(5, { sign: true }), "+$5.00");
});

test("selection and hedge labels", () => {
  assert.equal(selectionLabel({ market: "spreads", team: "MINNESOTA VIKINGS", point: 3, kind: "main" }), "Minnesota Vikings +3");
  assert.equal(selectionLabel({ market: "totals", side: "under", point: 46.5, kind: "alt" }), "Under 46.5 (alt)");
  assert.equal(selectionLabel({ market: "h2h", team: "DETROIT LIONS" }), "Detroit Lions ML");
  assert.equal(hedgeLabel({ venueLabel: "Novig", outcome: "Detroit Lions", point: -3, american: -118 }), "Novig: Detroit Lions -3 -118");
});

test("picks query clamps max bet and passes N only when set", () => {
  const q = new URLSearchParams(picksQuery({ maxBet: 900, n: "" }));
  assert.equal(q.get("maxBet"), "500");
  assert.equal(q.has("n"), false);
  assert.equal(new URLSearchParams(picksQuery({ n: "-2500" })).get("n"), "-2500");
});

test("trigger progress copy", () => {
  assert.equal(triggerProgress({ lossTowardTrigger: 2500, rolledForwardProfit: 0 }).pct, 0.25);
  assert.match(triggerProgress({ lossTowardTrigger: 0, rolledForwardProfit: 1200 }).text, /rolled forward/);
});
