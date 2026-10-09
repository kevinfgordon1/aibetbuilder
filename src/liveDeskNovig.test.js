import assert from "node:assert/strict";
import {
  snapNovigBuyPrice,
  sizeToNovigQty,
  quoteNovigRest,
  buildNovigOrder,
  readNovigMarket,
  protectSlugForNovig,
  marketIdFromProtectSlug,
  isNovigMarketId,
} from "./liveDeskNovig.js";

assert.equal(snapNovigBuyPrice(0.667), 0.665);
assert.equal(snapNovigBuyPrice(0.05), 0.05);
assert.equal(snapNovigBuyPrice(0.051), 0.05);

{
  const s = sizeToNovigQty({ dollars: 25, outcomeProb: 0.5, action: "buy" });
  assert.equal(s.ok, true);
  assert.equal(s.qty, 5000);
  assert.equal(s.riskDollars, 25);
}

{
  const q = quoteNovigRest({
    american: "-150",
    outcome: "long",
    action: "buy",
    dollars: 25,
    longOutcomeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    shortOutcomeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  assert.equal(q.ok, true);
  assert.equal(q.orderOutcomeId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const body = buildNovigOrder(q);
  assert.equal(body.tif, "PO");
  assert.equal(body.qty, q.qty);
  assert.match(body.price, /^\d\.\d{3}$/);
}

{
  const q = quoteNovigRest({
    american: "+200",
    outcome: "long",
    action: "sell",
    dollars: 25,
    longOutcomeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    shortOutcomeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  assert.equal(q.ok, true);
  // Sell long ≡ buy short at complement
  assert.equal(q.orderOutcomeId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
}

{
  const m = readNovigMarket({
    marketId: "11111111-1111-4111-8111-111111111111",
    eventId: "22222222-2222-4222-8222-222222222222",
    marketType: "MONEY",
    status: "OPEN",
    description: "ATL @ GB",
    fee: { coefficient: "0.03", makerCredit: "0.5", charged: "WHEN_LIVE" },
    outcomes: [
      { outcomeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "ATL" },
      { outcomeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "GB" },
    ],
  });
  assert.equal(m.ok, true);
  assert.equal(m.tradable, true);
  assert.equal(m.slug, "novig:11111111-1111-4111-8111-111111111111");
  assert.equal(marketIdFromProtectSlug(m.slug), "11111111-1111-4111-8111-111111111111");
  assert.equal(isNovigMarketId(m.marketId), true);
  assert.equal(protectSlugForNovig(m.marketId), m.slug);
}

console.log("liveDeskNovig.test.js ok");
