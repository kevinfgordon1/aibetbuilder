import assert from "node:assert/strict";
import { buildLegRows, indexBoards, fmtKickoffEt, isPlaceholderStart } from "./sniperLegs.js";

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
assert.deepEqual(rows[0].bestOpp, { american: 338, venue: "novig", side: "Washington Commanders ML", afterKalshiFee: false });
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
console.log("sniperLegs ok");
