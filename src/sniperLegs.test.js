import assert from "node:assert/strict";
import { applyLive, kalshiTopAsk, legStarted, wantsLegDetail, buildLegRows, indexBoards, fmtKickoffEt, isPlaceholderStart } from "./sniperLegs.js";

const src = (venue, cost, top = cost, extra = {}) => ({ used: true, venue, reason: "ok", costAmerican: cost, topAmerican: top, ...extra });
const pm = [
  { p: 0.7718842362089143, best: "novig", team: "sf", fairAmerican: -338,
    sources: [src("kalshi", 313, 313, { via: "yes_opp" }), src("polymarket", 322), src("novig", 338, 344), src("kalshi", 313, 313, { via: "no_own" })] },
  { p: 0.552843, id: "KXNFLTD-26OCT18ARILAR-LARPNACUA12-1", best: "kalshi", kind: "td", side: "yes", fairAmerican: -124,
    sources: [{ via: "td_opposite", used: true, venue: "kalshi", reason: "ok", costAmerican: 124 }] },
];
const legs = ["KXNFLGAME-26OCT19WASSF-SF:yes", "KXNFLTD-26OCT18ARILAR-LARPNACUA12-1:yes"];
const boards = indexBoards({
  kalshi: [{ ticker: "KXNFLGAME-26OCT19WASSF-SF", away: "WAS Commanders", home: "SF 49ers", side: "San Francisco", start: "2026-10-20T03:00:00Z" }],
  novig: [{ book: "novig", bet_type: "moneyline", away: "Washington Commanders", home: "San Francisco 49ers", side: "Washington Commanders", odds: 0.25, size: 1234.5, start: "2026-10-20T00:15:00.000Z" }],
  polymarket: [{ book: "polymarket", bet_type: "moneyline", away: "Arizona Cardinals", home: "Los Angeles Rams", side: "Arizona Cardinals", odds: 0.14, size: 50, start: "2026-10-18T20:05:00Z" }],
});
const rows = buildLegRows(legs, pm, boards);
assert.equal(rows[0].title, "San Francisco 49ers ML");
assert.equal(rows[0].subtitle, "Washington Commanders @ San Francisco 49ers");
// Monday night game: Kalshi's 03:00Z placeholder is ignored, real kickoff comes from Novig
assert.equal(rows[0].when, "Oct 19, 8:15 PM ET");
assert.equal(rows[0].fairAmerican, -338); // logged inverse-bet fair, never recomputed
assert.equal(rows[0].winPct.toFixed(1), "77.2");
assert.deepEqual(rows[0].bestOpp, { american: 338, venue: "novig", side: "Washington Commanders ML", afterKalshiFee: false, afterPolyFee: false });
assert.deepEqual(rows[0].depth, { top: 344, at500: 338 });
assert.deepEqual(rows[0].others.map((o) => o.venue).sort(), ["kalshi", "polymarket"]);
assert.equal(rows[0].now.venue, "novig");
assert.equal(rows[0].now.american, 300);
assert.equal(rows[0].now.size, 1234.5);
assert.equal(rows[1].kind, "td");
assert.equal(rows[1].title, "P. Nacua anytime TD");
assert.equal(rows[1].subtitle, "Arizona Cardinals @ Los Angeles Rams");
assert.equal(rows[1].when, "Oct 18, 4:05 PM ET");
assert.equal(rows[1].bestOpp.side, "P. Nacua NO anytime TD");
assert.equal(rows[1].bestOpp.afterKalshiFee, true);
assert.equal(rows[1].now, null);
// no detail logged / no boards: still a row with title + ticker date
const bare = buildLegRows(["KXNFLGAME-26OCT18HOUJAC-JAC:yes"], null, null);
assert.equal(bare[0].title, "Jacksonville Jaguars ML");
assert.equal(bare[0].when, "Oct 18");
assert.equal(bare[0].fairAmerican, null);
assert.equal(isPlaceholderStart("2026-10-18T03:00:00Z"), true);
assert.equal(fmtKickoffEt("2026-10-18T17:00:00Z"), "Oct 18, 1:00 PM ET");
assert.equal(wantsLegDetail({ evPer100: 1 }), true);
assert.equal(wantsLegDetail({ evPer100: 3.99 }), true);
assert.equal(wantsLegDetail({ evPer100: 0.99 }), false);
assert.equal(wantsLegDetail({ evPer100: null }), false);
// live liquidity: Kalshi TD NO leg reads the orderbook (buy NO = 1 − best YES bid), $ = price × contracts
assert.deepEqual(rows[1].kalshiLive, { ticker: "KXNFLTD-26OCT18ARILAR-LARPNACUA12-1", side: "no" });
const before = Date.parse("2026-10-18T12:00:00Z");
const ob = { orderbook_fp: { yes_dollars: [["0.4000", "100"], ["0.4500", "2000"]], no_dollars: [["0.5000", "10"]] } };
assert.deepEqual(kalshiTopAsk(ob, "no"), { px: 0.55, contracts: 2000 });
assert.deepEqual(kalshiTopAsk(ob, "yes"), { px: 0.5, contracts: 10 });
const live = applyLive(rows, { kalshiBooks: { "KXNFLTD-26OCT18ARILAR-LARPNACUA12-1": ob }, kalshiStatus: { "KXNFLTD-26OCT18ARILAR-LARPNACUA12-1": "active" }, nowMs: before });
assert.equal(live[1].now.venue, "kalshi");
assert.equal(live[1].now.size, 1100);
assert.equal(live[1].now.afterKalshiFee, true);
assert.equal(live[1].now.american, -131); // 0.55 + 0.07·0.55·0.45 = 0.5673
assert.equal("kalshiLive" in live[1], false);
// closed market or started game: nothing live
assert.equal(applyLive(rows, { kalshiBooks: { "KXNFLTD-26OCT18ARILAR-LARPNACUA12-1": ob }, kalshiStatus: { "KXNFLTD-26OCT18ARILAR-LARPNACUA12-1": "closed" }, nowMs: before })[1].now, null);
const after = applyLive(rows, { kalshiBooks: {}, kalshiStatus: {}, nowMs: Date.parse("2026-10-18T21:00:00Z") });
assert.equal(after[1].now, null);
assert.equal(legStarted(rows[0], Date.parse("2026-10-21T12:00:00Z")), true);
// live price equal to the logged best opp: $ moves onto the Best opp line
const same = applyLive([{ ...rows[0], now: { venue: "novig", american: 338, size: 500 } }], { nowMs: before });
assert.equal(same[0].bestOpp.size, 500);
assert.equal(same[0].now, null);
// ML via yes_opp → YES on the other team's ticker
const ml = buildLegRows(["KXNFLGAME-26OCT18HOUJAC-JAC:yes"], [{ p: 0.56, best: "kalshi", fairAmerican: -127, sources: [{ via: "yes_opp", used: true, venue: "kalshi", reason: "ok", costAmerican: 127 }] }], null);
assert.deepEqual(ml[0].kalshiLive, { ticker: "KXNFLGAME-26OCT18HOUJAC-HOU", side: "yes" });
console.log("sniperLegs ok");

