import assert from "node:assert/strict";
import { makeSniperLegFair, indexTdRows, storedLegFairs, prophetxAsNovig, pxEffective, vwap } from "./sniperLegFair.js";
import { relayIndex } from "./rootForPrices.js";

const now = Date.parse("2026-10-23T04:00:00Z");
const T = "KXNFLTD-26OCT25LARLV-LARPNACUA12-1";
// thin Kalshi TD book (Oct 22 Nacua shape): cheap levels are tiny, so $1,000 of No walks to ~0.8 → overround → dropped
const thin = { yes: [[0.51, 80], [0.52, 343], [0.53, 1580], [0.54, 3141]], no: [[0.53, 9], [0.54, 19], [0.55, 6], [0.57, 10], [0.8, 18088]] };
const px = { kalshiBooks: { [T]: thin }, relay: {}, now, kalshiAt: now };

// 1. thin Kalshi book alone → no live price → sniper's fill-time leg fair (never the 20% artifact)
const stored = storedLegFairs([{ created_at: "2026-10-22T20:49:00Z", details: { legDetail: [{ ticker: T, side: "yes", fair: 0.492, venue: "kalshi" }] } }]);
let f = makeSniperLegFair({ stored })({ ticker: T, side: "yes" }, px);
assert.equal(f.best, "fill-time"); assert.ok(Math.abs(f.p - 0.492) < 1e-9);
// no stored fair either → unpriced
assert.equal(makeSniperLegFair({})({ ticker: T, side: "yes" }, px).p, null);

// 2. a deep Novig TD book from relay /td (no fee pregame) prices it: 1 − $1,000 No VWAP
const names = { [T]: "Puka Nacua: 1+ touchdowns" };
const tdBooks = indexTdRows({ novig: [{ player: "Puka Nacua", team: "LAR", away: "Los Angeles Rams", home: "Las Vegas Raiders", start: "2026-10-25T20:05:00Z", updated_at: new Date(now - 1000).toISOString(), yes: [{ odds: 0.5, size: 5000 }], no: [{ odds: 0.52, size: 5000 }] }] }, names, now);
assert.equal(tdBooks.stats.novig.matched, 1);
f = makeSniperLegFair({ tdBooks, stored })({ ticker: T, side: "yes" }, px);
assert.equal(f.best, "novig"); assert.ok(Math.abs(f.p - 0.48) < 1e-9);
// "no" leg uses the Yes side as the opposite
f = makeSniperLegFair({ tdBooks })({ ticker: T, side: "no" }, px);
assert.ok(Math.abs(f.p - 0.5) < 1e-9);
// wrong player / date never matches
assert.equal(indexTdRows({ novig: [{ player: "Puka Nacua", start: "2026-11-01T20:05:00Z", yes: [], no: [] }] }, names, now).stats.novig.unmatched, 1);

// 3. Kalshi TD fee + $1,000 depth when the book is deep enough
const deep = { yes: [[0.5, 1e5]], no: [[0.52, 1e5]] };
f = makeSniperLegFair({})({ ticker: T, side: "yes" }, { ...px, kalshiBooks: { [T]: deep } });
assert.equal(f.best, "kalshi"); assert.ok(Math.abs(f.p - (1 - (0.52 + 0.07 * 0.52 * 0.48))) < 1e-9);
assert.equal(vwap([[0.5, 10]], () => 0, 1000), null); // short of $1,000

// 4. ProphetX moneyline via relay board (commission folded, size = stake $ → contracts)
const board = [{ bet_type: "moneyline", ticker: "KXNFLGAME-26NOV01PHIWAS-WAS", away: "Philadelphia Eagles", home: "Washington Commanders", start: "2026-11-01T17:00:00Z" }];
const pxq = prophetxAsNovig([{ bet_type: "moneyline", away: "Philadelphia Eagles", home: "Washington Commanders", side: "Philadelphia Eagles", odds: 0.35, size: 3500, start: "2026-11-01T17:00:00Z", updated_at: new Date(now).toISOString(), depth: [{ odds: 0.35, size: 3500 }] }]);
assert.ok(Math.abs(pxq[0].depth[0].odds - pxEffective(0.35)) < 1e-12 && Math.abs(pxq[0].depth[0].size - 10000) < 1e-9);
const pxRelay = relayIndex({ kalshiBoard: board, novig: pxq, novigLive: true, polledAt: now });
f = makeSniperLegFair({ pxRelay })({ ticker: "KXNFLGAME-26NOV01PHIWAS-WAS", side: "yes" }, { kalshiBooks: {}, relay: {}, now, kalshiAt: now });
assert.equal(f.best, "prophetx"); assert.ok(Math.abs(f.p - (1 - pxEffective(0.35))) < 1e-9);
console.log("sniperLegFair.test ok");
