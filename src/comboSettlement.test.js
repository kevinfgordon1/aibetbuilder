import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  settlementCopy,
  settlementFromStored,
  isOfficialSettlement,
  marketSettlement,
  tickerFromRecord,
  resolveComboTicker,
} from "./comboSettlement.js";

// ── yes/no → card copy (maker sold NO) ──
{
  const yes = settlementCopy("yes");
  assert.equal(yes.text, "parlay won (we lost)");
  assert.equal(yes.weWon, false);
  assert.equal(yes.result, "yes");
}
{
  const no = settlementCopy("NO");
  assert.equal(no.text, "parlay lost (we won)");
  assert.equal(no.weWon, true);
  assert.equal(no.result, "no");
}
assert.equal(settlementCopy(""), null);
assert.equal(settlementCopy("scalar"), null);
assert.equal(settlementCopy(null), null);
assert.deepEqual(settlementFromStored({ kalshi_result: "no" }).text, "parlay lost (we won)");
assert.equal(settlementFromStored({ kalshi_result: null }), null);

// ── official Kalshi settlement only (not clocks / start times) ──
assert.equal(isOfficialSettlement({ status: "determined", result: "yes" }), true);
assert.equal(isOfficialSettlement({ status: "finalized", result: "no" }), true);
assert.equal(isOfficialSettlement({ status: "amended", result: "yes" }), true);
assert.equal(isOfficialSettlement({ status: "active", result: "" }), false);
assert.equal(isOfficialSettlement({ status: "closed", result: "" }), false);
assert.equal(isOfficialSettlement({ status: "determined", result: "" }), false);
assert.equal(isOfficialSettlement({ status: "disputed", result: "yes" }), false);
assert.equal(marketSettlement({ status: "finalized", result: "no" }).text, "parlay lost (we won)");
assert.equal(marketSettlement({ status: "active", result: "yes" }), null);

// ── ticker from fill / outcome / nested raw.msg ──
assert.equal(tickerFromRecord({ ticker: "KXMVE-FILL" }), "KXMVE-FILL");
assert.equal(tickerFromRecord({ market_ticker: "KXMVE-COL" }), "KXMVE-COL");
assert.equal(tickerFromRecord({ raw: { msg: { market_ticker: "KXMVE-RAW" } } }), "KXMVE-RAW");
assert.equal(tickerFromRecord({}), null);

// ── resolve: persisted combo_ticker wins ──
assert.equal(resolveComboTicker({
  parlay: { id: "p1", combo_ticker: "STORED-TICKER" },
  fills: [{ parlay_id: "p1", ticker: "OTHER" }],
}), "STORED-TICKER");

// ── resolve: fill ticker (the combo/MVE market) ──
assert.equal(resolveComboTicker({
  parlay: { id: "p1" },
  fills: [
    { parlay_id: "p1", ticker: "KXMVECROSSCATEGORY-S2026AAA-BBB" },
    { parlay_id: "p2", ticker: "IGNORE-ME" },
  ],
}), "KXMVECROSSCATEGORY-S2026AAA-BBB");

// ── resolve: fill ticker missing → quote outcome (column or raw.msg), via rfq ──
assert.equal(resolveComboTicker({
  parlay: { id: "p1" },
  fills: [{ parlay_id: "p1", ticker: null, raw: { rfq_id: "r1", quote_id: "q1" } }],
  outcomes: [{
    parlay_id: null,
    rfq_id: "r1",
    quote_id: "q1",
    market_ticker: null,
    raw: { msg: { market_ticker: "KXMVE-FROM-EXECUTED" } },
  }],
  matches: [{ rfq_id: "r1" }],
}), "KXMVE-FROM-EXECUTED");

// ── resolve: outcomes.market_ticker joined by parlay_id ──
assert.equal(resolveComboTicker({
  parlay: { id: "p1" },
  fills: [{ parlay_id: "p1", ticker: null }],
  outcomes: [{ parlay_id: "p1", market_ticker: "KXMVE-FROM-OUTCOME" }],
}), "KXMVE-FROM-OUTCOME");

// ── do not reconstruct from individual legs ──
assert.equal(resolveComboTicker({
  parlay: {
    id: "p1",
    legs: [
      { ticker: "KXMLBGAME-26AUG12-MIA", side: "yes" },
      { ticker: "KXMLBGAME-26AUG12-KC", side: "yes" },
    ],
  },
  fills: [{ parlay_id: "p1", ticker: null }],
  outcomes: [],
}), null);

assert.equal(resolveComboTicker({ parlay: { id: "p1" } }), null);

const kalshiHelpers = createRequire(import.meta.url)("../api/kalshi-games.js")._helpers;

assert.deepEqual(kalshiHelpers.tickersFromReq({ query: { tickers: "KXMVE-AAA,KXMVE-BBB" } }), ["KXMVE-AAA", "KXMVE-BBB"]);
assert.deepEqual(kalshiHelpers.tickersFromReq({ url: "/api/kalshi-games?tickers=KXMVE-AAA" }), ["KXMVE-AAA"]);
assert.deepEqual(kalshiHelpers.tickersFromReq({ query: { tickers: "not a ticker,KXMVE-OK,/bin/sh" } }), ["KXMVE-OK"]);
assert.deepEqual(kalshiHelpers.slimMarket({ ticker: "KXMVE-X", status: "determined", result: "yes", volume_fp: "1" }), {
  ticker: "KXMVE-X",
  status: "determined",
  result: "yes",
});
assert.equal(kalshiHelpers.slimMarket(null), null);

console.log("comboSettlement.test.js ok");