// Multi-venue TD (worker td-multivenue): Polymarket best opp, fee note, top-of-book $ as logged at the RFQ.
{
  const tdLeg = { p: 0.57, id: "KXNFLTD-26OCT18BALCLE-BALDHENRY22-1", best: "polymarket", kind: "td", side: "yes", fairAmerican: -133,
    sources: [
      { via: "td_opposite", used: true, venue: "kalshi", reason: "ok", costAmerican: 124, topAmerican: 122, topUsd: 900, ageMs: 800 },
      { via: "td_opposite", used: true, venue: "polymarket", reason: "ok", costAmerican: 133, topAmerican: 130, topUsd: 640.5, ageMs: 1200 },
      { via: "td_opposite", used: false, venue: "novig", reason: "depth", costAmerican: null, topAmerican: 128, topUsd: 40, ageMs: 900 },
    ] };
  const [r] = buildLegRows(["KXNFLTD-26OCT18BALCLE-BALDHENRY22-1:yes"], [tdLeg], null);
  assert.equal(r.bestOpp.venue, "polymarket");
  assert.equal(r.bestOpp.afterPolyFee, true);
  assert.equal(r.bestOpp.afterKalshiFee, false);
  assert.deepEqual(r.depth, { top: 130, at500: 133 });
  assert.deepEqual(r.others, [{ venue: "kalshi", american: 124 }]); // Novig failed depth: not shown
  assert.deepEqual(r.now, { venue: "polymarket", american: 130, size: 640.5, atRfq: true, afterPolyFee: true });
  assert.equal(r.kalshiLive, undefined);
}
console.log("sniperLegs multi-venue TD ok");
