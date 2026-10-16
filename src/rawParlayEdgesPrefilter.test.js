// combo_sniper_traded prefilter (traded_yes > P(fair) − 0.001) must never drop a row scoreRawEdge flags.
import assert from "node:assert/strict";
import { scoreRawEdge, probFromAmerican } from "./rawParlayEdges.js";
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let flagged = 0;
for (let i = 0; i < 200000; i++) {
  const fair = rnd() < 0.5 ? Math.round(100 + rnd() * 30000) : -Math.round(100 + rnd() * 900);
  const P = probFromAmerican(fair);
  const yT = Math.round(Math.min(0.99, Math.max(0.01, P + (rnd() - 0.5) * 0.2)) * 100) / 100;
  const poly = rnd() < 0.3;
  const row = { rfq_id: "r" + i, outcome: "traded", fair_mid_american: fair, traded_yes: yT, traded_contracts: Math.round(1 + rnd() * 5000), legs: ["KXNFLGAME-26OCT18LACKC-LAC:yes"], market_ticker: "KXMVECROSSCATEGORY0-S1-X", venue: poly ? "polymarket" : "kalshi", poly_tick_size: poly ? 0.001 : null };
  const e = scoreRawEdge(row, { edgeAmerican: Math.round(rnd() * 3000), makerRate: rnd() < 0.5 ? 0 : 0.0175 });
  if (e && e.flagged) { flagged++; assert.ok(yT > P - 0.001, JSON.stringify({ fair, yT, P })); }
}
assert.ok(flagged > 1000, "fixture should flag rows: " + flagged);
console.log("rawParlayEdges prefilter ok", flagged);
