import assert from "node:assert/strict";
import {
  MAX_SIZE_DOLLARS,
  DEFAULT_SIZE_DOLLARS,
  parseAmerican,
  americanFromMicro,
  snapRestingLimit,
  quoteRestingOrder,
  buildLimitOrder,
  orderTicket,
  matchDisplayedOrder,
  crossBlock,
  yesBookSide,
  restFormAfterPlace,
  readMarketSides,
  mapPositions,
  mapOpenOrders,
  mapActivities,
  deskErrorText,
  formatAmerican,
  toMicro,
} from "./liveDeskPrice.js";

assert.equal(DEFAULT_SIZE_DOLLARS, 25);
assert.equal(MAX_SIZE_DOLLARS, 100);
assert.equal(parseAmerican("−150"), -150);
assert.equal(parseAmerican("+130"), 130);
assert.equal(parseAmerican("130"), 130);
assert.equal(parseAmerican("0"), null);
assert.equal(parseAmerican("-50"), null);
assert.equal(parseAmerican(""), null);

function implied(a) {
  return a < 0 ? Math.abs(a) / (Math.abs(a) + 100) : 100 / (a + 100);
}

// +100 and −100 are the same even-money price. Compare probabilities so the
// sign flip at 50¢ is not treated as a worse American.
function notWorseAmerican(action, snapped, asked) {
  const sp = implied(snapped);
  const ap = implied(asked);
  if (action === "buy") return sp <= ap + 1e-9;
  return sp >= ap - 1e-9;
}

{
  const buy = snapRestingLimit({ american: -150, outcome: "long", action: "buy", tick: 0.005 });
  assert.equal(buy.ok, true);
  assert.equal(buy.yesPriceValue, "0.600");
  assert.equal(buy.snappedAmerican, -150);
  assert.equal(buy.intent, "ORDER_INTENT_BUY_LONG");
  assert.equal(buy.centsLabel, "60¢");
}

{
  const buy = snapRestingLimit({ american: 130, outcome: "yes", action: "buy", tick: 0.005 });
  assert.equal(buy.ok, true);
  assert.equal(buy.outcomePrice, 0.43);
  assert.ok(buy.outcomePrice < 100 / 230);
  assert.equal(buy.snappedAmericanLabel, "+133");
  assert.ok(notWorseAmerican("buy", buy.snappedAmerican, 130));
}

{
  const sell = snapRestingLimit({ american: "+130", outcome: "long", action: "sell", tick: 0.005 });
  assert.equal(sell.ok, true);
  assert.equal(sell.outcomePrice, 0.435);
  assert.ok(sell.outcomePrice > 100 / 230);
  assert.ok(notWorseAmerican("sell", sell.snappedAmerican, 130));
  assert.equal(sell.intent, "ORDER_INTENT_SELL_LONG");
}

{
  // Buy the short team at −150 → floor NO to 0.600, YES book is 0.400.
  const buyNo = snapRestingLimit({ american: -150, outcome: "short", action: "buy", tick: 0.005 });
  assert.equal(buyNo.ok, true);
  assert.equal(buyNo.intent, "ORDER_INTENT_BUY_SHORT");
  assert.equal(buyNo.outcomePrice, 0.6);
  assert.equal(buyNo.yesPriceValue, "0.400");
  assert.equal(buyNo.snappedAmerican, -150);
}

{
  const sellNo = snapRestingLimit({ american: 130, outcome: "no", action: "sell", tick: 0.005 });
  assert.equal(sellNo.ok, true);
  assert.equal(sellNo.intent, "ORDER_INTENT_SELL_SHORT");
  assert.equal(sellNo.outcomePrice, 0.435);
  assert.equal(sellNo.yesPriceValue, "0.565");
  assert.ok(notWorseAmerican("sell", sellNo.snappedAmerican, 130));
}

{
  const fine = snapRestingLimit({ american: -151, outcome: "long", action: "buy", tick: 0.001 });
  assert.equal(fine.ok, true);
  assert.ok(fine.outcomeMicro <= toMicro(151 / 251));
  assert.ok(notWorseAmerican("buy", fine.snappedAmerican, -151));
  const laid = snapRestingLimit({ american: -151, outcome: "long", action: "sell", tick: 0.001 });
  assert.equal(laid.ok, true);
  assert.ok(laid.outcomeMicro >= toMicro(151 / 251));
  assert.ok(notWorseAmerican("sell", laid.snappedAmerican, -151));
}

