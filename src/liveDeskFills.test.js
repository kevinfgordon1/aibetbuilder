import assert from "node:assert/strict";
import { mapFilledOrders, filledOrderIds, protectFillNote, fillTimeEt, FILLS_VENUE } from "./liveDeskFills.js";

const market = {
  slug: "aec-nfl-phi-chi-2026-09-28",
  marketType: "moneyline",
  sportsMarketType: "football_team_full_game_winner",
  marketSides: [
    { long: true, description: "Eagles", team: { name: "Philadelphia Eagles" } },
    { long: false, description: "Bears", team: { name: "Chicago Bears" } },
  ],
};

function order(id, intent, price, qty, cum, state) {
  return {
    id,
    marketSlug: market.slug,
    intent,
    price: { value: String(price), currency: "USD" },
    quantity: qty,
    cumQuantity: cum,
    state,
    marketMetadata: { slug: market.slug, title: "PHI Eagles vs CHI Bears" },
  };
}

function trade({ id, time, yes, qty, cost, ours, other, aggressor }) {
  const mine = { order: ours, lastShares: String(qty), lastPx: { value: String(yes) }, commissionNotionalCollected: { value: "-0.01" } };
  const theirs = { order: other, lastShares: String(qty), lastPx: { value: String(yes) } };
  return {
    type: "ACTIVITY_TYPE_TRADE",
    trade: {
      id,
      marketSlug: market.slug,
      state: "TRADE_STATE_NEW",
      createTime: time,
      price: { value: String(yes) },
      qtyDecimal: String(qty),
      cost: { value: String(cost) },
      isAggressor: !!aggressor,
      aggressorExecution: aggressor ? mine : theirs,
      passiveExecution: aggressor ? theirs : mine,
      market,
    },
  };
}

const someone = order("THEIRS", "ORDER_INTENT_UNDEFINED", 0.5, 10, 10, "ORDER_STATE_FILLED");
// Bet Protect re-rest: bought Bears (short) submitted at 43.5¢ (+130), re-rested
// and filled at 42¢ (+138). Long price = 1 - 0.42 = 0.58.
const reRest = order("RE1", "ORDER_INTENT_BUY_SHORT", 0.58, 100, 40, "ORDER_STATE_PARTIALLY_FILLED");
const plain = order("PLAIN", "ORDER_INTENT_BUY_LONG", 0.6, 50, 50, "ORDER_STATE_FILLED");
const payload = {
  activities: [
    trade({ id: "T1", time: "2026-09-29T00:40:01.100000000Z", yes: 0.58, qty: 40, cost: 16.8, ours: reRest, other: someone }),
    trade({ id: "T3", time: "2026-09-29T00:50:00.000000000Z", yes: 0.59, qty: 50, cost: 29.5, ours: plain, other: someone, aggressor: true }),
    trade({ id: "T1", time: "2026-09-29T00:40:01.100000000Z", yes: 0.58, qty: 40, cost: 16.8, ours: reRest, other: someone }),
    { type: "ACTIVITY_TYPE_POSITION_RESOLUTION", positionResolution: {} },
    { type: "ACTIVITY_TYPE_TRADE", trade: { id: "BUST", state: "TRADE_STATE_BUSTED", market } },
  ],
};
const protectRows = [
  { order_id: "ROOT", outcome: "short", action: "buy", outcome_micro: 435000, submitted_outcome_micro: 435000, protect_count: 0, lineage_id: "ROOT", status: "replaced" },
  { order_id: "RE1", outcome: "short", action: "buy", outcome_micro: 420000, submitted_outcome_micro: 435000, protect_count: 1, lineage_id: "ROOT", replaces: "ROOT", status: "armed" },
];

const rows = mapFilledOrders(payload, { protectRows });
assert.equal(rows.length, 2, "dedupes trade ids, skips busted and non-trades");
assert.deepEqual(rows.map((r) => r.id), ["T3", "T1"], "newest first");

const [taker, protectedFill] = rows;
assert.equal(taker.sideLabel, "Buy Philadelphia Eagles");
assert.equal(taker.fillAmerican, "-144");
assert.equal(taker.limitAmerican, "-150");
assert.equal(taker.role, "taker");
assert.equal(taker.protect, null);
assert.equal(taker.partial, false);
assert.equal(taker.venue, FILLS_VENUE);
assert.equal(taker.market, "Moneyline");
assert.equal(taker.game, "PHI Eagles vs CHI Bears");

assert.equal(protectedFill.orderId, "RE1");
assert.equal(protectedFill.sideLabel, "Buy Chicago Bears");
assert.equal(protectedFill.contractsLabel, "40");
assert.equal(protectedFill.costLabel, "$16.80");
assert.equal(protectedFill.fillAmerican, "+138");
assert.equal(protectedFill.partial, true);
assert.equal(protectedFill.orderProgress, "40 of 100");
assert.equal(protectedFill.source, "desk");
assert.ok(protectedFill.protect);
assert.equal(protectedFill.protect.line, "Submitted +130 → Filled +138 · Bet Protect");
assert.equal(protectedFill.protect.improvementLabel, "Improved 1.5¢ (8 pts)");
assert.ok(/ET$/.test(protectedFill.timeEt));
assert.equal(fillTimeEt("2026-09-29T00:40:01.100000000Z"), "Sep 28, 8:40:01 PM ET");

// Lineage root fallback when the re-rest row lost submitted_outcome_micro.
const legacy = mapFilledOrders(payload, {
  protectRows: [{ ...protectRows[1], submitted_outcome_micro: null }, protectRows[0]],
});
assert.equal(legacy.find((r) => r.id === "T1").protect.submittedAmerican, "+130");

// Unknown original price: still flagged as Bet Protect, no invented odds.
const unknown = mapFilledOrders(payload, { protectRows: [{ ...protectRows[1], submitted_outcome_micro: null, lineage_id: "RE1" }] });
assert.match(unknown.find((r) => r.id === "T1").protect.line, /original submitted odds not recorded/);

// Sell improvement direction.
const sell = protectFillNote({ action: "sell", submittedMicro: 400000, fillMicro: 420000, count: 1 });
assert.equal(sell.improvementLabel, "Improved 2¢ (12 pts)");

// Armed but never moved is a desk fill, not a Bet Protect improvement.
const armed = mapFilledOrders(payload, { protectRows: [{ order_id: "PLAIN", protect_count: 0, lineage_id: "PLAIN", outcome_micro: 600000, submitted_outcome_micro: 600000 }] });
const plainRow = armed.find((r) => r.id === "T3");
assert.equal(plainRow.protect, null);
assert.equal(plainRow.source, "desk");

assert.deepEqual(filledOrderIds(payload).sort(), ["PLAIN", "RE1"]);
assert.deepEqual(mapFilledOrders(null), []);
assert.equal(mapFilledOrders(payload, { protectRows, limit: 1 }).length, 1);

console.log("liveDeskFills.test.js ok");
