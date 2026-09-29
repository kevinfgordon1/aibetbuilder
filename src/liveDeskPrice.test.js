import assert from "node:assert/strict";
import { SEP24_ACTIVITIES } from "./liveDeskFillsSep24.fixture.js";
import { tradeOrderSide } from "./liveDeskTradeSide.js";
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
  positionView,
  mapOpenOrders,
  mapActivities,
  deskErrorText,
  formatAmerican,
  toMicro,
} from "./liveDeskPrice.js";

assert.equal(DEFAULT_SIZE_DOLLARS, 25);
assert.equal(MAX_SIZE_DOLLARS, 1000);
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
    dollars: 1001,
    minQty: 1,
  });
  assert.equal(over.ok, false);
  assert.match(over.error, /\$1000/);
  const exact = quoteRestingOrder({
    american: -150,
    outcome: "long",
    action: "buy",
    tick: 0.001,
    dollars: 1000,
    minQty: 1,
  });
  assert.equal(exact.ok, true);
  assert.ok(exact.riskDollars <= 1000);
  assert.ok(exact.riskDollars > 100);
  // $1000 at the 1¢ floor is 100,000 contracts. The contract ceiling must
  // not reject a size the dollar cap allows.
  const floor = quoteRestingOrder({
    american: 9900,
    outcome: "long",
    action: "buy",
    tick: 0.001,
    dollars: 1000,
    minQty: 1,
  });
  assert.equal(floor.ok, true, floor.error || "");
  assert.equal(floor.outcomePrice, 0.01);
  assert.equal(floor.contracts, 100000);
  assert.ok(floor.riskDollars <= 1000);
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

const GB_SLUG = "aec-nfl-atl-gb-2026-09-24";
// Live market: title/outcome say Packers, settlement long is Falcons (long: true, pays 1).
const GB_MARKET = {
  question: "Atlanta Falcons vs. Green Bay Packers",
  title: "Packers",
  slug: GB_SLUG,
  outcomes: "[\"Packers\",\"Falcons\"]",
  orderPriceMinTickSize: 0.001,
  active: true,
  closed: false,
  marketSides: [
    { long: true, description: "Falcons", price: "1", team: { name: "Atlanta Falcons", displayAbbreviation: "ATL" } },
    { long: false, description: "Packers", price: "0", team: { name: "Green Bay Packers", displayAbbreviation: "GB" } },
  ],
};

{
  // Negative instrument qty is a Packers hold, not a Falcons hold and not a short of the title.
  const sides = readMarketSides(GB_MARKET);
  assert.equal(sides.longName, "Atlanta Falcons");
  assert.equal(sides.shortName, "Green Bay Packers");
  assert.notEqual(sides.longName, "Packers");
  const row = mapPositions({
    positions: {
      [GB_SLUG]: {
        netPositionDecimal: "-1081",
        cost: { value: "432.40", currency: "USD" },
        marketMetadata: { slug: GB_SLUG, title: "Packers", outcome: "Packers" },
      },
    },
  })[0];
  const view = positionView(row, sides);
  assert.equal(view.team, "Green Bay Packers");
  assert.notEqual(view.team, "Atlanta Falcons");
  assert.notEqual(view.team, "Packers");
  assert.equal(view.net, 1081);
  assert.equal(view.side, "short");
  assert.equal(view.instrumentNet, -1081);
  assert.equal(view.avgAmerican, "+150");
  assert.equal(view.cost, 432.4);
  assert.equal(view.title, "Atlanta Falcons vs. Green Bay Packers");
  assert.doesNotMatch(view.avgAmerican, /¢/);
}

{
  // Normal case: positive qty is the long team even when the position title names the other team.
  const sides = readMarketSides({
    question: "Los Angeles vs. Tennessee",
    title: "Titans",
    slug: "aec-nfl-lac-ten-2025-11-02",
    outcomes: "[\"Titans\",\"Chargers\"]",
    marketSides: [
      { long: false, description: "Titans", team: { name: "Tennessee Titans" } },
      { long: true, description: "Chargers", team: { name: "Los Angeles Chargers" } },
    ],
  });
  const row = mapPositions({
    positions: {
      "aec-nfl-lac-ten-2025-11-02": {
        netPositionDecimal: "12",
        qtyBoughtDecimal: "12",
        qtySoldDecimal: "0",
        cost: { value: "7.20", currency: "USD" },
        marketMetadata: { slug: "aec-nfl-lac-ten-2025-11-02", title: "Titans", outcome: "Titans" },
      },
    },
  })[0];
  const view = positionView(row, sides);
  assert.equal(view.team, "Los Angeles Chargers");
  assert.notEqual(view.team, "Titans");
  assert.notEqual(view.team, "Tennessee Titans");
  assert.equal(view.net, 12);
  assert.equal(view.side, "long");
  assert.equal(view.avgAmerican, "-150");
  assert.equal(view.title, "Los Angeles vs. Tennessee");
}