for (const tick of [0.001, 0.005]) {
  for (const outcome of ["long", "short"]) {
    for (const action of ["buy", "sell"]) {
      for (let a = -500; a <= 500; a += 5) {
        if (a > -100 && a < 100) continue;
        const snap = snapRestingLimit({ american: a, outcome, action, tick });
        if (!snap.ok) continue;
        const fairMicro = toMicro(a < 0 ? Math.abs(a) / (Math.abs(a) + 100) : 100 / (a + 100));
        if (action === "buy") assert.ok(snap.outcomeMicro <= fairMicro, `${action} ${outcome} ${a} @ ${tick}`);
        else assert.ok(snap.outcomeMicro >= fairMicro, `${action} ${outcome} ${a} @ ${tick}`);
        assert.ok(notWorseAmerican(action, snap.snappedAmerican, a), `american ${action} ${a} → ${snap.snappedAmerican} @ ${tick} ${outcome}`);
        const tickMicro = Math.round(tick * 1e6);
        assert.equal(snap.yesMicro % tickMicro, 0);
        assert.equal(snap.outcomeMicro % tickMicro, 0);
      }
    }
  }
}

{
  const quote = quoteRestingOrder({
    american: -150,
    outcome: "long",
    action: "buy",
    tick: 0.005,
    dollars: 25,
    minQty: 1,
  });
  assert.equal(quote.ok, true);
  assert.equal(quote.contracts, 41);
  assert.ok(quote.riskDollars <= 25);
  const body = buildLimitOrder({ slug: "aec-nfl-lac-ten-2025-11-02", quote });
  assert.equal(body.type, "ORDER_TYPE_LIMIT");
  assert.equal(body.price.value, "0.600");
  assert.equal(body.price.currency, "USD");
  assert.equal(body.quantity, 41);
  assert.equal(body.tif, "TIME_IN_FORCE_GOOD_TILL_CANCEL");
  assert.equal(body.intent, "ORDER_INTENT_BUY_LONG");
  assert.equal(body.manualOrderIndicator, "MANUAL_ORDER_INDICATOR_MANUAL");
  assert.equal(body.participateDontInitiate, true);
  assert.equal(body.side, undefined);
  const crossing = buildLimitOrder({ slug: "aec-nfl-lac-ten-2025-11-02", quote, allowCross: true });
  assert.equal(crossing.participateDontInitiate, false);
}

{
  const over = quoteRestingOrder({
    american: -150,
    outcome: "long",
    action: "buy",
    tick: 0.001,
    dollars: 250,
    minQty: 1,
  });
  assert.equal(over.ok, false);
  assert.match(over.error, /\$100/);
  const exact = quoteRestingOrder({
    american: -150,
    outcome: "long",
    action: "buy",
    tick: 0.001,
    dollars: 100,
    minQty: 1,
  });
  assert.equal(exact.ok, true);
  assert.ok(exact.riskDollars <= 100);
}

{
  const market = {
    question: "Los Angeles vs. Tennessee",
    slug: "aec-nfl-lac-ten-2025-11-02",
    outcomes: "[\"Titans\",\"Chargers\"]",
    orderPriceMinTickSize: 0.005,
    minimumTradeQty: 1,
    active: true,
    closed: false,
    marketSides: [
      { long: false, description: "Titans", team: { name: "Tennessee Titans" } },
      { long: true, description: "Chargers", team: { name: "Los Angeles Chargers" } },
    ],
  };
  const sides = readMarketSides(market);
  assert.equal(sides.ok, true);
  assert.equal(sides.longName, "Los Angeles Chargers");
  assert.equal(sides.shortName, "Tennessee Titans");
  assert.notEqual(sides.longName, "Titans");
  assert.equal(sides.tick, 0.005);
  assert.equal(readMarketSides({ outcomes: "[\"A\",\"B\"]" }).ok, false);
  assert.match(readMarketSides({ outcomes: "[\"A\",\"B\"]" }).error, /outcomes/);
}

