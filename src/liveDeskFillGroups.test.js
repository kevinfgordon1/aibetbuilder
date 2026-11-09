import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupFillsByOrder, fillGroupStatus } from "./liveDeskFillGroups.js";
import { mapFilledOrders } from "./liveDeskFills.js";
import { filterFills } from "./liveDeskPositionFills.js";
import { americanFromMicro, formatAmerican } from "./liveDeskPrice.js";

function fill(overrides) {
  return {
    id: overrides.tradeId,
    tradeId: overrides.tradeId,
    orderId: "DKRBBSHG14EX",
    time: overrides.time,
    timeEt: overrides.timeEt,
    game: "ARI Cardinals vs SEA Seahawks",
    market: "Moneyline",
    sideLabel: "Buy Seattle Seahawks",
    team: "Seattle Seahawks",
    contracts: overrides.contracts,
    contractsLabel: String(overrides.contracts),
    cost: overrides.cost,
    costLabel: "$" + overrides.cost.toFixed(2),
    costKind: "cost",
    fee: overrides.fee,
    fillMicro: overrides.fillMicro,
    fillAmerican: formatAmerican(americanFromMicro(overrides.fillMicro)),
    orderQty: 1200,
    orderCum: overrides.orderCum,
    orderState: overrides.orderState || "ORDER_STATE_PARTIALLY_FILLED",
    source: overrides.source || "desk",
    protect: overrides.protect || null,
    venue: "Polymarket US",
    ...overrides,
  };
}

const seattle = [
  fill({ tradeId: "T7", time: "2026-11-08T21:24:44.000Z", timeEt: "Nov 8, 5:24:44 PM ET", contracts: 187.19, cost: 140.39, fee: 0.02, fillMicro: 750000, orderCum: 288 }),
  fill({ tradeId: "T6", time: "2026-11-08T21:24:43.000Z", timeEt: "Nov 8, 5:24:43 PM ET", contracts: 9.16, cost: 6.87, fee: 0.01, fillMicro: 750000, orderCum: 100 }),
  fill({ tradeId: "T1", time: "2026-11-08T21:24:38.000Z", timeEt: "Nov 8, 5:24:38 PM ET", contracts: 27.21, cost: 20.41, fee: 0.01, fillMicro: 750000, orderCum: 27.21 }),
];

const grouped = groupFillsByOrder([...seattle, seattle[0]]);
assert.equal(grouped.length, 1, "same order id is one summary");
assert.equal(grouped[0].executionCount, 3, "repeated trade id is not a second fill");
assert.equal(grouped[0].contractsLabel, "223.56");
assert.equal(grouped[0].avgAmerican, "-300");
assert.equal(grouped[0].status, "partial");
assert.equal(grouped[0].progress, "288 of 1200");
assert.equal(grouped[0].timeEt, "Nov 8, 5:24:44 PM ET");
assert.equal(grouped[0].compactOrderId, "DKRBBSHG14EX");
assert.equal(grouped[0].executions[0].tradeId || grouped[0].executions[0].id, "T7");
assert.equal(grouped[0].cost, Math.round((140.39 + 6.87 + 20.41) * 100) / 100);
assert.equal(grouped[0].fees, 0.04);

const weighted = groupFillsByOrder([
  fill({ tradeId: "A", time: "2026-11-08T21:00:00.000Z", contracts: 10, cost: 4, fee: 0, fillMicro: 400000, orderQty: null, orderCum: null, orderState: "" }),
  fill({ tradeId: "B", time: "2026-11-08T21:00:01.000Z", contracts: 10, cost: 7.5, fee: 0, fillMicro: 750000, orderQty: null, orderCum: null, orderState: "" }),
]);
assert.equal(weighted[0].avgMicro, 575000);
assert.equal(weighted[0].avgAmerican, "-135");
assert.notEqual(weighted[0].avgAmerican, "-75", "do not average +150 and -300");
assert.equal(weighted[0].status, null, "no partial/full badge without an order total");

const twoGames = groupFillsByOrder([
  fill({ tradeId: "S", orderId: "SEA", time: "2026-11-08T21:24:44.000Z", contracts: 1, cost: 1, fee: 0, fillMicro: 750000 }),
  fill({ tradeId: "G", orderId: "GB", time: "2026-11-08T21:24:45.000Z", game: "ARI Cardinals vs GB Packers", sideLabel: "Buy Green Bay Packers", contracts: 2, cost: 1, fee: 0, fillMicro: 712500, orderState: "ORDER_STATE_FILLED", orderQty: 2, orderCum: 2 }),
]);
assert.equal(twoGames.length, 2);
assert.equal(twoGames[0].orderId, "GB");
assert.equal(twoGames[1].orderId, "SEA");
assert.equal(twoGames[0].status, "full");

