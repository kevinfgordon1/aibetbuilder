import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  settlementCopy,
  settlementFromStored,
  isOfficialSettlement,
  marketSettlement,
  tickerFromRecord,
  resolveComboTicker,
  historyOutcome,
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

// ── resolve: match / submission ticker without any fills ──
assert.equal(resolveComboTicker({
  parlay: { id: "p1" },
  fills: [],
  matches: [{ parlay_id: "p1", rfq_id: "r-skip", market_ticker: "KXMVE-FROM-MATCH" }],
}), "KXMVE-FROM-MATCH");
assert.equal(resolveComboTicker({
  parlay: { id: "p1" },
  fills: [],
  submissions: [{ parlay_id: "p1", status: "declined", market_ticker: "KXMVE-FROM-SKIP" }],
}), "KXMVE-FROM-SKIP");
assert.equal(resolveComboTicker({
  parlay: { id: "p1" },
  fills: [],
  submissions: [{ parlay_id: "p1", status: "quoted", ticker: "KXMVE-FROM-QUOTE" }],
}), "KXMVE-FROM-QUOTE");
assert.equal(resolveComboTicker({
  parlay: { id: "p1" },
  fills: [],
  submissions: [{ parlay_id: "p1", status: "unfilled", market_ticker: "KXMVE-FROM-UNFILLED" }],
}), "KXMVE-FROM-UNFILLED");
assert.equal(resolveComboTicker({
  parlay: { id: "p1" },
  fills: [],
  submissions: [{ parlay_id: "p2", status: "declined", market_ticker: "KXMVE-OTHER" }],
}), null);
assert.equal(resolveComboTicker({
  parlay: { id: "p1" },
  fills: [],
  submissions: [{ parlay_id: "p1", status: "shadow", market_ticker: "KXMVE-SHADOW" }],
}), null);

// ── never use a single-game leg ticker as the combo ticker ──
assert.equal(resolveComboTicker({
  parlay: {
    id: "p1",
    legs: [
      { ticker: "KXMLBGAME-26AUG12-MIA", side: "yes" },
      { ticker: "KXMLBGAME-26AUG12-KC", side: "yes" },
    ],
  },
  fills: [],
  matches: [{ parlay_id: "p1", rfq_id: "r1" }],
  submissions: [{ parlay_id: "p1", status: "declined" }],
  outcomes: [],
}), null);

// ── History Outcome: official result / awaiting ticker / dash ──
{
  const unfilledWon = historyOutcome({
    parlay: { id: "p1", kalshi_result: "no", archived_at: "2026-08-23T00:00:00Z" },
    fills: [],
  });
  assert.equal(unfilledWon.kind, "result");
  assert.equal(unfilledWon.settlement.text, "parlay lost (we won)");
  assert.equal(unfilledWon.settlement.weWon, true);
}
{
  const waiting = historyOutcome({
    parlay: { id: "p1", kalshi_result: null },
    fills: [],
    submissions: [{ parlay_id: "p1", status: "quoted", market_ticker: "KXMVE-WAIT" }],
  });
  assert.equal(waiting.kind, "awaiting");
  assert.equal(waiting.ticker, "KXMVE-WAIT");
}
{
  const dash = historyOutcome({
    parlay: {
      id: "p1",
      kalshi_result: null,
      legs: [{ ticker: "KXMLBGAME-26AUG12-MIA", side: "yes" }],
    },
    fills: [],
    matches: [{ parlay_id: "p1", rfq_id: "r1" }],
    submissions: [],
  });
  assert.equal(dash.kind, "none");
}

const locksSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocks.jsx"), "utf8");
assert.match(locksSrc, /historyOutcome/);
assert.match(locksSrc, /SettlementChip awaiting/);
assert.match(locksSrc, /out\.kind === "result"/);
assert.match(locksSrc, /out\.kind === "awaiting"/);
assert.match(locksSrc, /submissions/);
assert.match(locksSrc, /market_ticker/);
assert.match(locksSrc, /filledById && filledById\[row\.id\]\) > 0/);
assert.match(locksSrc, /\(archived \|\| \[\]\)\.forEach/);
assert.doesNotMatch(locksSrc, /POST \/markets|createMarket|mve_collection.*POST/);
assert.doesNotMatch(locksSrc, /legs\.map\(\(l\) => l\.ticker\).*combo_ticker/);

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