{
  const rows = mapPositions({
    positions: {
      "flat-mkt": { netPositionDecimal: "0", marketMetadata: { slug: "flat-mkt", title: "Flat" } },
      "aec-nfl-lac-ten-2025-11-02": {
        netPositionDecimal: "12",
        cost: { value: "7.20", currency: "USD" },
        marketMetadata: { slug: "aec-nfl-lac-ten-2025-11-02", title: "Los Angeles vs. Tennessee", outcome: "Chargers" },
      },
      "gone": { netPositionDecimal: "-4", expired: true, marketMetadata: { slug: "gone" } },
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].side, "long");
  assert.equal(rows[0].net, 12);
  assert.equal(rows[0].title, "Los Angeles vs. Tennessee");
}

{
  const orders = mapOpenOrders({
    orders: [{
      id: "ord-1",
      marketSlug: "aec-nfl-lac-ten-2025-11-02",
      intent: "ORDER_INTENT_BUY_SHORT",
      price: { value: "0.400", currency: "USD" },
      quantity: 10,
      leavesQuantity: 10,
      state: "ORDER_STATE_NEW",
    }],
  }, {
    "aec-nfl-lac-ten-2025-11-02": { longName: "Los Angeles Chargers", shortName: "Tennessee Titans", title: "LAC vs TEN" },
  });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].outcomeName, "Tennessee Titans");
  assert.equal(orders[0].action, "buy");
  assert.equal(orders[0].americanLabel, formatAmerican(americanFromMicro(600000)));
  assert.equal(orders[0].americanLabel, "-150");
}