{
  // Stale netPosition of the first fills, later legs on the same slug. Net them.
  const sides = readMarketSides(GB_MARKET);
  const rows = mapPositions({
    positions: [
      {
        netPositionDecimal: "-197",
        cost: { value: "80.00", currency: "USD" },
        marketMetadata: { slug: GB_SLUG, title: "Packers", outcome: "Packers" },
      },
      {
        netPositionDecimal: "-884",
        cost: { value: "352.40", currency: "USD" },
        marketMetadata: { slug: GB_SLUG, title: "Packers", outcome: "Packers" },
      },
    ],
  });
  assert.equal(rows.length, 1);
  const view = positionView(rows[0], sides);
  assert.equal(view.team, "Green Bay Packers");
  assert.equal(view.net, 1081);
  assert.equal(view.avgAmerican, "+150");
}

{
  // Position snapshot stuck after the first four GB buys (~197). qtySold and
  // the later BUY_SHORT fills are the rest of the 1,081.
  const sides = readMarketSides(GB_MARKET);
  const fromFlow = positionView(mapPositions({
    positions: {
      [GB_SLUG]: {
        netPositionDecimal: "-197",
        qtyBoughtDecimal: "0",
        qtySoldDecimal: "1081",
        cost: { value: "432.40", currency: "USD" },
        marketMetadata: { slug: GB_SLUG, title: "Packers", outcome: "Packers" },
      },
    },
  })[0], sides);
  assert.equal(fromFlow.team, "Green Bay Packers");
  assert.equal(fromFlow.net, 1081);
  assert.notEqual(fromFlow.net, 197);

  const fills = [
    { id: "f1", marketSlug: GB_SLUG, intent: "ORDER_INTENT_BUY_SHORT", qtyDecimal: "197", price: { value: "0.600", currency: "USD" }, createTime: "2026-09-24T18:00:00Z" },
    { id: "f2", marketSlug: GB_SLUG, intent: "ORDER_INTENT_BUY_SHORT", qtyDecimal: "210.5", price: { value: "0.677", currency: "USD" }, createTime: "2026-09-24T18:10:00Z" },
    { id: "f3", marketSlug: GB_SLUG, intent: "ORDER_INTENT_BUY_SHORT", qtyDecimal: "327.9", price: { value: "0.766", currency: "USD" }, createTime: "2026-09-24T18:20:00Z" },
    { id: "f4", marketSlug: GB_SLUG, intent: "ORDER_INTENT_BUY_SHORT", qtyDecimal: "344.8", price: { value: "0.710", currency: "USD" }, createTime: "2026-09-24T18:30:00Z" },
  ];
  const rows = mapPositions({
    positions: {
      [GB_SLUG]: {
        netPositionDecimal: "-197",
        cost: { value: "50.00", currency: "USD" },
        marketMetadata: { slug: GB_SLUG, title: "Packers", outcome: "Packers" },
      },
    },
  }, { fills });
  assert.equal(rows.length, 1);
  const view = positionView(rows[0], sides);
  const expected = 197 + 210.5 + 327.9 + 344.8;
  assert.equal(view.team, "Green Bay Packers");
  assert.ok(Math.abs(view.net - expected) < 0.02, "net " + view.net + " vs " + expected);
  assert.ok(view.net > 1000);
  assert.notEqual(view.net, 197);
  assert.match(view.avgAmerican, /^\+\d+$/);
  assert.doesNotMatch(view.avgAmerican, /¢/);
  assert.ok(view.cost > 50, "fill cost replaces the stale $50 snapshot");
}

