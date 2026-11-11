import assert from "node:assert/strict";
import { lockFillReceipt } from "./comboStatement.js";
import { buyerSeesAfterFees, makerKeepsFromYes, quotedYesPrice } from "./buyerOdds.js";
import {
  polyComboMakerRate,
  polyComboMakerFeeDollars,
  roundHalfEvenCents,
  isPolyComboMakerFill,
} from "./polyComboMakerFee.js";

const BEFORE = "2026-11-14T04:59:59.999Z";
const AT = "2026-11-14T05:00:00.000Z";

assert.equal(polyComboMakerRate(BEFORE), 0);
assert.equal(polyComboMakerRate(AT), 0.03);
assert.equal(polyComboMakerFeeDollars(100, 0.1, BEFORE), 0);
assert.equal(polyComboMakerFeeDollars(100, 0.1, AT), 0.27);
assert.equal(polyComboMakerFeeDollars(100, 0.25, AT), 0.56);
assert.equal(roundHalfEvenCents(0.025), 0.02);
assert.equal(roundHalfEvenCents(0.035), 0.04);

// Quote prices the fee in on the 0.0001 grid. +900 stays +900 before, moves shorter after.
assert.equal(quotedYesPrice(900, { venue: "polymarket", at: BEFORE }), 0.1);
const afterYes = quotedYesPrice(900, { venue: "polymarket", at: AT });
assert.equal(afterYes, 0.1028);
assert.equal(buyerSeesAfterFees(300, { venue: "polymarket_us", at: BEFORE }).text, "+273");
const buyerAfter = buyerSeesAfterFees(300, { venue: "polymarket", at: AT });
assert.ok(buyerAfter && buyerAfter.american < 300 && buyerAfter.american > 0, buyerAfter && buyerAfter.text);

// A fill at the quoted price still keeps the lock (net of the maker fee).
const kept = makerKeepsFromYes(afterYes, { venue: "polymarket", at: AT, ticker: "caoc-x" });
assert.ok(kept && kept.american >= 900, kept && kept.text);
assert.equal(makerKeepsFromYes(0.1, { venue: "polymarket", at: BEFORE, ticker: "caoc-x" }).text, "+900");
// Single-market maker fee stays $0 even after the cutoff.
assert.equal(makerKeepsFromYes(0.1, { venue: "polymarket", at: AT, ticker: "aec-nfl-buf-nyj" }).text, "+900");

assert.equal(isPolyComboMakerFill({ venue: "polymarket", is_combo: false, ticker: "aec-nfl-x" }), false);
assert.equal(isPolyComboMakerFill({ venue: "polymarket", is_combo: true, ticker: "caoc-x" }), true);

// History: a stored fee is used as-is. A $0 poly combo fill on/after the cutoff
// is charged the schedule so the statement is not short. Before the cutoff it stays $0.
const lock = { id: "p", fill_american: 900, parlay_stake: 10, parlay_american: 900 };
const early = lockFillReceipt(lock, [{
  parlay_id: "p", count: 100, yes_price: 0.1, is_combo: true, is_taker: false,
  venue: "polymarket", ticker: "caoc-early", fee: 0, kalshi_created_time: BEFORE,
}], 100);
assert.equal(early.fees, 0);
assert.ok(Math.abs(early.received - 10) < 1e-9);
const late = lockFillReceipt(lock, [{
  parlay_id: "p", count: 100, yes_price: 0.1, is_combo: true, is_taker: false,
  venue: "polymarket", ticker: "caoc-late", fee: 0, kalshi_created_time: AT,
}], 100);
assert.equal(late.fees, 0.27);
assert.ok(Math.abs(late.received - (10 - 0.27)) < 1e-9);
const stored = lockFillReceipt(lock, [{
  parlay_id: "p", count: 100, yes_price: 0.1, is_combo: true, is_taker: false,
  venue: "polymarket", ticker: "caoc-stored", fee: 0.27, kalshi_created_time: AT,
}], 100);
assert.equal(stored.fees, 0.27);
const single = lockFillReceipt(lock, [{
  parlay_id: "p", count: 100, yes_price: 0.1, is_combo: false, is_taker: false,
  venue: "polymarket", ticker: "aec-nfl-buf-nyj", fee: 0, kalshi_created_time: AT,
}], 100);
assert.equal(single.fees, 0);

console.log("polyComboMakerFee.test.js ok");
