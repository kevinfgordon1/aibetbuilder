import test from "node:test";
import assert from "node:assert/strict";
import { fmtAmerican, fmtMoney, selectionLabel, hedgeLabel, picksQuery, weekLabel, settlementText } from "./love23View.js";

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

test("picks query clamps max bet and passes overrides only when set", () => {
  const q = new URLSearchParams(picksQuery({ maxBet: 900, carry: "" }));
  assert.equal(q.get("maxBet"), "500");
  assert.equal(q.has("carry"), false);
  assert.equal(q.get("bpw"), "30");
  assert.equal(q.get("credit"), "5000");
  assert.equal(new URLSearchParams(picksQuery({ carry: "2500", weekNet: "-1000" })).get("weekNet"), "-1000");
});

test("week label and settlement text", () => {
  assert.equal(weekLabel("2026-10-27", "2026-11-03"), "Tue Oct 27 – Tue Nov 3");
  assert.equal(settlementText({ net: -15000, absorbed: 10000, rebatable: 5000, rebate: 2500, owed: 12500 }), "Owe $12,500.00 ($10,000.00 from carry at full, $5,000.00 at 50%); saved $2,500.00");
  assert.match(settlementText({ net: 10000, carryAfter: 10000 }), /carry → \$10,000/);
});