{
  // A flat snapshot stays flat. An opposite-side lifetime total does not flip a real long.
  const flat = mapPositions({
    positions: {
      [GB_SLUG]: {
        netPositionDecimal: "0",
        qtyBoughtDecimal: "0",
        qtySoldDecimal: "1081",
        marketMetadata: { slug: GB_SLUG, title: "Packers" },
      },
    },
  });
  assert.equal(flat.length, 0);
  const held = mapPositions({
    positions: {
      "aec-nfl-lac-ten-2025-11-02": {
        netPositionDecimal: "12",
        qtyBoughtDecimal: "12",
        qtySoldDecimal: "500",
        marketMetadata: { slug: "aec-nfl-lac-ten-2025-11-02", title: "Chargers" },
      },
    },
  }, {
    fills: [{
      id: "opp",
      marketSlug: "aec-nfl-lac-ten-2025-11-02",
      intent: "ORDER_INTENT_BUY_SHORT",
      qtyDecimal: "400",
      price: { value: "0.40", currency: "USD" },
    }],
  });
  assert.equal(held.length, 1);
  assert.equal(held[0].instrumentNet, 12);
  assert.equal(held[0].side, "long");
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
  assert.equal(
    deskErrorText('{"title":"Error 1015: You are being rate limited","status":429,"error_code":1015}'),
    "Polymarket is rate-limiting us, retrying in 45s",
  );
  assert.equal(
    deskErrorText({ title: "Error 1015: You are being rate limited", status: 429, error_code: 1015, retryAfter: 37 }),
    "Polymarket is rate-limiting us, retrying in 37s",
  );
  assert.equal(deskErrorText("Polymarket is rate-limiting us, retrying in 42s"), "Polymarket is rate-limiting us, retrying in 42s");
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
    protect: true,
    gameId: "",
    slug: "",
    slugDraft: "",
    outcome: "long",
    marketType: "moneyline",
    notice: "",
  });
  assert.equal(Object.hasOwn(next, "american"), false);
  assert.equal(Object.hasOwn(next, "dollars"), false);
  assert.equal(Object.hasOwn(next, "allowCross"), false);
}

{
  // Real Polymarket US trades: no side on the trade, ours is on the order in
  // our execution (passive here; the aggressor order is the counterparty's and
  // may say ORDER_INTENT_UNDEFINED). The fill correction must read it.
  const first = SEP24_ACTIVITIES[0].trade;
  assert.equal(first.intent, undefined);
  assert.equal(first.aggressorExecution.order.intent, "ORDER_INTENT_UNDEFINED");
  assert.deepEqual(tradeOrderSide(first), { action: "buy", outcome: "short" });

  const GB = "aec-nfl-atl-gb-2026-09-24";
  const stale = {
    positions: {
      [GB]: {
        netPositionDecimal: "-5",
        cost: { value: "3.00", currency: "USD" },
        marketMetadata: { slug: GB, title: "ATL Falcons vs GB Packers", outcome: "Packers" },
      },
    },
  };
  const rows = mapPositions(stale, { fills: SEP24_ACTIVITIES });
  const gb = rows.find((r) => r.slug === GB);
  // Oldest -> newest: SELL_LONG 147.05 @ .32, BUY_SHORT 150.37 @ .335,
  // SELL_SHORT 250 @ .355 (covers), BUY_SHORT 150 @ .40.
  assert.equal(gb.instrumentNet, -197.42);
  assert.equal(gb.net, -197.42);
  assert.equal(gb.side, "short");
  assert.equal(gb.cost, 121.89);

  // Other open markets in the page appear from their fills.
  const spread = rows.find((r) => r.slug === "asc-nfl-atl-gb-2026-09-24-neg-6pt5");
  assert.equal(spread.instrumentNet, -2000);
  assert.equal(spread.cost, 1660);
  // MIL-PHI resolved inside the same page: its BUY_LONG fill must not bring a
  // settled market back as an open position.
  assert.equal(rows.some((r) => r.slug === "aec-mlb-mil-phi-2026-09-22"), false);
  const withoutResolution = mapPositions({ positions: {} }, {
    fills: SEP24_ACTIVITIES.filter((a) => a.type === "ACTIVITY_TYPE_TRADE"),
  });
  const mil = withoutResolution.find((r) => r.slug === "aec-mlb-mil-phi-2026-09-22");
  assert.equal(mil.instrumentNet, 218.75);
  assert.equal(mil.side, "long");

  // A snapshot that already shows at least as many contracts is left alone.
  const fresh = mapPositions({
    positions: {
      [GB]: {
        netPositionDecimal: "-197.42",
        cost: { value: "121.00", currency: "USD" },
        marketMetadata: { slug: GB, title: "ATL Falcons vs GB Packers", outcome: "Packers" },
      },
    },
  }, { fills: SEP24_ACTIVITIES }).find((r) => r.slug === GB);
  assert.equal(fresh.cost, 121);
}