const canceled = fillGroupStatus([
  fill({ tradeId: "C", contracts: 40, cost: 28, fee: 0.01, fillMicro: 710000, orderState: "ORDER_STATE_CANCELED", orderQty: 1403.5, orderCum: 40 }),
]);
assert.equal(canceled, "canceled");

const noFee = groupFillsByOrder([
  fill({ tradeId: "N1", contracts: 1, cost: 1, fee: null, fillMicro: 750000 }),
  fill({ tradeId: "N2", contracts: 1, cost: 1, fee: 0.01, fillMicro: 750000 }),
]);
assert.equal(noFee[0].fees, null);

const verified = groupFillsByOrder([
  fill({
    tradeId: "V",
    contracts: 10,
    cost: 7,
    fee: 0,
    fillMicro: 712500,
    orderState: "ORDER_STATE_PARTIALLY_FILLED",
    orderQty: 100,
    orderCum: 10,
    verified: { state: "filled", orderQty: 100, cumQty: 100 },
  }),
]);
assert.equal(verified[0].status, "full");
assert.equal(verified[0].progress, "100 of 100");

const desk = filterFills([
  fill({ tradeId: "D", source: "desk", contracts: 1, cost: 1, fee: 0, fillMicro: 750000 }),
  fill({ tradeId: "C2", orderId: "COMBO", source: "combo", contracts: 1, cost: 1, fee: 0, fillMicro: 500000, orderQty: null, orderState: "" }),
], "desk");
assert.equal(groupFillsByOrder(desk).length, 1);
assert.equal(groupFillsByOrder(filterFills([
  fill({ tradeId: "D", source: "desk", contracts: 1, cost: 1, fee: 0, fillMicro: 750000 }),
  fill({ tradeId: "C2", orderId: "COMBO", source: "combo", contracts: 1, cost: 1, fee: 0, fillMicro: 500000 }),
], "all")).length, 2);

const market = {
  slug: "aec-nfl-ari-sea-2026-11-08",
  marketType: "moneyline",
  marketSides: [
    { long: true, description: "Cardinals", team: { name: "Arizona Cardinals" } },
    { long: false, description: "Seahawks", team: { name: "Seattle Seahawks" } },
  ],
};
const ours = {
  id: "DKRBBSHG14EX",
  intent: "ORDER_INTENT_BUY_SHORT",
  price: { value: "0.25", currency: "USD" },
  quantity: 1200,
  cumQuantity: 27.21,
  state: "ORDER_STATE_PARTIALLY_FILLED",
};
const payload = {
  activities: [1, 2].map((n) => ({
    type: "ACTIVITY_TYPE_TRADE",
    trade: {
      id: "EX" + n,
      marketSlug: market.slug,
      state: "TRADE_STATE_NEW",
      createTime: "2026-11-08T21:24:3" + n + ".000Z",
      price: { value: "0.25" },
      qtyDecimal: "10",
      cost: { value: "7.50" },
      isAggressor: false,
      passiveExecution: {
        order: ours,
        lastShares: "10",
        lastPx: { value: "0.25" },
        commissionNotionalCollected: { value: "0.01" },
      },
      aggressorExecution: { order: { id: "THEIRS", intent: "ORDER_INTENT_SELL_SHORT" }, lastShares: "10", lastPx: { value: "0.25" } },
      market,
    },
  })),
};
const fromApi = groupFillsByOrder(mapFilledOrders(payload, { protectRows: [{ order_id: "DKRBBSHG14EX", protect_count: 0, lineage_id: "DKRBBSHG14EX", outcome_micro: 750000, submitted_outcome_micro: 750000, replaces: "", replaced_by: "NEXT" }] }));
assert.equal(fromApi.length, 1);
assert.equal(fromApi[0].executionCount, 2);
assert.equal(fromApi[0].sideLabel, "Buy Seattle Seahawks");
assert.equal(fromApi[0].status, "partial");
assert.equal(fromApi[0].replacedBy, "NEXT");

const ui = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "LiveDeskFilledOrders.jsx"), "utf8");
assert.match(ui, /groupFillsByOrder/);
assert.match(ui, /aria-expanded/);
assert.match(ui, /aria-controls/);
assert.match(ui, /Desk only/);
assert.match(ui, /"all"/);
assert.doesNotMatch(ui, /Every individual fill/);

console.log("liveDeskFillGroups.test.js ok");
