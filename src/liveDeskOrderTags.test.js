import assert from "node:assert/strict";
import { orderTags, orderTagLine, outcomeBook, takerSidePrice } from "./liveDeskOrderTags.js";

assert.equal(takerSidePrice("buy", 0.4525).toFixed(4), "0.5475");
assert.equal(takerSidePrice("sell", 0.4).toFixed(4), "0.4000");
assert.deepEqual(outcomeBook("short", 0.4, 0.6).bid.toFixed(2), "0.40");

// Rams buy at 45.25¢: taker gets Bills at 54.75¢ + fee ≈ -126 after fee.
let t = orderTags({ action: "buy", outcome: "long", price: 0.4525, yesBid: 0.44, yesAsk: 0.47, takerName: "Bills" });
assert.ok(Math.abs(t.takerEff - (0.5475 + 0.05 * 0.5475 * 0.4525)) < 1e-9);
assert.equal(t.status, "best");
assert.ok(orderTagLine(t, "buy").includes("Best price: market"));

// Market bid 46.75 > ours → behind 1.5¢, bid 47.75 to lead.
t = orderTags({ action: "buy", outcome: "long", price: 0.4525, yesBid: 0.4675, yesAsk: 0.48, tick: 0.01 });
assert.equal(t.status, "behind");
assert.equal(t.behindCents, 1.5);
assert.ok(Math.abs(t.toBeBestPrice - 0.4775) < 1e-9);
assert.ok(orderTagLine(t, "buy").includes("Behind best by 1.5¢: market"));

// Tied when our bid is the top of book.
t = orderTags({ action: "buy", outcome: "long", price: 0.45, yesBid: 0.45, yesAsk: 0.47 });
assert.equal(t.status, "tied");

// Short-side sell: taker buys our team; best ask on short = 1 - yesBid.
t = orderTags({ action: "sell", outcome: "short", price: 0.55, yesBid: 0.44, yesAsk: 0.46 });
assert.equal(t.status, "best"); // market ask 1-0.44=0.56, ours 0.55 is cheaper for the taker
t = orderTags({ action: "sell", outcome: "short", price: 0.58, yesBid: 0.44, yesAsk: 0.46, tick: 0.01 });
assert.equal(t.status, "behind");
assert.ok(Math.abs(t.toBeBestPrice - 0.55) < 1e-9);
assert.ok(orderTagLine(t, "sell").includes("sell at"));
// No live book → still shows taker price.
t = orderTags({ action: "buy", outcome: "long", price: 0.45 });
assert.equal(t.status, "unknown");
assert.ok(orderTagLine(t, "buy").startsWith("Taker gets"));
// Kevin's live case: Rams buy 45.25¢ → Bills -121 before / -127 after; best Bills ask 53.5¢ → -115 / -121.
t = orderTags({ action: "buy", outcome: "long", price: 0.4525, yesBid: 0.465, yesAsk: 0.47, tick: 0.0025, takerName: "Bills" });
assert.equal(t.takerRawAmerican, "-121"); assert.equal(t.takerAmerican, "-127");
assert.equal(t.marketRawAmerican, "-115"); assert.equal(t.marketAmerican, "-121");
assert.equal(t.status, "behind");
console.log(orderTagLine(t, "buy"));
console.log("liveDeskOrderTags ok");