{
  // Order with ORDER_INTENT_UNDEFINED but outcomeSide / action set (seen on
  // Polymarket US) and the trade's own intent also UNDEFINED.
  const SLUG = "aec-nfl-lac-ten-2025-11-02";
  const trade = (id, isAggressor, order, qty, price, t) => ({
    type: "ACTIVITY_TYPE_TRADE",
    trade: {
      id,
      marketSlug: SLUG,
      intent: "ORDER_INTENT_UNDEFINED",
      isAggressor,
      qtyDecimal: qty,
      price: { value: price, currency: "USD" },
      createTime: t,
      aggressorExecution: { order: isAggressor ? order : { intent: "ORDER_INTENT_UNDEFINED" } },
      passiveExecution: { order: isAggressor ? { intent: "ORDER_INTENT_UNDEFINED" } : order },
    },
  });
  const buyNo = { intent: "ORDER_INTENT_UNDEFINED", outcomeSide: "OUTCOME_SIDE_NO", action: "ORDER_ACTION_BUY" };
  const sellNo = { intent: "ORDER_INTENT_UNDEFINED", outcomeSide: "OUTCOME_SIDE_NO", action: "ORDER_ACTION_SELL" };
  const buyYes = { intent: "ORDER_INTENT_UNDEFINED", outcomeSide: "OUTCOME_SIDE_YES", action: "ORDER_ACTION_BUY" };
  const fills = [
    trade("t1", true, buyNo, "100", "0.40", "2026-09-24T18:00:00Z"),
    trade("t2", false, buyNo, "50", "0.30", "2026-09-24T18:05:00Z"),
    trade("t3", true, sellNo, "30", "0.35", "2026-09-24T18:10:00Z"),
  ];
  const rows = mapPositions({ positions: {} }, { fills });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].instrumentNet, -120);
  assert.equal(rows[0].side, "short");
  // 100 @ .60 + 50 @ .70 = 95; sell 30 of 150 removes 1/5 -> 76.
  assert.equal(rows[0].cost, 76);

  const long = mapPositions({ positions: {} }, {
    fills: [trade("y1", true, buyYes, "10", "0.25", "2026-09-24T18:00:00Z")],
  });
  assert.equal(long[0].instrumentNet, 10);
  assert.equal(long[0].cost, 2.5);

  // The order wins over a conflicting top-level field; without an order side
  // the trade is still ignored (never guessed).
  const unknown = mapPositions({ positions: {} }, {
    fills: [trade("u1", true, { intent: "ORDER_INTENT_UNDEFINED" }, "10", "0.25", "2026-09-24T18:00:00Z")],
  });
  assert.equal(unknown.length, 0);
}

{
  // Legacy / flattened shape: side only on the trade (no executions).
  const SLUG = "aec-nfl-lac-ten-2025-11-02";
  const viaOutcome = mapPositions({ positions: {} }, {
    fills: [
      { id: "l1", marketSlug: SLUG, outcomeSide: "OUTCOME_SIDE_YES", action: "ORDER_ACTION_BUY", qtyDecimal: "20", price: { value: "0.50" }, createTime: "2026-09-24T18:00:00Z" },
      { id: "l2", marketSlug: SLUG, outcomeSide: "OUTCOME_SIDE_YES", action: "ORDER_ACTION_SELL", qtyDecimal: "5", price: { value: "0.60" }, createTime: "2026-09-24T18:01:00Z" },
    ],
  });
  assert.equal(viaOutcome[0].instrumentNet, 15);
  assert.equal(viaOutcome[0].cost, 7.5);
  const viaSide = mapPositions({ positions: {} }, {
    fills: [{ id: "s1", marketSlug: SLUG, side: "SELL", qtyDecimal: "8", price: { value: "0.25" } }],
  });
  assert.equal(viaSide[0].instrumentNet, -8);
  assert.equal(viaSide[0].cost, 6);
  const viaIntent = mapPositions({ positions: {} }, {
    fills: [{ type: "ACTIVITY_TYPE_TRADE", trade: { id: "i1", marketSlug: SLUG, intent: "ORDER_INTENT_BUY_SHORT", qtyDecimal: "4", price: { value: "0.75" } } }],
  });
  assert.equal(viaIntent[0].instrumentNet, -4);
  assert.equal(viaIntent[0].cost, 1);
}

console.log("liveDeskPrice.test.js ok");
