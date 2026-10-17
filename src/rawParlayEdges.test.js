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
assert.ok(Math.abs(e.maxLoss - Math.ceil(1000 * (1 - e.offerYes) * 100 - 1e-6) / 100) < 1e-9);
assert.deepEqual(e.legs, ["LAC ML (LAC @ KC) Oct 18", "TB ML (TB @ CAR) Oct 25"]);
assert.equal(e.day, "2026-10-15");
// maker fee lowers EV exactly by k·y(1−y)·n
const e2 = E.scoreRawEdge(row, { edgeAmerican: 900, makerRate: 0.035 });
assert.ok(Math.abs((e.ev - e2.ev) - Math.ceil(1000 * 0.035 * e.offerYes * (1 - e.offerYes) * 100 - 1e-6) / 100) < 0.011);
// not flagged when offer doesn't beat the trader's price
assert.equal(E.scoreRawEdge({ ...row, traded_yes: 0.0125 }, { edgeAmerican: 900 }).flagged, false);
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
assert.match(ui, /Combo Sniper/);
assert.doesNotMatch(ui, /Raw parlay edges/);
assert.match(app, />Combo Sniper</);
assert.doesNotMatch(app, /Raw parlay edges/);
assert.match(ui, /Sort by/);
assert.match(ui, /className=\"rank\"/);
assert.equal(E.DEFAULT_SORT, "margin");

// ranked list sorts: Profit margin default, Total EV, Size — all descending
const rows = [
  { rfq_id: "a", ev: 10, evPer100: 5, contracts: 100, ts: "2026-10-15T12:00:00Z" },
  { rfq_id: "b", ev: 50, evPer100: 2, contracts: 10, ts: "2026-10-15T13:00:00Z" },
  { rfq_id: "c", ev: 20, evPer100: 8, contracts: 200, ts: "2026-10-15T11:00:00Z" },
];
assert.deepEqual(E.sortRawEdges(rows).map((r) => r.rfq_id), ["c", "a", "b"]); // margin
assert.deepEqual(E.sortRawEdges(rows, "ev").map((r) => r.rfq_id), ["b", "c", "a"]);
assert.deepEqual(E.sortRawEdges(rows, "size").map((r) => r.rfq_id), ["c", "a", "b"]);
assert.deepEqual(E.sortRawEdges(rows, "margin").map((r) => r.rfq_id), ["c", "a", "b"]);
console.log("rawParlayEdges tests passed");

// ── Worked example: Oct 16 12:10 AM ET, KXMVECROSSCATEGORY0 (fee_type quadratic → maker fee 0) ──
// fair +3104, winning MM sold YES at $0.036, 649.35 contracts, offer = fair − 500.
{
  const w = E.scoreRawEdge({ outcome: "traded", rfq_id: "0854ba0c", rfq_created_ts: "2026-10-16T04:10:14.458Z",
    fair_mid_american: 3104, traded_yes: "0.036", traded_contracts: "649.35", contracts: "675.67" }, { edgeAmerican: 500, makerRate: 0 });
  // taker got: 649.35×0.036 = $23.3766 + fee ceil6(0.07×649.35×0.036×0.964) = $1.577446 → $24.954046 → round up to $24.96
  assert.equal(w.winningMmAmerican, 2678);
  assert.equal(w.takerGotCost, 24.96);
  assert.equal(w.takerGotAmerican, 2502);
  // target +2604 → YES 0.03459… → Kalshi grid 0.001 → $0.034
  assert.equal(w.weSellYes, 0.034);
  // taker gets: $22.0779 + fee $1.492906 = $23.570806 → $23.58 → +2654
  assert.equal(w.takerGetsCost, 23.58);
  assert.equal(w.takerGetsAmerican, 2654);
  // we buy NO: 649.35×0.966 = $627.2721 → $627.28 put up (max loss); receive 649.35 − 627.28 = $22.07 → +2842
  assert.equal(w.makerFee, 0);
  assert.equal(w.maxLoss, 627.28);
  assert.equal(w.weReceive, 22.07);
  assert.equal(w.weSellAmerican, 2842);
  // EV = (3104/3204)×649.35 − 627.28 = $1.80 ; per $100 risked = $0.29
  assert.ok(Math.abs(w.ev - ((3104 / 3204) * 649.35 - 627.28)) < 1e-9);
  assert.equal(Math.round(w.ev * 100) / 100, 1.80);
  assert.equal(Math.round(w.evPer100 * 100) / 100, 0.29);
  assert.equal(w.flagged, true);
  // grid + rounding helpers
  assert.equal(E.floorToTick(0.03459), 0.034);
  assert.equal(E.floorToTick(0.00567), 0.0056);
  assert.equal(E.buyCostMicros(1, 0.5, 0.07), 520000n); // fee table: 1 @ 50¢ → $0.02
  assert.equal(E.buyCostMicros(100, 0.5, 0.07) - 50000000n, 1750000n); // 100 @ 50¢ → $1.75
  assert.equal(E.buyCostMicros(1, 0.5, 0.07, "centicent"), 517500n);
}

// NFL anytime-TD legs (Combo Sniper market filter)
{
  const td = "KXNFLTD-26OCT18PITTB-PITKWETJEN10-1:yes";
  assert.equal(E.isTdLeg(td), true);
  assert.equal(E.isTdLeg("KXNFLTD-26OCT18PITTB-PITKWETJEN10-2:yes"), false);
  assert.equal(E.legLabel(td), "TD · K. Wetjen anytime TD (PIT, PIT @ TB) Oct 18");
  assert.equal(E.parseTdLeg("KXNFLTD-26OCT18NYJNE-NERSTEVENSON38-1:yes").matchup, "NYJ @ NE");
  assert.equal(E.marketOf([td, "KXNFLGAME-26OCT18NYJNE-NE:yes"]), "td");
  assert.equal(E.marketOf(["KXNFLGAME-26OCT18NYJNE-NE:yes"]), "ml");
  assert.equal(E.matchesMarket({ market: "td" }, "ml"), false);
  assert.equal(E.matchesMarket({ market: "td" }, "all"), true);
}
console.log("rawParlayEdges TD ok");

// Polymarket US combo math (docs.polymarket.us/fees combo table: 100-lot at $0.10 pays $1.02 fee)
{
  const E = await import("./rawParlayEdges.js");
  const near = (a, b, t) => { if (Math.abs(a - b) > t) throw new Error(`${a} != ${b}`); };
  near(100 * E.polyFeePerContract(0.1), 1.02, 0.006);
  near(E.polyAllIn(E.polyYesForAllIn(0.3)), 0.3, 1e-9);
  if (E.polyLegToKalshi("aec-nfl-kc-lv-2026-10-18:yes") !== "KXNFLGAME-26OCT18KCLV-KC:yes") throw new Error("poly leg map");
  const s = E.scoreRawEdge({ venue: "polymarket", outcome: "traded", fair_mid_american: 2000, traded_yes: 0.12, traded_contracts: 100, legs: ["aec-nfl-kc-lv-2026-10-18:yes", "aec-nfl-buf-mia-2026-10-18:no"], poly_tick_size: 0.001 }, { edgeAmerican: 900, makerRate: 0.0175 });
  if (!s.flagged || s.makerFee !== 0 || s.venue !== "polymarket") throw new Error("poly score");
  if (Math.abs(s.weSellYes * 1000 - Math.round(s.weSellYes * 1000)) > 1e-6) throw new Error("poly tick");
  if (!(s.takerGetsCost / s.contracts <= E.probFromAmerican(1100) + 1e-12)) throw new Error("taker gets <= fair-X");
  console.log("rawParlayEdges polymarket ok");
}

// Leg summary, leg-count / league filters, and the sort-independent server cut (Polymarket row vanishing in All venues)
{
  const s = E.legSummary(["KXNFLGAME-26OCT25CINBAL-BAL:yes", "KXNFLGAME-26OCT25DENARI-DEN:yes", "KXNFLGAME-26OCT26KCSEA-KC:yes"]);
  assert.equal(s.text, "3 legs · NFL ML · Oct 25–Oct 26");
  assert.deepEqual(s.leagues, ["NFL"]);
  const t = E.legSummary(["KXNFLGAME-26OCT18LACKC-LAC:yes", "KXNFLTD-26OCT18PITTB-PITKWETJEN10-1:yes"]);
  assert.equal(t.text, "2 legs · NFL ML + TD · Oct 18");
  assert.equal(E.matchesLegBucket({ nLegs: 5 }, "4-5"), true);
  assert.equal(E.matchesLegBucket({ nLegs: 6 }, "4-5"), false);
  assert.equal(E.matchesLegBucket({ nLegs: 7 }, "6+"), true);
  assert.equal(E.matchesLeague({ summary: { leagues: ["NCAAF"] } }, "NFL"), false);
  // 300 high-EV low-margin rows + 1 high-margin small-EV row: the old top-200-by-EV cut dropped it
  const big = Array.from({ length: 300 }, (_, i) => ({ rfq_id: "k" + i, ev: 10 + i, evPer100: 1, contracts: 100 }));
  const small = { rfq_id: "poly", ev: 1.3, evPer100: 3.44, contracts: 42 };
  const cut = E.topForEverySort([...big, small], 200);
  assert.equal(cut.complete, false);
  assert.equal(E.sortRawEdges(cut.edges, "margin")[0].rfq_id, "poly");
  assert.equal(E.sortRawEdges(cut.edges, "ev")[0].rfq_id, "k299");
  assert.equal(E.topForEverySort([small], 200).complete, true);
}
console.log("legSummary / filters / topForEverySort tests passed");
