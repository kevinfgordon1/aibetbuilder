import assert from "node:assert/strict";
import fs from "node:fs";
import * as E from "./rawParlayEdges.js";
import { canSeeOwnerTools, resolveAppHash, parseAppHash } from "./comboAccess.js";

// American math
assert.equal(E.americanMinus(7708, 900), 6808);
assert.equal(E.americanMinus(150, 100), -150);
assert.equal(E.americanMinus(-150, 100), -250);
assert.equal(E.americanFromProb(E.probFromAmerican(7708)), 7708);
// taker fee inverse is exact
for (const q of [0.01, 0.2, 0.5, 0.9]) assert.ok(Math.abs(E.takerAllIn(E.yesForAllIn(q)) - q) < 1e-12);
assert.equal(E.takerAllIn(0.5), 0.5 + 0.07 * 0.25);

// Kevin's example shape: fair +7708, trader paid +5782 all-in
const yTrader = E.yesForAllIn(E.probFromAmerican(5782));
const row = { outcome: "traded", rfq_id: "x", rfq_created_ts: "2026-10-15T18:03:35Z", fair_mid_american: 7708, traded_yes: yTrader, traded_contracts: 1000,
  legs: ["KXNFLGAME-26OCT18LACKC-LAC:yes", "KXNFLGAME-26OCT25TBCAR-TB:yes"] };
const e = E.scoreRawEdge(row, { edgeAmerican: 900, makerRate: 0 });
assert.equal(e.flagged, true);
assert.equal(e.bestTraderAmerican, 5782);
assert.ok(e.offerAmerican >= 6808 && e.offerAmerican < 7708, "offer at fair−X (tick floor favours trader), still under fair");
assert.ok(e.ev > 0 && e.evPer100 > 0);
assert.ok(Math.abs(e.maxLoss - 1000 * (1 - e.offerYes)) < 1e-9);
assert.deepEqual(e.legs, ["LAC ML (LAC @ KC) Oct 18", "TB ML (TB @ CAR) Oct 25"]);
assert.equal(e.day, "2026-10-15");
// maker fee lowers EV exactly by k·y(1−y)·n
const e2 = E.scoreRawEdge(row, { edgeAmerican: 900, makerRate: 0.035 });
assert.ok(Math.abs((e.ev - e2.ev) - 1000 * 0.035 * e.offerYes * (1 - e.offerYes)) < 1e-9);
// not flagged when offer doesn't beat the trader's price
assert.equal(E.scoreRawEdge({ ...row, traded_yes: E.yesForAllIn(E.probFromAmerican(7000)) }, { edgeAmerican: 900 }).flagged, false);
// not flagged when trader got better than fair
assert.equal(E.scoreRawEdge({ ...row, traded_yes: 0.011 }, { edgeAmerican: 0 }).flagged, false);
// non-traded / unpriced rows skipped
assert.equal(E.scoreRawEdge({ ...row, outcome: "no_trade" }), null);
assert.equal(E.scoreRawEdge({ ...row, fair_mid_american: null }), null);
// day summary
const s = E.summarizeByDay([e, { ...e, day: "2026-10-14" }, e]);
assert.equal(s[0].day, "2026-10-15"); assert.equal(s[0].count, 2); assert.ok(Math.abs(s[0].ev - 2 * e.ev) < 1e-9);

// owner-only
assert.equal(canSeeOwnerTools({ email: "kev120909@gmail.com" }), true);
assert.equal(canSeeOwnerTools({ email: "kmguido97@gmail.com" }), false);
assert.equal(canSeeOwnerTools({ email: "tester@gmail.com" }), false);
assert.equal(parseAppHash("#raw-edges").tab, "rawEdges");
assert.equal(resolveAppHash(parseAppHash("#raw-edges"), { email: "tester@gmail.com" }).allowed, false);
assert.equal(resolveAppHash(parseAppHash("#raw-edges"), { email: "kev120909@gmail.com" }).allowed, true);
const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
assert.match(app, /canSeeOwnerTools\(user\) && <RawParlayEdges/);
const ui = fs.readFileSync(new URL("./RawParlayEdges.jsx", import.meta.url), "utf8");
assert.match(ui, /disabled title=\{OFFER_TITLE\}/);
assert.doesNotMatch(ui, /method:\s*"POST"/);
console.log("rawParlayEdges tests passed");