{
  assert.deepEqual(mapActivities({ activities: {} }), []);
  assert.deepEqual(mapActivities({ activities: null }), []);
  assert.deepEqual(mapActivities(null), []);
  const rows = mapActivities({
    activities: [{
      type: "ACTIVITY_TYPE_TRADE",
      trade: {
        id: "t1",
        marketSlug: "aec-nfl-lac-ten-2025-11-02",
        price: { value: "0.600", currency: "USD" },
        qtyDecimal: "10",
        createTime: "2026-09-24T00:00:00Z",
      },
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].americanLabel, "-150");
}

{
  // Vercel FUNCTION_INVOCATION_FAILED is { error: { code, message } }.
  // Rendering that object is what blanked the desk.
  assert.equal(
    deskErrorText({ code: "500", message: "A server error has occurred" }),
    "A server error has occurred",
  );
  assert.equal(deskErrorText("Sign in required."), "Sign in required.");
  assert.equal(deskErrorText(null, "Could not load the desk (500)."), "Could not load the desk (500).");
  assert.equal(deskErrorText({}), "Could not load the desk.");
}

{
  // Green Bay is the short team. Buy GB at −150 / $100 rests a YES sell
  // at 40¢ for floor($100 / 0.60) = 166.66, not a YES buy of 250.
  const tick = 0.001;
  const minQty = 0.01;
  const dollars = 100;
  const cases = [
    ["long", "buy", "ORDER_INTENT_BUY_LONG", "buy", "0.600", 166.66],
    ["long", "sell", "ORDER_INTENT_SELL_LONG", "sell", "0.600", 250],
    ["short", "buy", "ORDER_INTENT_BUY_SHORT", "sell", "0.400", 166.66],
    ["short", "sell", "ORDER_INTENT_SELL_SHORT", "buy", "0.400", 250],
  ];
  for (const [outcome, action, intent, bookSide, yesPrice, contracts] of cases) {
    const quote = quoteRestingOrder({ american: -150, outcome, action, tick, dollars, minQty });
    assert.equal(quote.ok, true, outcome + " " + action + " " + (quote.error || ""));
    assert.equal(quote.intent, intent, outcome + " " + action);
    assert.equal(quote.bookSide, bookSide, outcome + " " + action);
    assert.equal(yesBookSide(outcome, action), bookSide);
    assert.equal(quote.yesPriceValue, yesPrice, outcome + " " + action);
    assert.equal(quote.contracts, contracts, outcome + " " + action);
    const body = buildLimitOrder({ slug: "aec-nfl-atl-gb-2026-09-24", quote });
    assert.equal(body.intent, intent);
    assert.equal(body.price.value, yesPrice);
    assert.equal(body.quantity, contracts);
    assert.equal(body.participateDontInitiate, true);
    assert.equal(body.side, undefined);
  }
  const buyGb = quoteRestingOrder({
    american: -150,
    outcome: "short",
    action: "buy",
    tick,
    dollars,
    minQty,
  });
  assert.notEqual(buyGb.contracts, 250);
  assert.notEqual(buyGb.intent, "ORDER_INTENT_SELL_SHORT");
  assert.equal(buyGb.bookSide, "sell");
  const ticket = orderTicket(buyGb, "GB Packers");
  assert.equal(
    ticket.line,
    "You will BUY GB Packers at -150 (60c) · 166.66 contracts · max cost $100",
  );
  assert.equal(matchDisplayedOrder(buyGb, "GB Packers", ticket).ok, true);
  assert.equal(matchDisplayedOrder(buyGb, "GB Packers", null).ok, false);
  assert.equal(matchDisplayedOrder(buyGb, "GB Packers", { ...ticket, contracts: 250 }).ok, false);
  assert.equal(matchDisplayedOrder(buyGb, "GB Packers", { ...ticket, intent: "ORDER_INTENT_SELL_SHORT" }).ok, false);
  assert.equal(matchDisplayedOrder(buyGb, "Atlanta Falcons", ticket).ok, false);
  const sellGb = quoteRestingOrder({
    american: -150,
    outcome: "short",
    action: "sell",
    tick,
    dollars,
    minQty,
  });
  assert.equal(orderTicket(sellGb, "GB Packers").line,
    "You will SELL GB Packers at -150 (60c) · 250 contracts · max cost $100");
}

{
  // Sell YES at 40¢ does not cross a 35.5¢ bid. Buy YES at 40¢ does cross a 35.5¢ ask.
  assert.equal(crossBlock({ bookSide: "sell", yesMicro: 400000, bestBid: 0.355, bestAsk: 0.40 }).ok, true);
  const take = crossBlock({ bookSide: "buy", yesMicro: 400000, bestBid: 0.32, bestAsk: 0.355 });
  assert.equal(take.ok, false);
  assert.equal(take.crosses, true);
  assert.equal(crossBlock({ bookSide: "buy", yesMicro: 400000, bestBid: 0.30, bestAsk: 0.40 }).crosses, true);
  assert.equal(crossBlock({ bookSide: "sell", yesMicro: 400000, bestBid: 0.40, bestAsk: 0.50 }).crosses, true);
  assert.equal(crossBlock({ bookSide: "buy", yesMicro: 300000, bestBid: 0.30, bestAsk: 0.40 }).ok, true);
  assert.equal(crossBlock({ bookSide: "sell", yesMicro: 400000, bestBid: 0.30, bestAsk: 0.40 }).ok, true);
  assert.equal(crossBlock({ bookSide: "sell", yesMicro: 400000, bestBid: null, bestAsk: 0.50 }).ok, false);
  assert.equal(crossBlock({ bookSide: "sell", yesMicro: 400000, bestBid: 0.50, bestAsk: 0.40 }).ok, false);
}

{
  const orders = mapOpenOrders({
    orders: [{
      id: "ord-cross",
      marketSlug: "aec-nfl-atl-gb-2026-09-24",
      intent: "ORDER_INTENT_SELL_SHORT",
      side: "ORDER_SIDE_BUY",
      outcomeSide: "OUTCOME_SIDE_NO",
      price: { value: "0.400", currency: "USD" },
      quantity: 250,
      leavesQuantity: 250,
      state: "ORDER_STATE_NEW",
    }, {
      id: "ord-gb",
      marketSlug: "aec-nfl-atl-gb-2026-09-24",
      intent: "ORDER_INTENT_BUY_SHORT",
      side: "ORDER_SIDE_SELL",
      price: { value: "0.400", currency: "USD" },
      quantity: 166.66,
      leavesQuantity: 166.66,
      state: "ORDER_STATE_NEW",
    }],
  }, {
    "aec-nfl-atl-gb-2026-09-24": {
      longName: "Atlanta Falcons",
      shortName: "Green Bay Packers",
      title: "Falcons vs Packers",
    },
  });
  assert.equal(orders[0].outcomeName, "Atlanta Falcons");
  assert.equal(orders[0].action, "buy");
  assert.equal(orders[0].americanLabel, "+150");
  assert.notEqual(orders[0].outcomeName, "Green Bay Packers");
  assert.equal(orders[1].outcomeName, "Green Bay Packers");
  assert.equal(orders[1].action, "buy");
  assert.equal(orders[1].americanLabel, "-150");
}

{
  assert.equal(restFormAfterPlace(false), null);
  assert.equal(restFormAfterPlace(undefined), null);
  const next = restFormAfterPlace(true);
  assert.deepEqual(next, {
    action: "buy",
    american: "",
    dollars: "",
    protect: false,
  });
  assert.equal(Object.hasOwn(next, "outcome"), false);
  assert.equal(Object.hasOwn(next, "gameId"), false);
  assert.equal(Object.hasOwn(next, "slug"), false);
}

console.log("liveDeskPrice.test.js ok");
