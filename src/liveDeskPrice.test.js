import assert from "node:assert/strict";
import {
  MAX_SIZE_DOLLARS,
  DEFAULT_SIZE_DOLLARS,
  parseAmerican,
  americanFromMicro,
  snapRestingLimit,
  quoteRestingOrder,
  buildLimitOrder,
  guardDeskOrder,
  restingLimitOrder,
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
  assert.equal(body.participateDontInitiate, false);
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
  // ATL @ GB: Falcons are YES (long), Packers are NO (short). price.value is the YES price.
  // Buy Packers −150 / $25 → 60¢, YES book 40¢, 41 contracts, about $24.60.
  const packers = restingLimitOrder({
    slug: "aec-nfl-atl-gb-2026-09-24",
    american: -150,
    outcome: "short",
    action: "buy",
    tick: 0.005,
    dollars: 25,
    minQty: 1,
  });
  assert.equal(packers.ok, true);
  assert.equal(packers.quote.centsLabel, "60¢");
  assert.equal(packers.quote.outcomePrice, 0.6);
  assert.equal(packers.quote.yesPriceValue, "0.400");
  assert.equal(packers.quote.yesCentsLabel, "40¢");
  assert.equal(packers.order.intent, "ORDER_INTENT_BUY_SHORT");
  assert.equal(packers.order.price.value, "0.400");
  assert.equal(packers.order.quantity, 41);
  assert.ok(Math.abs(packers.quote.riskDollars - 24.6) < 0.001);
  assert.ok(packers.quote.riskDollars <= 25);
  assert.equal(guardDeskOrder({
    american: -150,
    dollars: 25,
    tick: 0.005,
    minQty: 1,
    quote: packers.quote,
  }).ok, true);

  // This market's minimum lot is 0.01 contract, so the floor is 41.66, still 60¢, still about $25.
  const lot = restingLimitOrder({
    slug: "aec-nfl-atl-gb-2026-09-24",
    american: "-150",
    outcome: "short",
    action: "buy",
    tick: 0.005,
    dollars: 25,
    minQty: 0.01,
  });
  assert.equal(lot.ok, true);
  assert.equal(lot.order.price.value, "0.400");
  assert.equal(lot.order.quantity, 41.66);
  assert.ok(lot.quote.riskDollars <= 25);
  assert.ok(25 - lot.quote.riskDollars < 0.01);
  assert.notEqual(lot.order.quantity, 147.05);

  // Reverse side: buy Falcons −150 / $25 → YES price is 60¢, same 41 contracts.
  const falcons = restingLimitOrder({
    slug: "aec-nfl-atl-gb-2026-09-24",
    american: -150,
    outcome: "long",
    action: "buy",
    tick: 0.005,
    dollars: 25,
    minQty: 1,
  });
  assert.equal(falcons.ok, true);
  assert.equal(falcons.quote.centsLabel, "60¢");
  assert.equal(falcons.order.intent, "ORDER_INTENT_BUY_LONG");
  assert.equal(falcons.order.price.value, "0.600");
  assert.equal(falcons.order.quantity, 41);
  assert.ok(Math.abs(falcons.quote.riskDollars - 24.6) < 0.001);

  // The fill that landed: 68¢ and the $100 cap (147.05 contracts at a 0.01 lot).
  const marketPrice = quoteRestingOrder({
    american: -213,
    outcome: "short",
    action: "buy",
    tick: 0.005,
    dollars: 100,
    minQty: 0.01,
  });
  assert.equal(marketPrice.ok, true);
  assert.equal(marketPrice.yesPriceValue, "0.320");
  assert.equal(marketPrice.contracts, 147.05);
  const wrongPrice = guardDeskOrder({
    american: -150,
    dollars: 25,
    tick: 0.005,
    minQty: 0.01,
    quote: { ...marketPrice, riskDollars: 99.99, riskLabel: "$99.99" },
  });
  assert.equal(wrongPrice.ok, false);
  assert.match(wrongPrice.error, /one tick worse|more than a cent/);
  const wrongSize = guardDeskOrder({
    american: -150,
    dollars: 25,
    tick: 0.005,
    minQty: 1,
    quote: { ...packers.quote, riskDollars: 99.99, riskLabel: "$99.99" },
  });
  assert.equal(wrongSize.ok, false);
  assert.match(wrongSize.error, /more than a cent/);
}

console.log("liveDeskPrice.test.js ok");
